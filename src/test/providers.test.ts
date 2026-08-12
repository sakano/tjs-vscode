import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { ColorProvider } from '../colorProvider';
import { ReferenceProvider } from '../reference';

suite('Color Provider', () => {
    test('finds RGB and ARGB colors in a TJS document', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'tjs',
            content: '0x1234Ab\n0X80112233',
        });
        const tokenSource = new vscode.CancellationTokenSource();

        try {
            const colors = await new ColorProvider().provideDocumentColors(document, tokenSource.token);
            assert.ok(colors);
            assert.deepEqual(
                colors.map(item => [
                    item.range.start.line,
                    item.range.start.character,
                    item.range.end.line,
                    item.range.end.character,
                    item.color.red,
                    item.color.green,
                    item.color.blue,
                    item.color.alpha,
                ]),
                [
                    [0, 0, 0, 8, 0x12 / 255, 0x34 / 255, 0xab / 255, 1],
                    [1, 0, 1, 10, 0x11 / 255, 0x22 / 255, 0x33 / 255, 0x80 / 255],
                ],
            );
        } finally {
            tokenSource.dispose();
        }
    });

    test('preserves RGB and ARGB notation in color presentations', async () => {
        const document = await vscode.workspace.openTextDocument({
            language: 'tjs',
            content: '0xabcdef 0X80ABCDEF',
        });
        const provider = new ColorProvider();
        const color = new vscode.Color(0x11 / 255, 0x22 / 255, 0xab / 255, 0x80 / 255);
        const tokenSource = new vscode.CancellationTokenSource();

        try {
            const ranges = [new vscode.Range(0, 0, 0, 8), new vscode.Range(0, 9, 0, 19)];
            const labels = await Promise.all(ranges.map(async range => {
                const presentations = await provider.provideColorPresentations(
                    color,
                    { document, range },
                    tokenSource.token,
                );
                assert.ok(presentations);
                return presentations[0].label;
            }));

            assert.deepEqual(labels, ['0x1122ab', '0X801122AB']);
        } finally {
            tokenSource.dispose();
        }
    });
});

suite('Reference Provider', () => {
    test('shows TJS and krkrZ references with the default configuration', async () => {
        let shownItems: readonly vscode.QuickPickItem[] = [];
        const provider = new ReferenceProvider({
            getReferencePalletConfiguration: () => ({
                tjs: true,
                krkrZ: true,
                krkr2: false,
                dll: false,
            }),
            showQuickPick: async items => {
                shownItems = items;
                return undefined;
            },
        });

        await provider.openPallet();

        const descriptions = [...new Set(shownItems.map(item => item.description))].sort();
        assert.deepEqual(descriptions, ['(TJS)', '(krkrZ)'].sort());
    });

    test('reloads reference choices and opens the selected URI once', async () => {
        let configuration: Readonly<Record<string, boolean>> = {
            tjs: true,
            krkrZ: true,
            krkr2: false,
            dll: false,
        };
        let shownItems: readonly vscode.QuickPickItem[] = [];
        const openedUris: vscode.Uri[] = [];
        const provider = new ReferenceProvider({
            getReferencePalletConfiguration: () => configuration,
            showQuickPick: async items => {
                shownItems = items;
                return items.find(item => item.label === 'Window');
            },
            openUri: async uri => {
                openedUris.push(uri);
            },
        });

        configuration = { tjs: false, krkrZ: false, krkr2: true, dll: false };
        provider.onDidChangeConfiguration();
        await provider.openPallet();

        assert.deepEqual([...new Set(shownItems.map(item => item.description))], ['(krkr2)']);
        assert.deepEqual(
            openedUris.map(uri => uri.toString()),
            ['https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Window.html'],
        );
    });
});
