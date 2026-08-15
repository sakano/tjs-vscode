import {
    spawn,
    type ChildProcessWithoutNullStreams,
    type SpawnOptions,
} from 'node:child_process';
import { rename } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type * as vscode from 'vscode';

import type { CtagsProcessConfiguration } from './configuration';
import {
    assertGeneratedTagFile,
    assertReplaceableTagFile,
    getNonRecursiveInputFiles,
    prepareCtagsPaths,
    removeFileIfExists,
} from './paths';

const FORCED_TERMINATION_WAIT_MS = 2_000;

const TJS_REGEX_ARGS = [
    '--regex-tjs=/^[ \\t]*class[ \\t]+([a-zA-Z0-9_]+)/\\1/c,class/',
    '--regex-tjs=/^[ \\t]*function[ \\t]+([a-zA-Z0-9_]+)/\\1/f,function/',
    '--regex-tjs=/^[ \\t]*property[ \\t]+([a-zA-Z0-9_]+)/\\1/p,property/',
    '--regex-tjs=/^[ \\t]*var[ \\t]+([a-zA-Z0-9_]+)/\\1/v,value/',
    '--regex-tjs=/^[ \\t]*const[ \\t]+([a-zA-Z0-9_]+)/\\1/v,value/',
    '--regex-tjs=/^[ \\t]*([a-zA-Z0-9_]+)[ \\t]*:[ \\t]*function/\\1/f,function/',
    '--regex-tjs=/([a-zA-Z0-9_]+)[ \\t]*=[ \\t]*function/\\1/f,function/',
] as const;

type CtagsProcessCompletion = {
    closed: boolean;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    processError: Error | undefined;
    inputError: Error | undefined;
    stopReason: 'timeout' | 'cancelled' | undefined;
};

type OutputForwarder = {
    flush(): void;
    dispose(): void;
};

/** 形式検証済みの設定から、ctagsへ直接渡す引数配列を構築します。 */
export function buildCtagsArguments(
    configuration: CtagsProcessConfiguration,
    temporaryTagFilePath: string,
    searchPath: string,
): string[] {
    const argumentsList = [
        '--langdef=tjs',
        `--langmap=tjs:${configuration.fileExtensions.join('')}`,
        ...TJS_REGEX_ARGS,
        '--languages=tjs',
        ...configuration.extraArgs,
        '--links=no',
        '-f',
        temporaryTagFilePath,
        configuration.searchRecursive ? '--recurse=yes' : '--recurse=no',
    ];

    if (configuration.searchRecursive) {
        argumentsList.push(searchPath);
    } else {
        argumentsList.push('-L', '-');
    }
    return argumentsList;
}

/** シェルを無効化したctagsプロセス起動オプションを作成します。 */
export function createCtagsSpawnOptions(cwd: string, signal: AbortSignal): SpawnOptions {
    return {
        cwd,
        killSignal: 'SIGKILL',
        shell: false,
        signal,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    };
}

const ignoreLateStreamError = (): void => undefined;

/**
 * ctagsの終了を待ち、timeoutまたは外部キャンセル後も`close`が来なければ待機を打ち切ります。
 */
export function waitForCtagsProcess(
    child: ChildProcessWithoutNullStreams,
    controller: AbortController,
    timeoutMs: number,
    forcedTerminationWaitMs = FORCED_TERMINATION_WAIT_MS,
): Promise<CtagsProcessCompletion> {
    return new Promise(resolve => {
        let settled = false;
        let processError: Error | undefined;
        let inputError: Error | undefined;
        let stopReason: CtagsProcessCompletion['stopReason'];
        let timeout: NodeJS.Timeout | undefined;
        let forcedTerminationTimeout: NodeJS.Timeout | undefined;

        const finish = (
            closed: boolean,
            exitCode: number | null,
            signal: NodeJS.Signals | null,
        ): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (timeout !== undefined) {
                clearTimeout(timeout);
            }
            if (forcedTerminationTimeout !== undefined) {
                clearTimeout(forcedTerminationTimeout);
            }
            controller.signal.removeEventListener('abort', onAbort);
            child.removeListener('error', onProcessError);
            child.stdin.removeListener('error', onInputError);
            child.removeListener('close', onClose);

            // 終了未確認のプロセスから遅れてerrorが届いても、extension hostの
            // uncaught exceptionにしない。呼び出し側は直後にstdioを破棄する。
            if (!closed) {
                child.on('error', ignoreLateStreamError);
                child.stdin.on('error', ignoreLateStreamError);
            }

            resolve({
                closed,
                exitCode,
                signal,
                processError,
                inputError,
                stopReason,
            });
        };

        const onProcessError = (error: Error): void => {
            processError ??= error;
        };
        const onInputError = (error: Error): void => {
            inputError ??= error;
        };
        const onClose = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
            finish(true, exitCode, signal);
        };
        const onAbort = (): void => {
            stopReason ??= 'cancelled';
            forcedTerminationTimeout ??= setTimeout(() => {
                finish(false, null, null);
            }, forcedTerminationWaitMs);
        };

        child.on('error', onProcessError);
        child.stdin.on('error', onInputError);
        child.once('close', onClose);
        controller.signal.addEventListener('abort', onAbort, { once: true });

        if (controller.signal.aborted) {
            onAbort();
        } else if (timeoutMs > 0) {
            timeout = setTimeout(() => {
                stopReason ??= 'timeout';
                controller.abort();
            }, timeoutMs);
        }
    });
}

export class CtagsExecutionCancelledError extends Error {
    public constructor() {
        super('ctags was cancelled.');
    }
}

/** 一つのctags設定を安全に実行し、生成したタグファイルを原子的に昇格します。 */
export class CtagsProcessExecutor {
    private readonly controllers = new Set<AbortController>();
    private cancelled = false;

    public constructor(
        private readonly outputChannel: vscode.OutputChannel,
        private readonly spawnProcess: typeof spawn = spawn,
    ) {}

    public cancelAll(): void {
        this.cancelled = true;
        for (const controller of this.controllers) {
            controller.abort();
        }
        this.controllers.clear();
    }

    public async execute(
        folder: vscode.WorkspaceFolder,
        configuration: CtagsProcessConfiguration,
        processIndex: number,
    ): Promise<void> {
        const paths = await prepareCtagsPaths(folder, configuration, processIndex);
        const nonRecursiveInputFiles = configuration.searchRecursive
            ? []
            : await getNonRecursiveInputFiles(paths.searchPath);
        const argumentsList = buildCtagsArguments(
            configuration,
            paths.temporaryTagFilePath,
            paths.searchPath,
        );
        this.assertNotCancelled();

        const controller = new AbortController();
        this.controllers.add(controller);
        let temporaryFileWasPromoted = false;

        this.outputChannel.appendLine(`[ctagsProcess:${processIndex}] cwd=${JSON.stringify(paths.workspaceRoot)}`);
        this.outputChannel.appendLine(`[ctagsProcess:${processIndex}] argv=${JSON.stringify(['ctags', ...argumentsList])}`);

        try {
            const child = this.spawnProcess(
                'ctags',
                argumentsList,
                createCtagsSpawnOptions(paths.workspaceRoot, controller.signal),
            ) as ChildProcessWithoutNullStreams;
            const stdoutForwarder = this.pipeToOutput(child.stdout, `[ctagsProcess:${processIndex}] stdout`);
            const stderrForwarder = this.pipeToOutput(child.stderr, `[ctagsProcess:${processIndex}] stderr`);

            try {
                const completion = waitForCtagsProcess(child, controller, configuration.timeoutMs);

                if (configuration.searchRecursive) {
                    child.stdin.end();
                } else {
                    const fileList = nonRecursiveInputFiles.length === 0
                        ? ''
                        : `${nonRecursiveInputFiles.join('\n')}\n`;
                    child.stdin.end(fileList, 'utf8');
                }

                const result = await completion;
                stdoutForwarder.flush();
                stderrForwarder.flush();
                this.assertSuccessfulCompletion(result, configuration.timeoutMs);

                await assertGeneratedTagFile(paths.temporaryTagFilePath);
                // 起動前の検証後に出力先が差し替えられていないか、rename直前にも確認する。
                await assertReplaceableTagFile(paths.tagFilePath, paths.tagSettingPath);
                this.assertNotCancelled(controller.signal);
                await rename(paths.temporaryTagFilePath, paths.tagFilePath);
                temporaryFileWasPromoted = true;
                this.outputChannel.appendLine(`[ctagsProcess:${processIndex}] Updated ${paths.tagFilePath}`);
            } finally {
                stdoutForwarder.flush();
                stderrForwarder.flush();
                stdoutForwarder.dispose();
                stderrForwarder.dispose();
                child.stdin.destroy();
            }
        } finally {
            this.controllers.delete(controller);
            if (!temporaryFileWasPromoted) {
                try {
                    await removeFileIfExists(paths.temporaryTagFilePath);
                } catch (error) {
                    this.outputChannel.appendLine(`[ctagsProcess:${processIndex}] WARN Could not remove temporary file: ${String(error)}`);
                }
            }
        }
    }

    private assertNotCancelled(signal?: AbortSignal): void {
        if (this.cancelled || signal?.aborted === true) {
            throw new CtagsExecutionCancelledError();
        }
    }

    private assertSuccessfulCompletion(
        result: CtagsProcessCompletion,
        timeoutMs: number,
    ): void {
        if (result.stopReason === 'timeout') {
            throw new Error(`ctags timed out after ${timeoutMs} ms.`);
        }
        if (result.stopReason === 'cancelled') {
            throw new CtagsExecutionCancelledError();
        }
        if (result.processError !== undefined) {
            throw new Error(`Unable to start ctags: ${result.processError.message}`);
        }
        if (result.inputError !== undefined && result.exitCode === 0) {
            throw new Error(`Unable to send the file list to ctags: ${result.inputError.message}`);
        }
        if (result.exitCode !== 0) {
            throw new Error(`ctags exited with code ${String(result.exitCode)}${result.signal === null ? '' : ` (${result.signal})`}.`);
        }
    }

    /** ctagsの出力ストリームを行単位で出力チャンネルへ転送します。 */
    private pipeToOutput(stream: Readable, prefix: string): OutputForwarder {
        stream.setEncoding('utf8');
        let pending = '';
        const onData = (chunk: string): void => {
            pending += chunk;
            const lines = pending.split(/\r?\n/u);
            pending = lines.pop() ?? '';
            for (const line of lines) {
                this.outputChannel.appendLine(`${prefix}: ${line}`);
            }
        };
        stream.on('data', onData);
        return {
            flush: () => {
                if (pending.length > 0) {
                    this.outputChannel.appendLine(`${prefix}: ${pending}`);
                    pending = '';
                }
            },
            dispose: () => {
                stream.removeListener('data', onData);
                stream.destroy();
            },
        };
    }
}
