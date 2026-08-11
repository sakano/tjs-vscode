import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
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
});
