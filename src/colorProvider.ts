import * as vscode from 'vscode';

function parseHexChannel(value: string, offset: number): number {
    return Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
}

function formatColorChannel(value: number): string {
    return Math.round(value * 255).toString(16).padStart(2, '0');
}

export class ColorProvider implements vscode.DocumentColorProvider {
    provideDocumentColors(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.ColorInformation[]> {
        const colors: vscode.ColorInformation[] = [];
        const regex = /\b0[xX][0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/g;

        for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
            if (token.isCancellationRequested) {
                return undefined;
            }
            const line = document.lineAt(lineNumber);
            if (line.isEmptyOrWhitespace) {
                continue;
            }
            const text = line.text;

            let match: RegExpExecArray | null;
            while ((match = regex.exec(text)) !== null) {
                const value = match[0].slice(2);
                const channelOffset = value.length === 8 ? 2 : 0;

                const color = new vscode.ColorInformation(
                    new vscode.Range(lineNumber, match.index, lineNumber, match.index + match[0].length),
                    new vscode.Color(
                        parseHexChannel(value, channelOffset),
                        parseHexChannel(value, channelOffset + 2),
                        parseHexChannel(value, channelOffset + 4),
                        channelOffset === 0 ? 1 : parseHexChannel(value, 0),
                    )
                );
                colors.push(color);
            }
        }

        return colors;
    }

    provideColorPresentations(color: vscode.Color, context: { document: vscode.TextDocument, range: vscode.Range }, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.ColorPresentation[]> {
        const text = context.document.getText(context.range);


        let colorText = [color.red, color.green, color.blue].map(formatColorChannel).join('');
        if (text.length === 10) {
            colorText = formatColorChannel(color.alpha) + colorText;
        }

        const isUpper = !/[a-f]/.test(text);
        if (isUpper) {
            colorText = colorText.toUpperCase();
        }

        return [
            new vscode.ColorPresentation(text.slice(0,2) + colorText)
        ];
    }
}
