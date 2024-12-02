'use strict';
import * as vscode from 'vscode';

export class ColorProvider implements vscode.DocumentColorProvider {
    provideDocumentColors(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.ColorInformation[]> {
        const colors: vscode.ColorInformation[] = [];
        const regex = /\b0[xX][0-9a-fA-F]{6,8}\b/g;

        for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
            const line = document.lineAt(lineNumber);
            if (line.isEmptyOrWhitespace) {
                continue;
            }
            const text = line.text;

            let match;
            while (match = regex.exec(text)) {
                let alpha: number = 255;
                let red: number = 0;
                let green: number = 0;
                let blue: number = 0;

                if (match[0].length === 8) {
                    red = parseInt(match[0].slice(2, 4), 16);
                    green = parseInt(match[0].slice(4, 6), 16);
                    blue = parseInt(match[0].slice(6, 8), 16);
                } else if (match[0].length === 10) {
                    alpha = parseInt(match[0].slice(2, 4), 16);
                    red = parseInt(match[0].slice(4, 6), 16);
                    green = parseInt(match[0].slice(6, 8), 16);
                    blue = parseInt(match[0].slice(8, 10), 16);
                } else {
                    continue;
                }

                const color = new vscode.ColorInformation(
                    new vscode.Range(lineNumber, match.index, lineNumber, match.index + match[0].length),
                    new vscode.Color(
                        red / 255,
                        green / 255,
                        blue / 255,
                        alpha / 255
                    )
                );
                colors.push(color);
            }
        }

        return colors;
    }

    provideColorPresentations(color: vscode.Color, context: { document: vscode.TextDocument, range: vscode.Range }, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.ColorPresentation[]> {
        const text = context.document.getText(context.range);


        let colorText: string = Math.round(color.red * 255).toString(16).padStart(2, "0");
        colorText += Math.round(color.green * 255).toString(16).padStart(2, "0");
        colorText += Math.round(color.blue * 255).toString(16).padStart(2, "0");
        if (text.length === 10) {
            colorText = Math.round(color.alpha * 255).toString(16).padStart(2, "0") + colorText;
        }

        let isUpper = !/[a-f]/.test(text);
        if (isUpper) {
            colorText = colorText.toUpperCase();
        }

        return [
            new vscode.ColorPresentation(text.slice(0,2) + colorText)
        ];
    }
}
