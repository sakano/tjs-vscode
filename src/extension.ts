import * as vscode from 'vscode';

import { activateCommon } from './commonExtension';
import { CTagsSupportProvider } from './ctags';

export function activate(context: vscode.ExtensionContext): void {
    activateCommon(context);

    const ctagsSupportProvider = new CTagsSupportProvider();
    context.subscriptions.push(ctagsSupportProvider);
    context.subscriptions.push(vscode.commands.registerCommand(
        'tjs.updateCtags',
        () => ctagsSupportProvider.updateCtags(),
    ));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        void ctagsSupportProvider.onDidSaveTextDocument(document);
    }));
}
