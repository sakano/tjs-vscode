import {
    spawn,
    type ChildProcessWithoutNullStreams,
    type SpawnOptions,
} from 'node:child_process';
import { rename } from 'node:fs/promises';
import type { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type * as vscode from 'vscode';

import type { CtagsProcessConfiguration } from './configuration';
import {
    assertGeneratedTagFile,
    assertReplaceableTagFile,
    getNonRecursiveInputFileLines,
    prepareCtagsPaths,
    removeFileIfExists,
} from './paths';

const FORCED_TERMINATION_WAIT_MS = 2_000;

export type CtagsOutputLimits = Readonly<{
    maxLineBytes: number;
    maxTotalBytes: number;
    maxLines: number;
}>;

/** ctagsの診断出力がextension hostを圧迫しないためのstream単位の固定上限です。 */
export const DEFAULT_CTAGS_OUTPUT_LIMITS: CtagsOutputLimits = {
    maxLineBytes: 64 * 1_024,
    maxTotalBytes: 1_024 * 1_024,
    maxLines: 4_096,
};

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
    readonly failure: CtagsOutputLimitError | undefined;
    flush(): void;
    dispose(): void;
};

type CtagsOutputStreamName = 'stdout' | 'stderr';

export class CtagsOutputLimitError extends Error {
    public constructor(streamName: CtagsOutputStreamName, limitDescription: string) {
        super(`ctags ${streamName} exceeded the ${limitDescription}; output was truncated and the process was terminated.`);
        this.name = 'CtagsOutputLimitError';
    }
}

/**
 * ctagsの出力を有限のBufferで行単位に転送します。
 *
 * byte数はUTF-16文字数ではなくchild processから受け取った生のbyte数で数えます。
 */
export function createCtagsOutputForwarder(
    stream: Readable,
    outputChannel: vscode.OutputChannel,
    prefix: string,
    streamName: CtagsOutputStreamName,
    onLimitExceeded: (error: CtagsOutputLimitError) => void,
    limits: CtagsOutputLimits = DEFAULT_CTAGS_OUTPUT_LIMITS,
): OutputForwarder {
    const pending = Buffer.allocUnsafe(limits.maxLineBytes);
    let pendingBytes = 0;
    let totalBytes = 0;
    let lineCount = 0;
    let failure: CtagsOutputLimitError | undefined;
    let disposed = false;

    const appendPendingLine = (
        truncated: boolean,
        stripTrailingCarriageReturn: boolean,
    ): void => {
        let lineBytes = pendingBytes;
        if (stripTrailingCarriageReturn && lineBytes > 0 && pending[lineBytes - 1] === 0x0d) {
            lineBytes--;
        }
        const suffix = truncated ? '… [truncated]' : '';
        outputChannel.appendLine(`${prefix}: ${pending.subarray(0, lineBytes).toString('utf8')}${suffix}`);
        pendingBytes = 0;
        lineCount++;
    };

    const fail = (error: CtagsOutputLimitError, truncatePending: boolean): void => {
        if (failure !== undefined) {
            return;
        }
        failure = error;
        if (truncatePending && pendingBytes > 0) {
            appendPendingLine(true, false);
        }
        onLimitExceeded(error);
    };

    const failLineCount = (): void => {
        fail(
            new CtagsOutputLimitError(streamName, `${String(limits.maxLines)}-line output limit`),
            false,
        );
    };

    const processAcceptedBytes = (chunk: Buffer): void => {
        let offset = 0;
        while (offset < chunk.length && failure === undefined) {
            const newlineIndex = chunk.indexOf(0x0a, offset);
            const segmentEnd = newlineIndex < 0 ? chunk.length : newlineIndex;
            const segmentBytes = segmentEnd - offset;

            if (lineCount >= limits.maxLines && (segmentBytes > 0 || newlineIndex >= 0)) {
                failLineCount();
                return;
            }

            const availableLineBytes = limits.maxLineBytes - pendingBytes;
            if (segmentBytes > availableLineBytes) {
                if (availableLineBytes > 0) {
                    chunk.copy(pending, pendingBytes, offset, offset + availableLineBytes);
                    pendingBytes += availableLineBytes;
                }
                fail(
                    new CtagsOutputLimitError(
                        streamName,
                        `${String(limits.maxLineBytes)}-byte line limit`,
                    ),
                    true,
                );
                return;
            }

            if (segmentBytes > 0) {
                chunk.copy(pending, pendingBytes, offset, segmentEnd);
                pendingBytes += segmentBytes;
            }
            if (newlineIndex < 0) {
                return;
            }

            appendPendingLine(false, true);
            offset = newlineIndex + 1;
        }
    };

    const onData = (rawChunk: Buffer | string): void => {
        if (disposed || failure !== undefined) {
            return;
        }
        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk, 'utf8');
        const remainingBytes = limits.maxTotalBytes - totalBytes;
        const acceptedBytes = Math.min(chunk.length, Math.max(remainingBytes, 0));
        if (acceptedBytes > 0) {
            totalBytes += acceptedBytes;
            processAcceptedBytes(chunk.subarray(0, acceptedBytes));
        }
        if (failure === undefined && acceptedBytes < chunk.length) {
            fail(
                new CtagsOutputLimitError(
                    streamName,
                    `${String(limits.maxTotalBytes)}-byte output limit`,
                ),
                true,
            );
        }
    };

    stream.on('data', onData);
    return {
        get failure(): CtagsOutputLimitError | undefined {
            return failure;
        },
        flush: () => {
            if (!disposed && failure === undefined && pendingBytes > 0) {
                appendPendingLine(false, false);
            }
        },
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;
            stream.removeListener('data', onData);
            stream.destroy();
        },
    };
}

/** 形式検証済みの設定から、ctagsへ直接渡す引数配列を構築します。 */
export function buildCtagsArguments(
    configuration: CtagsProcessConfiguration,
    temporaryTagFilePath: string,
    searchPath: string,
): string[] {
    const argumentsList = [
        // ctagsの設定ファイルがcwdなどから暗黙に読み込まれないよう、必ず先頭に置く。
        '--options=NONE',
        '--langdef=tjs',
        `--langmap=tjs:${configuration.fileExtensions.join('')}`,
        ...TJS_REGEX_ARGS,
        '--languages=tjs',
        ...configuration.extraArgs,
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

/** 非再帰検索の入力ファイルを、backpressureに従ってctagsへ逐次送信します。 */
export function writeNonRecursiveInputFiles(
    searchPath: string,
    input: Writable,
    signal: AbortSignal,
): Promise<void> {
    return pipeline(
        getNonRecursiveInputFileLines(searchPath, signal),
        input,
        { signal },
    );
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
            let outputFailure: CtagsOutputLimitError | undefined;
            const onOutputLimitExceeded = (error: CtagsOutputLimitError): void => {
                // timeoutやdisposeが先に中断した場合は、その終了理由を上書きしない。
                if (outputFailure !== undefined || controller.signal.aborted) {
                    return;
                }
                outputFailure = error;
                this.outputChannel.appendLine(`[ctagsProcess:${processIndex}] WARN ${error.message}`);
                controller.abort(error);
            };
            const stdoutForwarder = createCtagsOutputForwarder(
                child.stdout,
                this.outputChannel,
                `[ctagsProcess:${processIndex}] stdout`,
                'stdout',
                onOutputLimitExceeded,
            );
            const stderrForwarder = createCtagsOutputForwarder(
                child.stderr,
                this.outputChannel,
                `[ctagsProcess:${processIndex}] stderr`,
                'stderr',
                onOutputLimitExceeded,
            );

            try {
                const completion = waitForCtagsProcess(child, controller, configuration.timeoutMs);
                let inputFailure: Error | undefined;

                if (configuration.searchRecursive) {
                    child.stdin.end();
                } else {
                    try {
                        await writeNonRecursiveInputFiles(
                            paths.searchPath,
                            child.stdin,
                            controller.signal,
                        );
                    } catch (error) {
                        // pipelineはstdinを破棄するため、ctagsの終了を確認してから
                        // 入力側の失敗を報告し、一時ファイルを安全に削除する。
                        inputFailure = error instanceof Error ? error : new Error(String(error));
                    }
                }

                const result = await completion;
                stdoutForwarder.flush();
                stderrForwarder.flush();
                if (outputFailure !== undefined) {
                    throw outputFailure;
                }
                this.assertSuccessfulCompletion(result, configuration.timeoutMs);
                if (inputFailure !== undefined) {
                    throw inputFailure;
                }

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

}
