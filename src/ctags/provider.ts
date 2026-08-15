import type { spawn } from 'node:child_process';
import * as vscode from 'vscode';

import { CoalescingTaskQueue } from '../coalescingTaskQueue';
import {
    parseCtagsProcesses,
    parseRunOnSaveLanguages,
    type ConfigurationDiagnostic,
    type CtagsProcessConfiguration,
} from './configuration';
import { resolveCtagsPaths } from './paths';
import {
    CtagsExecutionCancelledError,
    CtagsProcessExecutor,
} from './process';

type CTagsSupportProviderOptions = {
    outputChannel?: vscode.OutputChannel;
    spawnProcess?: typeof spawn;
    isWorkspaceTrusted?: () => boolean;
};

/** ctagsインデックスを更新するProviderです。 */
export class CTagsSupportProvider implements vscode.Disposable {
    private readonly outputChannel: vscode.OutputChannel;
    private readonly ownsOutputChannel: boolean;
    private readonly isWorkspaceTrusted: () => boolean;
    private readonly executionQueue = new CoalescingTaskQueue();
    private readonly processExecutor: CtagsProcessExecutor;
    private disposed = false;

    public constructor(options: CTagsSupportProviderOptions = {}) {
        this.outputChannel = options.outputChannel ?? vscode.window.createOutputChannel('TJS Ctags');
        this.ownsOutputChannel = options.outputChannel === undefined;
        this.isWorkspaceTrusted = options.isWorkspaceTrusted ?? (() => vscode.workspace.isTrusted);
        this.processExecutor = new CtagsProcessExecutor(this.outputChannel, options.spawnProcess);
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.executionQueue.cancelPending(new CtagsExecutionCancelledError());
        this.processExecutor.cancelAll();
        if (this.ownsOutputChannel) {
            void this.executionQueue.whenIdle().then(() => {
                this.outputChannel.dispose();
            });
        }
    }

    /** 対象フォルダーに設定されたctagsプロセスを実行します。 */
    public async updateCtags(save = false, folder?: vscode.WorkspaceFolder): Promise<void> {
        if (this.disposed) {
            return;
        }
        if (!this.isWorkspaceTrusted()) {
            this.outputChannel.appendLine('[trust] Ctags execution was blocked because the workspace is not trusted.');
            if (!save) {
                void vscode.window.showWarningMessage('TJS ctags is disabled in Restricted Mode. Trust this workspace before running ctags.');
            }
            return;
        }

        const targetFolder = folder ?? await this.selectWorkspaceFolder();
        if (this.disposed) {
            return;
        }
        if (targetFolder === undefined) {
            if (!save) {
                this.notifyError('No supported workspace folder is currently open.');
            }
            return;
        }
        if (!this.isSupportedWorkspaceFolder(targetFolder)) {
            this.outputChannel.appendLine(`[workspace] Ctags execution was blocked for unsupported URI scheme ${JSON.stringify(targetFolder.uri.scheme)}.`);
            if (!save) {
                this.notifyError('Ctags requires a local or VS Code Remote workspace folder.');
            }
            return;
        }

        const configuration = vscode.workspace.getConfiguration('tjs', targetFolder.uri);
        const parsedConfiguration = parseCtagsProcesses(configuration.get<unknown>('ctagsProcess'));
        this.reportConfigurationDiagnostics(parsedConfiguration.diagnostics, !save);

        const runnableProcesses = parsedConfiguration.processes
            .filter(({ configuration: processConfiguration }) => !save || processConfiguration.runOnSave);
        const results = await Promise.allSettled(
            runnableProcesses.map(async ({ configuration: processConfiguration, index }) => {
                await this.scheduleProcess(targetFolder, processConfiguration, index);
            }),
        );

        results.forEach((result, resultIndex) => {
            if (result.status === 'fulfilled') {
                return;
            }
            const processConfiguration = runnableProcesses[resultIndex];
            if (processConfiguration !== undefined) {
                this.reportProcessFailure(processConfiguration.index, result.reason, save);
            }
        });
    }

    /** 保存文書の言語とワークスペースを確認し、該当するctags更新を開始します。 */
    public async onDidSaveTextDocument(document: vscode.TextDocument): Promise<void> {
        if (this.disposed || !this.isWorkspaceTrusted()) {
            return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (folder === undefined || !this.isSupportedWorkspaceFolder(folder)) {
            return;
        }

        try {
            const languages = parseRunOnSaveLanguages(
                vscode.workspace.getConfiguration('tjs', folder.uri).get<unknown>('ctagsRunOnSaveLanguages'),
            );
            if (languages.includes(document.languageId)) {
                await this.updateCtags(true, folder);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`[configuration] ERROR ${message}`);
        }
    }

    private isSupportedWorkspaceFolder(folder: vscode.WorkspaceFolder): boolean {
        return folder.uri.scheme === 'file'
            || (folder.uri.scheme === 'vscode-remote' && vscode.env.remoteName !== undefined);
    }

    private async selectWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
        const activeDocument = vscode.window.activeTextEditor?.document;
        if (activeDocument !== undefined) {
            const activeFolder = vscode.workspace.getWorkspaceFolder(activeDocument.uri);
            if (activeFolder !== undefined && this.isSupportedWorkspaceFolder(activeFolder)) {
                return activeFolder;
            }
        }

        const supportedFolders = (vscode.workspace.workspaceFolders ?? [])
            .filter(folder => this.isSupportedWorkspaceFolder(folder));
        if (supportedFolders.length === 1) {
            return supportedFolders[0];
        }
        if (supportedFolders.length === 0) {
            return undefined;
        }

        const selection = await vscode.window.showQuickPick(
            supportedFolders.map(folder => ({
                label: folder.name,
                description: folder.uri.toString(),
                folder,
            })),
            { placeHolder: 'Select the workspace folder whose ctags index should be updated.' },
        );
        return selection?.folder;
    }

    private reportConfigurationDiagnostics(
        diagnostics: readonly ConfigurationDiagnostic[],
        interactive: boolean,
    ): void {
        for (const diagnostic of diagnostics) {
            this.outputChannel.appendLine(`[configuration] ${diagnostic.severity.toUpperCase()} ${diagnostic.message}`);
            if (interactive) {
                if (diagnostic.severity === 'error') {
                    this.notifyError(diagnostic.message);
                } else {
                    void vscode.window.showWarningMessage(diagnostic.message);
                }
            }
        }
    }

    private reportProcessFailure(processIndex: number, error: unknown, save: boolean): void {
        if (this.disposed && error instanceof CtagsExecutionCancelledError) {
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[ctagsProcess:${processIndex}] ERROR ${message}`);
        if (!save) {
            this.notifyError(`ctagsProcess[${processIndex}] failed: ${message}`);
        }
    }

    private notifyError(message: string): void {
        void vscode.window.showErrorMessage(message, 'Show Output').then(selection => {
            if (selection === 'Show Output') {
                this.outputChannel.show(true);
            }
        });
    }

    /** 同じタグ出力先に対する実行を直列化し、同じ待機中の設定を最新版へ集約します。 */
    private scheduleProcess(
        folder: vscode.WorkspaceFolder,
        configuration: CtagsProcessConfiguration,
        processIndex: number,
    ): Promise<void> {
        const paths = resolveCtagsPaths(folder, configuration, processIndex);
        const resourceKey = process.platform === 'win32'
            ? paths.tagFilePath.toLowerCase()
            : paths.tagFilePath;
        const taskKey = `${folder.uri.toString()}\0${processIndex}`;

        return this.executionQueue.enqueue(resourceKey, taskKey, async () => {
            if (this.disposed) {
                throw new CtagsExecutionCancelledError();
            }
            await this.processExecutor.execute(folder, configuration, processIndex);
        });
    }
}
