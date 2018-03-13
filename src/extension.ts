'use strict';
import { HoverProvider, Hover, TextDocument, CancellationToken, Position, ExtensionContext } from 'vscode';
import * as vscode from 'vscode';
const exec = require('child_process').exec;

class TJSHoverProvider implements HoverProvider {

    private _definitions: { [key: string]: string } = {
        "System.addContinuousHandler": "(function) System.addContinuousHandler(callback) : void",
        "System.assignMessage": "(function) System.assignMessage(id, msg) : bool",
        "System.createAppLock": "(function) System.createAppLock(key) : bool",
        "System.createUUID": "(function) System.createUUID() : string",
        "System.doCompact": "(function) System.doCompact(level=clAll) : void",
        "System.dumpHeap": "(function) System.dumpHeap() : void",
        "System.exit": "(function) System.exit(code=0) : void",
        "System.getArgument": "(function) System.getArgument(name) : string",
        "System.getKeyState": "(function) System.getKeyState(code) : bool",
        "System.getTickCount": "(function) System.getTickCount() : int",
        "System.inform": "(function) System.inform(text, caption=\"\") : void",
        "System.readRegValue": "(function) System.readRegValue(key) : string",
        "System.removeContinuousHandler": "(function) System.removeContinuousHandler(callback) : void",
        "System.setArgument": "(function) System.setArgument(name, value) : void",
        "System.shellExecute": "(function) System.shellExecute(target, param=\"\") : bool",
        "System.showVersion": "(function) System.showVersion() : void",
        "System.terminate": "(function) System.terminate(code=0) : void",
        "System.toActualColor": "(function) System.toActualColor(color) : int",
        "System.touchImages": "(function) System.touchImages(storages, limitbytes=0, timeout=0) : void",
        "Storages.addAutoPath": "(function) Storages.addAutoPath(path) : void",
        "Storages.chopStorageExt": "(function) Storages.chopStorageExt(storage) : string",
        "Storages.extractStorageExt": "(function) Storages.extractStorageName(storage) : string",
        "Storages.extractStoragePath": "(function) Storages.extractStoragePath(storage) : string",
        "Storages.getFullPath": "(function) Storages.getFullPath(path) : string",
        "Storages.getLocalName": "(function) Storages.getLocalName(path) : string",
        "Storages.getPlacedPath": "(function) Storages.getPlacedPath(storage) : string",
        "Storages.isExistentStorage": "(function) Storages.isExistentStorage(storage) : bool",
        "Storages.removeAutoPath": "(function) Storages.removeAutoPath(path) : void",
        "Storages.searchCD": "(function) Storages.searchCD(volume) : string",
        "Storages.selectFile": "(function) Storages.selectFile(params) : bool",
        "Debug.addLoggingHandler": "(function) Debug.addLoggingHandler(handler) : void",
        "Debug.getLastLog": "(function) Debug.getLastLog() : string",
        "Debug.logAsError": "(function) Debug.logAsError() : void",
        "Debug.message": "(function) Debug.message(message, ...) : void",
        "Debug.notice": "(function) Debug.notice(message, ...) : void",
        "Debug.removeLoggingHandler": "(function) Debug.removeLoggingHandler(handler) : void",
        "Debug.startLogToFile": "(function) Debug.startLogToFile(clear=false) : void",
        "Scripts.compileStorage": "(function) Scripts.compileStorage(inputfile, outputfile, isresult=false, outputdebug=false, isexpression=false) : void",
        "Scripts.dump": "(function) Scripts.dump() : void",
        "Scripts.eval": "(function) Scripts.eval(expression, name='', linesof=0, context=global) : any",
        "Scripts.evalStorage": "(function) Scripts.evalStorage(storage, mode='', context=global) : any",
        "Scripts.exec": "(function) Scripts.exec(script, name='', linesof=0, context=global) : any",
        "Scripts.execStorage": "(function) Scripts.execStorage(storage, mode='', context=global) : any",
        "Scripts.getClassNames": "(function) Scripts.getClassNames(obect) : string[]",
        "Scripts.getTraceString": "(function) Scripts.getTraceString(limit=0) : string",
        "Scripts.setCallMissing": "(function) Scripts.setCallMissing(missing) : void",
        "Plugins.getList": "(function) Plugins.getList() : string[]",
        "Plugins.link": "(function) Plugins.link(name) : void",
        "Plugins.unlink": "(function) Plugins.unlink(name) : void",
        "ImageFunction.adjustGamma": "(function) ImageFunction.adjustGamma(bmp, rgamma=1.0, rfloor=0, rceil=255, ggamma=1.0, gfloor=0, gceil=255, bgamma=1.0, bfloor=0, bceil=255, cliprect=null, isaddalpha=false) : void",
        "ImageFunction.colorRect": "(function) ImageFunction.colorRect(bmp, value, opa=255, rect=null, face=dfAlpha, cliprect=null) : void",
        "ImageFunction.doBoxBlur": "(function) ImageFunction.doBoxBlur(bmp, xblur=1, yblur=1, cliprect=null, isalpha=true) : void",
        "ImageFunction.doGrayScale": "(function) ImageFunction.doGrayScale(bmp, cliprect=null) : void",
        "ImageFunction.drawGlyph": "(function) ImageFunction.drawGlyph(bmp, x, y, glyph, color, opa=255, aa=true, face=dfAlpha, shadowlevel=0, shadowcolor=0x000000, shadowwidth=0, shadowofsx=0, shadowofsy=0, hda=false, cliprect=null) : void",
        "ImageFunction.drawText": "(function) ImageFunction.drawText(bmp, font, x, y, text, color, opa=255, aa=true, face=dfAlpha, shadowlevel=0, shadowcolor=0x000000, shadowwidth=0, shadowofsx=0, shadowofsy=0, hda=false, cliprect=null) : void",
        "ImageFunction.fillRect": "(function) ImageFunction.fillRect(bmp, value, rect=null, isalpha=true, cliprect=null) : void",
        "ImageFunction.flipLR": "(function) ImageFunction.flipLR(bmp, rect=null) : void",
        "ImageFunction.flipUD": "(function) ImageFunction.flipUD(bmp, rect=null) : void",
        "ImageFunction.operateAffine": "(function) ImageFunction.operateAffine(dst, src, A, B, C, D, E, F, srcrect=null, cliprect=null, affine, mode=omAlpha, face=dfAlpha, opa=255, type=stNearest, hda=false) : void",
        "ImageFunction.operateRect": "(function) ImageFunction.operateRect(dst, dleft, dtop, src, srcrect=null, cliprect=null, mode=omAuto, face=dfAlpha, opa=255, hda=false) : void",
        "ImageFunction.operateStretch": "(function) ImageFunction.operateStretch(dst, src, dstrect=null, srcrect=null, cliprect=null, mode=omAuto, face=dfAlpha, opa=255, type=stNearest, hda=false, option=-1.0) : void",
        "Clipboard.hasFormat": "(function) Clipboard.hasFormat(format) : void",
        "Dictionary.saveStruct": "(function) Dictionary.saveStruct(path, mode='') : void",
        "Dictionary.assign": "(function) Dictionary.assign(from, clear=true) : void",
        "Dictionary.assignStruct": "(function) Dictionary.assignStruct(from) : void",
        "Dictionary.clear": "(function) Dictionary.clear() : void",
        "Dictionary.loadStruct": "(function) Dictionary.loadStruct(path) : void",
        "Math.abs": "(function) Math.abs(x) : real",
        "Math.acos": "(function) Math.acos(x) : real",
        "Math.asin": "(function) Math.asin(x) : real",
        "Math.atan": "(function) Math.atan(x) : real",
        "Math.atan2": "(function) Math.atan2(y, x) : real",
        "Math.ceil": "(function) Math.ceil(x) : real",
        "Math.floor": "(function) Math.floor(x) : real",
        "Math.exp": "(function) Math.exp(x) : real",
        "Math.log": "(function) Math.log(x) : real",
        "Math.max": "(function) Math.max(x, ...) : real",
        "Math.min": "(function) Math.min(x, ...) : real",
        "Math.random": "(function) Math.random() : real",
        "Math.pow": "(function) Math.pow(base, exponent) : real",
        "Math.round": "(function) Math.round(x) : real",
        "Math.sin": "(function) Math.sin(x) : real",
        "Math.cos": "(function) Math.cos(x) : real",
        "Math.tan": "(function) Math.tan(x) : real",
        "Math.sqrt": "(function) Math.sqrt(x) : real"
    };

    public provideHover(document: TextDocument, position: Position, token: CancellationToken): Hover | undefined {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) { return undefined; }

        const lineText = document.lineAt(position.line).text;
        let startPos = wordRange.start.character;
        let endPos = wordRange.end.character - 1;

        do {
            --startPos;
        } while (/[a-zA-Z0-9.]/.test(lineText.charAt(startPos)));
        ++startPos;

        do {
            ++endPos;
        } while (/[a-zA-Z0-9.]/.test(lineText.charAt(endPos)));
        --endPos;

        const id = lineText.substr(startPos, endPos - startPos + 1);
        const def = this._definitions[id];
        if (!def) {
            return undefined;
        }

        return new Hover({ language: "tjs", value: def });
    }
}

type CtagsProcess = {
    tagFilePath: string;
    searchPath: string;
    searchRecursive: boolean;
    runOnSave: boolean;
    fileExtensions: string[];
    extraOption: string;
    [index: string]: string | boolean | string[];
};

class CTagsSupportProvider {
    private process: CtagsProcess[] = [];
    private readonly defaultProcess: CtagsProcess = {
        "tagFilePath": ".tags",
        "searchPath": "",
        "searchRecursive": true,
        "runOnSave": false,
        "fileExtensions": [
            ".tjs"
        ],
        "extraOption": ""
    };
    private readonly processKeys: string[] = [];

    public constructor() {
        for (const key in this.defaultProcess) {
            if (this.defaultProcess.hasOwnProperty(key)) {
                this.processKeys.push(key);
            }
        }
        this.loadConfiguration();
    }

    private loadConfiguration() {
        this.process = vscode.workspace.getConfiguration("tjs").ctagsProcess;
        if (this.process === undefined) {
            this.process = [this.defaultProcess];
        } else {
            const toString = Object.prototype.toString;
            this.process.forEach((p, index) => {
                this.processKeys.forEach(key => {
                    if (p[key] === undefined) {
                        p[key] = this.defaultProcess[key];
                    } else if (toString.call(p[key]) !== toString.call(this.defaultProcess[key])) {
                        vscode.window.showErrorMessage(`tjs.ctagsProcess[${index}].${key} has wrong value.`);
                        p[key] = this.defaultProcess[key];
                    }
                });
            });
        }
    }

    public updateCtags(save: boolean = false) {
        const rootPath = vscode.workspace.rootPath;
        if (rootPath === undefined) {
            vscode.window.showErrorMessage("No project currently opened");
            return;
        }

        for (let index = 0; index < this.process.length; index++) {
            const p = this.process[index];
            if (save && !p.runOnSave) { continue; }
            if (p.tagFilePath === "") {
                vscode.window.showErrorMessage(`tjs.ctagsProcess[${index}].tagFilePath is empty.`);
                continue;
            }
            if (p.fileExtensions.length === 0) {
                vscode.window.showErrorMessage(`tjs.ctagsProcess[${index}].fileExtensions is empty.`);
                continue;
            }
            let langmap: string = p.fileExtensions.join(",");
            let cmd: string = "ctags" +
                " --langdef=tjs" +
                ` --langmap=tjs:${langmap}` +
                " --regex-tjs=\"/^[ \\t]*class[ \\t]+([a-zA-Z0-9_]+)/\\1/c,class/\"" +
                " --regex-tjs=\"/^[ \\t]*function[ \\t]+([a-zA-Z0-9_]+)/\\1/f,function/\"" +
                " --regex-tjs=\"/^[ \\t]*property[ \\t]+([a-zA-Z0-9_]+)/\\1/p,property/\"" +
                " --regex-tjs=\"/^[ \\t]*var[ \\t]+([a-zA-Z0-9_]+)/\\1/v,value/\"" +
                " --regex-tjs=\"/^[ \\t]*const[ \\t]+([a-zA-Z0-9_]+)/\\1/v,value/\"" +
                " --regex-tjs=\"/^[ \\t]*([a-zA-Z0-9_]+)[ \\t]*:[ \\t]*function/\\1/f,function/\"" +
                " --regex-tjs=\"/([a-zA-Z0-9_]+)[ \\t]*=[ \\t]*function/\\1/f,function/\"" +
                ` ${p.extraOption} -f \"${rootPath}\\${p.tagFilePath}\" ${p.searchRecursive ? "-R" : ""} \"${rootPath}\\${p.searchPath}*\"`;
            exec(cmd,
                (err: any, stdout: any, stderr: any) => {
                    if (err !== null) {
                        vscode.window.showErrorMessage("ctags:" + err);
                    }
                });
        }
    }

    public onDidSaveTextDocument(document: vscode.TextDocument) {
        if (document.languageId === "tjs") {
            this.updateCtags(true);
        }
    }

    public onDidChangeConfiguration() {
        this.loadConfiguration();
    }
}

export function activate(ctx: ExtensionContext): void {
    ctx.subscriptions.push(vscode.languages.registerHoverProvider("tjs", new TJSHoverProvider()));

    const ctagsSupportProvider = new CTagsSupportProvider();
    ctx.subscriptions.push(vscode.commands.registerCommand("tjs.updateCtags", () => {
        ctagsSupportProvider.updateCtags();
    }));
    ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        ctagsSupportProvider.onDidSaveTextDocument(document);
    }));
    ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => {
        ctagsSupportProvider.onDidChangeConfiguration();
    }));
}
