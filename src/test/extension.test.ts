import * as assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CTagsSupportProvider } from '../ctags';
import {
    activateTestExtension,
    assertTjsLanguageFeatures,
    cleanupTagOutput,
    createDeferred,
    createOutputChannelStub,
    createSuccessfulFakeSpawn,
    getTemporaryTagFiles,
    getTestWorkspaceFolder,
} from './testSupport';

const OLD_TAGS = [
    '!_TAG_FILE_FORMAT\t2\t/extended format/',
    'oldTag\texample.tjs\t/^var oldTag/;"\tv',
    '',
].join('\n');

const NEW_TAGS = [
    '!_TAG_FILE_FORMAT\t2\t/extended format/',
    'newTag\texample.tjs\t/^var newTag/;"\tv',
    '',
].join('\n');

suite('Extension Test Suite', () => {
    // セキュリティ変更後も拡張機能が正常に起動し、公開コマンドを登録できることを確認する。
    test('activates and registers its commands', async () => {
        await activateTestExtension();

        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('tjs.updateCtags'));
        assert.ok(commands.includes('tjs.openReferencePallet'));
    });

    // .tjsの言語登録と、言語設定に定義されたregion折りたたみの通常動作を確認する。
    test('recognizes TJS documents and provides region folding ranges', async () => {
        const folder = getTestWorkspaceFolder(true);
        await assertTjsLanguageFeatures(folder);
    });

    // 実際の更新経路でシェル非使用・引数のリテラル性・タグファイルの原子的置換をまとめて検証する。
    test('generates a tag file atomically without invoking a shell', async () => {
        const folder = getTestWorkspaceFolder(true);
        const tagFilePath = path.join(folder.uri.fsPath, '.test-output.tags');
        const logLines: string[] = [];
        let targetContentsDuringCtags: string | undefined;
        let spawnedCommand: string | undefined;
        let spawnedArguments: readonly string[] | undefined;
        let spawnedOptions: import('node:child_process').SpawnOptions | undefined;

        const fakeSpawn = createSuccessfulFakeSpawn(NEW_TAGS, async ({ command, args, options }) => {
            spawnedCommand = command;
            spawnedArguments = args;
            spawnedOptions = options;

            // ctags完了までは既存タグを残し、生成物は指定された一時ファイルだけに書き込む。
            targetContentsDuringCtags = await readFile(tagFilePath, 'utf8');
        });

        await writeFile(tagFilePath, OLD_TAGS, 'utf8');
        const provider = new CTagsSupportProvider({
            outputChannel: createOutputChannelStub(logLines),
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
            assert.equal(targetContentsDuringCtags, OLD_TAGS);
            assert.equal(await readFile(tagFilePath, 'utf8'), NEW_TAGS);
            assert.ok(logLines.some(line => line.includes('stdout: generated tags')));
            assert.ok(logLines.some(line => line.includes('stderr: diagnostic output')));

            // 原子的置換のために作った一時ファイルを正常終了後に残さない。
            assert.deepEqual(await getTemporaryTagFiles(tagFilePath), []);
        } finally {
            provider.dispose();
            await cleanupTagOutput(tagFilePath);
        }
    });

    // tagFilePathの誤設定で既存の通常ファイルを指定しても、ctagsを起動せず内容を保持する。
    test('refuses to overwrite an existing non-tag file', async () => {
        const folder = getTestWorkspaceFolder(true);
        const tagFilePath = path.join(folder.uri.fsPath, '.test-output.tags');
        const originalContents = '{"name":"must-survive"}\n';
        const logLines: string[] = [];
        let spawnCallCount = 0;
        const provider = new CTagsSupportProvider({
            outputChannel: createOutputChannelStub(logLines),
            spawnProcess: createSuccessfulFakeSpawn(NEW_TAGS, () => {
                spawnCallCount++;
            }),
        });

        await writeFile(tagFilePath, originalContents, 'utf8');
        try {
            await provider.updateCtags(true, folder);

            assert.equal(spawnCallCount, 0);
            assert.equal(await readFile(tagFilePath, 'utf8'), originalContents);
            assert.ok(logLines.some(line => line.includes('does not look like a tag file')));
        } finally {
            provider.dispose();
            await cleanupTagOutput(tagFilePath);
        }
    });

    // ctags実行中に出力先が非タグファイルへ変わった場合、生成済み一時ファイルを昇格させない。
    test('rechecks the target before promoting generated tags', async () => {
        const folder = getTestWorkspaceFolder(true);
        const tagFilePath = path.join(folder.uri.fsPath, '.test-output.tags');
        const replacementContents = '{"changed":"while-ctags-ran"}\n';
        const logLines: string[] = [];
        let spawnCallCount = 0;
        const provider = new CTagsSupportProvider({
            outputChannel: createOutputChannelStub(logLines),
            spawnProcess: createSuccessfulFakeSpawn(NEW_TAGS, async () => {
                spawnCallCount++;
                await writeFile(tagFilePath, replacementContents, 'utf8');
            }),
        });

        await writeFile(tagFilePath, OLD_TAGS, 'utf8');
        try {
            await provider.updateCtags(true, folder);

            assert.equal(spawnCallCount, 1);
            assert.equal(await readFile(tagFilePath, 'utf8'), replacementContents);
            assert.ok(logLines.some(line => line.includes('does not look like a tag file')));
            assert.deepEqual(await getTemporaryTagFiles(tagFilePath), []);
        } finally {
            provider.dispose();
            await cleanupTagOutput(tagFilePath);
        }
    });

    // ctags本体と同じく、0バイトファイルとEtagsファイルは既存出力先として許可する。
    test('accepts empty and Etags output targets', async () => {
        const folder = getTestWorkspaceFolder(true);
        const tagFilePath = path.join(folder.uri.fsPath, '.test-output.tags');
        let spawnCallCount = 0;
        const provider = new CTagsSupportProvider({
            outputChannel: createOutputChannelStub(),
            spawnProcess: createSuccessfulFakeSpawn(NEW_TAGS, () => {
                spawnCallCount++;
            }),
        });

        try {
            for (const existingContents of ['', '\f\n']) {
                await writeFile(tagFilePath, existingContents, 'latin1');
                await provider.updateCtags(true, folder);
                assert.equal(await readFile(tagFilePath, 'utf8'), NEW_TAGS);
            }
            assert.equal(spawnCallCount, 2);
        } finally {
            provider.dispose();
            await cleanupTagOutput(tagFilePath);
        }
    });

    // 保存されたTJS文書から、runOnSaveが有効なctagsプロセスを一度だけ実行する。
    test('runs enabled ctags process after saving a TJS document', async () => {
        const folder = getTestWorkspaceFolder(true);
        const tagFilePath = path.join(folder.uri.fsPath, '.test-output.tags');
        const document = await vscode.workspace.openTextDocument(
            vscode.Uri.joinPath(folder.uri, 'example.tjs'),
        );
        const configuration = vscode.workspace.getConfiguration('tjs', folder.uri);
        const configuredProcesses = configuration.get<readonly { runOnSave?: boolean }[]>('ctagsProcess');
        assert.equal(configuredProcesses?.filter(process => process.runOnSave).length, 1);
        let spawnCallCount = 0;
        const provider = new CTagsSupportProvider({
            outputChannel: createOutputChannelStub(),
            spawnProcess: createSuccessfulFakeSpawn(NEW_TAGS, () => {
                spawnCallCount += 1;
            }),
        });

        try {
            await provider.onDidSaveTextDocument(document);

            assert.equal(spawnCallCount, 1);
            assert.equal(await readFile(tagFilePath, 'utf8'), NEW_TAGS);
        } finally {
            provider.dispose();
            await cleanupTagOutput(tagFilePath);
        }
    });

    // 同じタグへの連続更新は同時実行せず、実行待ちの同一設定を最新の一回へ集約する。
    test('serializes and coalesces overlapping updates for one tag file', async () => {
        const folder = getTestWorkspaceFolder(true);
        const tagFilePath = path.join(folder.uri.fsPath, '.test-output.tags');
        const firstStarted = createDeferred();
        const releaseFirst = createDeferred();
        let spawnCallCount = 0;
        const provider = new CTagsSupportProvider({
            outputChannel: createOutputChannelStub(),
            spawnProcess: createSuccessfulFakeSpawn(NEW_TAGS, async () => {
                spawnCallCount++;
                if (spawnCallCount === 1) {
                    firstStarted.resolve();
                    await releaseFirst.promise;
                    return OLD_TAGS;
                }
                return NEW_TAGS;
            }),
        });

        await cleanupTagOutput(tagFilePath);
        try {
            const first = provider.updateCtags(true, folder);
            const replaced = provider.updateCtags(true, folder);
            const latest = provider.updateCtags(true, folder);

            await firstStarted.promise;
            assert.equal(spawnCallCount, 1);
            releaseFirst.resolve();
            await Promise.all([first, replaced, latest]);

            assert.equal(spawnCallCount, 2);
            assert.equal(await readFile(tagFilePath, 'utf8'), NEW_TAGS);
        } finally {
            provider.dispose();
            releaseFirst.resolve();
            await cleanupTagOutput(tagFilePath);
        }
    });

    // provider破棄後は、同じタグへの実行待ち要求から新しいctagsを起動しない。
    test('cancels a queued update when the provider is disposed', async () => {
        const folder = getTestWorkspaceFolder(true);
        const tagFilePath = path.join(folder.uri.fsPath, '.test-output.tags');
        const firstStarted = createDeferred();
        const releaseFirst = createDeferred();
        let spawnCallCount = 0;
        const provider = new CTagsSupportProvider({
            outputChannel: createOutputChannelStub(),
            spawnProcess: createSuccessfulFakeSpawn(NEW_TAGS, async () => {
                spawnCallCount++;
                if (spawnCallCount === 1) {
                    firstStarted.resolve();
                    await releaseFirst.promise;
                }
            }),
        });

        await cleanupTagOutput(tagFilePath);
        try {
            const running = provider.updateCtags(true, folder);
            const queued = provider.updateCtags(true, folder);

            await firstStarted.promise;
            provider.dispose();
            releaseFirst.resolve();
            await Promise.all([running, queued]);

            assert.equal(spawnCallCount, 1);
        } finally {
            provider.dispose();
            releaseFirst.resolve();
            await cleanupTagOutput(tagFilePath);
        }
    });

    // コマンドのenablementを迂回されても、Virtual WorkspaceのURIをNode.jsのfsへ渡さない。
    test('blocks ctags execution for a virtual workspace folder', async () => {
        let spawnWasCalled = false;
        const logLines: string[] = [];
        const provider = new CTagsSupportProvider({
            outputChannel: createOutputChannelStub(logLines),
            spawnProcess: () => {
                spawnWasCalled = true;
                throw new Error('spawn must not be called for a virtual workspace');
            },
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
});
