import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { CTagsSupportProvider } from '../ctags';
import {
    activateTestExtension,
    assertTjsLanguageFeatures,
    createOutputChannelStub,
    getTestWorkspaceFolder,
} from './testSupport';

suite('Untrusted workspace', () => {
    test('activates and registers its commands', async () => {
        getTestWorkspaceFolder(false);
        await activateTestExtension();

        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('tjs.updateCtags'));
        assert.ok(commands.includes('tjs.openReferencePallet'));
    });

    test('keeps common language features available', async () => {
        const folder = getTestWorkspaceFolder(false);
        await assertTjsLanguageFeatures(folder);
    });

    // Restricted Modeでは設定内容にかかわらず、ctagsプロセスを一度も起動しないことを保証する。
    test('blocks ctags execution', async () => {
        getTestWorkspaceFolder(false);
        let spawnWasCalled = false;
        const provider = new CTagsSupportProvider({
            outputChannel: createOutputChannelStub(),
            spawnProcess: () => {
                spawnWasCalled = true;
                throw new Error('spawn must not be called in an untrusted workspace');
            },
        });

        try {
            await provider.updateCtags(true);
            assert.equal(spawnWasCalled, false);
        } finally {
            provider.dispose();
        }
    });

    // 未信頼ワークスペースのsettings.jsonから危険なctags設定が拡張機能へ渡らないことを確認する。
    test('hides restricted ctags settings from the extension', () => {
        const folder = getTestWorkspaceFolder(false);
        const processes = vscode.workspace
            .getConfiguration('tjs', folder.uri)
            .get<Array<{ tagFilePath?: string }>>('ctagsProcess');

        assert.notEqual(processes?.[0]?.tagFilePath, '../outside.tags');
    });
});
