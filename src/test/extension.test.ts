import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import * as vscode from 'vscode';
import { CTagsSupportProvider } from '../ctags';

interface FakeSpawnInvocation {
    command: string;
    args: readonly string[];
    options: import('node:child_process').SpawnOptions;
}

function createSuccessfulFakeSpawn(
    onInvocation?: (invocation: FakeSpawnInvocation) => void | Promise<void>,
): typeof import('node:child_process').spawn {
    return ((
        command: string,
        args: readonly string[],
        options: import('node:child_process').SpawnOptions,
    ) => {
        const child = new EventEmitter() as EventEmitter & {
            stdin: PassThrough;
            stdout: PassThrough;
            stderr: PassThrough;
        };
        child.stdin = new PassThrough();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();

        queueMicrotask(() => {
            void (async () => {
                await onInvocation?.({ command, args, options });
                const outputOptionIndex = args.indexOf('-f');
                const temporaryTagFilePath = args[outputOptionIndex + 1];
                if (outputOptionIndex < 0 || temporaryTagFilePath === undefined) {
                    throw new Error('ctags output path was not provided');
                }
                await writeFile(temporaryTagFilePath, 'new tags\n', 'utf8');
                child.stdout.end('generated tags\n');
                child.stderr.end('diagnostic output\n');
                child.emit('close', 0, null);
            })().catch(error => {
                child.emit('error', error);
                child.emit('close', 1, null);
            });
        });
        return child;
    }) as unknown as typeof import('node:child_process').spawn;
}

suite('Extension Test Suite', () => {
    // セキュリティ変更後も拡張機能が正常に起動し、公開コマンドを登録できることを確認する。
    test('activates and registers its commands', async () => {
        const extension = vscode.extensions.all.find(
            candidate => candidate.packageJSON.name === 'tjs-vscode'
        );

        assert.ok(extension, 'TJS extension was not found');
        await extension.activate();

        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('tjs.updateCtags'));
        assert.ok(commands.includes('tjs.openReferencePallet'));
    });

    // .tjsの言語登録と、言語設定に定義されたregion折りたたみの通常動作を確認する。
    test('recognizes TJS documents and provides region folding ranges', async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(folder, 'The test workspace was not opened');
        const fixtureDocument = await vscode.workspace.openTextDocument(
            vscode.Uri.joinPath(folder.uri, 'example.tjs'),
        );

        assert.equal(fixtureDocument.languageId, 'tjs');

        const foldingDocument = await vscode.workspace.openTextDocument({
            language: fixtureDocument.languageId,
            content: '//#region Example\nvar value = 1;\n//#endregion\n',
        });
        const foldingRanges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
            'vscode.executeFoldingRangeProvider',
            foldingDocument.uri,
        );
        const region = foldingRanges?.find(range => range.start === 0 && range.end === 2);

        assert.ok(region, 'A region folding range was not provided');
    });

    // 実際の更新経路でシェル非使用・引数のリテラル性・タグファイルの原子的置換をまとめて検証する。
    test('generates a tag file atomically without invoking a shell', async function () {
        if (!vscode.workspace.isTrusted) {
            this.skip();
        }

        const folder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(folder, 'The trusted test workspace was not opened');
        const tagFilePath = path.join(folder.uri.fsPath, '.test-output.tags');
        const logLines: string[] = [];
        let targetContentsDuringCtags: string | undefined;
        let spawnedCommand: string | undefined;
        let spawnedArguments: readonly string[] | undefined;
        let spawnedOptions: import('node:child_process').SpawnOptions | undefined;

        const fakeSpawn = createSuccessfulFakeSpawn(async ({ command, args, options }) => {
            spawnedCommand = command;
            spawnedArguments = args;
            spawnedOptions = options;

            // ctags完了までは既存タグを残し、生成物は指定された一時ファイルだけに書き込む。
            targetContentsDuringCtags = await readFile(tagFilePath, 'utf8');
        });

        await writeFile(tagFilePath, 'old tags\n', 'utf8');
        const provider = new CTagsSupportProvider({
            outputChannel: {
                appendLine: (line: string) => logLines.push(line),
            } as unknown as vscode.OutputChannel,
            spawnProcess: fakeSpawn,
        });

        try {
            await provider.updateCtags(false, folder);

            // メタ文字を含む設定値がシェル命令にならず、そのまま一引数で渡されることを確認する。
            assert.equal(spawnedCommand, 'ctags');
            assert.equal(spawnedOptions?.shell, false);
            assert.equal(spawnedOptions?.windowsHide, true);
            assert.ok(spawnedArguments?.includes('--exclude=folder;literal'));

            // 成功後にだけ新しいタグへ切り替わり、標準出力・標準エラーも診断ログに残ることを確認する。
            assert.equal(targetContentsDuringCtags, 'old tags\n');
            assert.equal(await readFile(tagFilePath, 'utf8'), 'new tags\n');
            assert.ok(logLines.some(line => line.includes('stdout: generated tags')));
            assert.ok(logLines.some(line => line.includes('stderr: diagnostic output')));

            // 原子的置換のために作った一時ファイルを正常終了後に残さない。
            const remainingTemporaryFiles = (await readdir(folder.uri.fsPath))
                .filter(fileName => fileName.startsWith('..test-output.tags.tjs-ctags-'));
            assert.deepEqual(remainingTemporaryFiles, []);
        } finally {
            provider.dispose();
            await unlink(tagFilePath).catch(() => undefined);
        }
    });

    // 保存されたTJS文書から、runOnSaveが有効なctagsプロセスを一度だけ実行する。
    test('runs enabled ctags process after saving a TJS document', async function () {
        if (!vscode.workspace.isTrusted) {
            this.skip();
        }

        const folder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(folder, 'The trusted test workspace was not opened');
        const tagFilePath = path.join(folder.uri.fsPath, '.test-output.tags');
        const document = await vscode.workspace.openTextDocument(
            vscode.Uri.joinPath(folder.uri, 'example.tjs'),
        );
        const configuration = vscode.workspace.getConfiguration('tjs', folder.uri);
        const configuredProcesses = configuration.get<readonly { runOnSave?: boolean }[]>('ctagsProcess');
        assert.equal(configuredProcesses?.filter(process => process.runOnSave).length, 1);
        let spawnCallCount = 0;
        const provider = new CTagsSupportProvider({
            outputChannel: {
                appendLine: () => undefined,
            } as unknown as vscode.OutputChannel,
            spawnProcess: createSuccessfulFakeSpawn(() => {
                spawnCallCount += 1;
            }),
        });

        try {
            await provider.onDidSaveTextDocument(document);

            assert.equal(spawnCallCount, 1);
            assert.equal(await readFile(tagFilePath, 'utf8'), 'new tags\n');
        } finally {
            provider.dispose();
            await unlink(tagFilePath).catch(() => undefined);
        }
    });

    // Restricted Modeでは設定内容にかかわらず、ctagsプロセスを一度も起動しないことを保証する。
    test('blocks ctags execution in an untrusted workspace', async function () {
        if (vscode.workspace.isTrusted) {
            this.skip();
        }

        let spawnWasCalled = false;
        const provider = new CTagsSupportProvider({
            outputChannel: {
                appendLine: () => undefined,
            } as unknown as vscode.OutputChannel,
            spawnProcess: (() => {
                spawnWasCalled = true;
                throw new Error('spawn must not be called in an untrusted workspace');
            }) as typeof import('node:child_process').spawn,
        });

        try {
            await provider.updateCtags(true);
            assert.equal(spawnWasCalled, false);
        } finally {
            provider.dispose();
        }
    });

    // コマンドのenablementを迂回されても、Virtual WorkspaceのURIをNode.jsのfsへ渡さない。
    test('blocks ctags execution for a virtual workspace folder', async () => {
        let spawnWasCalled = false;
        const logLines: string[] = [];
        const provider = new CTagsSupportProvider({
            outputChannel: {
                appendLine: (line: string) => logLines.push(line),
            } as unknown as vscode.OutputChannel,
            spawnProcess: (() => {
                spawnWasCalled = true;
                throw new Error('spawn must not be called for a virtual workspace');
            }) as typeof import('node:child_process').spawn,
            isWorkspaceTrusted: () => true,
        });
        const virtualFolder: vscode.WorkspaceFolder = {
            index: 0,
            name: 'virtual',
            uri: vscode.Uri.parse('vscode-vfs://github/example/repository'),
        };

        try {
            await provider.updateCtags(true, virtualFolder);
            assert.equal(spawnWasCalled, false);
            assert.ok(logLines.some(line => line.includes('unsupported URI scheme')));
        } finally {
            provider.dispose();
        }
    });

    // 未信頼ワークスペースのsettings.jsonから危険なctags設定が拡張機能へ渡らないことを確認する。
    test('hides restricted workspace ctags settings from the extension', function () {
        if (vscode.workspace.isTrusted) {
            this.skip();
        }

        const folder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(folder, 'The untrusted test workspace was not opened');
        const processes = vscode.workspace
            .getConfiguration('tjs', folder.uri)
            .get<Array<{ tagFilePath?: string }>>('ctagsProcess');

        assert.notEqual(processes?.[0]?.tagFilePath, '../outside.tags');
    });
});
