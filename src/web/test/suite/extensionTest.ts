import * as vscode from 'vscode';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

suite('Web Extension Test Suite', () => {
    test('activates in a virtual workspace without registering ctags', async () => {
        assert(vscode.env.uiKind === vscode.UIKind.Web, 'The test is not running in a Web extension host.');

        const extension = vscode.extensions.all.find(
            candidate => candidate.packageJSON.name === 'tjs-vscode',
        );
        assert(extension !== undefined, 'TJS extension was not found.');
        assert(extension.packageJSON.browser === './dist/web/extension.js', 'The Web entry point is not declared.');
        await extension.activate();

        const folder = vscode.workspace.workspaceFolders?.[0];
        assert(folder !== undefined, 'The Web test workspace was not opened.');
        assert(folder.uri.scheme === 'vscode-test-web', `Unexpected Web workspace scheme: ${folder.uri.scheme}`);

        const commands = await vscode.commands.getCommands(true);
        assert(commands.includes('tjs.openReferencePallet'), 'The reference palette command was not registered.');
        assert(!commands.includes('tjs.updateCtags'), 'The Node-only ctags command was registered in the Web extension host.');
    });

    test('provides document colors for a virtual resource', async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        assert(folder !== undefined, 'The Web test workspace was not opened.');

        const document = await vscode.workspace.openTextDocument(
            vscode.Uri.joinPath(folder.uri, 'example.tjs'),
        );
        const colors = await vscode.commands.executeCommand<vscode.ColorInformation[]>(
            'vscode.executeDocumentColorProvider',
            document.uri,
        );

        assert(Array.isArray(colors), 'The document color provider returned no result.');
        assert(colors.length === 1, `Expected one document color, received ${colors.length}.`);
        assert(colors[0].color.alpha === 128 / 255, `Unexpected alpha value: ${colors[0].color.alpha}`);
        assert(colors[0].color.red === 1, `Unexpected red value: ${colors[0].color.red}`);
    });
});
