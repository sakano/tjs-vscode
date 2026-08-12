'use strict';

import * as vscode from 'vscode';

import { ColorProvider } from './colorProvider';
import { ReferenceProvider } from './reference';

/** Node.jsとWebの両extension hostで利用できる機能を登録します。 */
export function activateCommon(context: vscode.ExtensionContext): void {
    const referenceProvider = new ReferenceProvider();
    context.subscriptions.push(vscode.commands.registerCommand(
        'tjs.openReferencePallet',
        () => referenceProvider.openPallet(),
    ));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(
        () => referenceProvider.onDidChangeConfiguration(),
    ));

    context.subscriptions.push(vscode.languages.registerColorProvider(
        { language: 'tjs' },
        new ColorProvider(),
    ));
}
