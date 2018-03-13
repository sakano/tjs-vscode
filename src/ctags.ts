'use strict';
import * as vscode from 'vscode';
const exec = require('child_process').exec;

type CtagsProcess = {
    tagFilePath: string;
    searchPath: string;
    searchRecursive: boolean;
    runOnSave: boolean;
    fileExtensions: string[];
    extraOption: string;
    [index: string]: string | boolean | string[];
};

export class CTagsSupportProvider {
    private process: CtagsProcess[] = [];
    private readonly defaultProcess: CtagsProcess = {
        "tagFilePath": ".tags",
        "searchPath": "",
        "searchRecursive": true,
        "runOnSave": false,
        "fileExtensions": [
            ".itjs"
        ],
        "extraOption": ""
    };
    private readonly processKeys: string[] = [];

    private readonly runOnSaveLanguages: string[] = [];

    public constructor() {
        for (const key in this.defaultProcess) {
            if (this.defaultProcess.hasOwnProperty(key)) {
                this.processKeys.push(key);
            }
        }
        this.loadConfiguration();
    }

    private loadConfiguration() {
        const toString = Object.prototype.toString;

        this.process = vscode.workspace.getConfiguration("itjs").ctagsProcess;
        if (this.process === undefined) {
            this.process = [this.defaultProcess];
        } else {
            this.process.forEach((p, index) => {
                this.processKeys.forEach(key => {
                    if (p[key] === undefined) {
                        p[key] = this.defaultProcess[key];
                    } else if (toString.call(p[key]) !== toString.call(this.defaultProcess[key])) {
                        vscode.window.showErrorMessage(`itjs.ctagsProcess[${index}].${key} has wrong value.`);
                        p[key] = this.defaultProcess[key];
                    }
                });
            });
        }

        const languages = vscode.workspace.getConfiguration("itjs").ctagsRunOnSaveLanguages;
        this.runOnSaveLanguages.length = 0;
        if (languages === undefined) {
            this.runOnSaveLanguages.push("itjs");
        } else if (toString.call(languages) !== toString.call(languages)) {
            vscode.window.showErrorMessage(`itjs.languages has wrong value.`);
            this.runOnSaveLanguages.push("itjs");
        } else {
            Array.prototype.push.apply(this.runOnSaveLanguages, languages);
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
                vscode.window.showErrorMessage(`itjs.ctagsProcess[${index}].tagFilePath is empty.`);
                continue;
            }
            if (p.fileExtensions.length === 0) {
                vscode.window.showErrorMessage(`itjs.ctagsProcess[${index}].fileExtensions is empty.`);
                continue;
            }
            let langmap: string = p.fileExtensions.join("");
            let cmd: string = "ctags" +
                " --langdef=itjs" +
                ` --langmap=itjs:${langmap}` +
                " --regex-itjs=\"/^[ \\t]*class[ \\t]+([a-zA-Z0-9_]+)/\\1/c,class/\"" +
                " --regex-itjs=\"/^[ \\t]*function[ \\t]+([a-zA-Z0-9_]+)/\\1/f,function/\"" +
                " --regex-itjs=\"/^[ \\t]*property[ \\t]+([a-zA-Z0-9_]+)/\\1/p,property/\"" +
                " --regex-itjs=\"/^[ \\t]*var[ \\t]+([a-zA-Z0-9_]+)/\\1/v,value/\"" +
                " --regex-itjs=\"/^[ \\t]*const[ \\t]+([a-zA-Z0-9_]+)/\\1/v,value/\"" +
                " --regex-itjs=\"/^[ \\t]*([a-zA-Z0-9_]+)[ \\t]*:[ \\t]*function/\\1/f,function/\"" +
                " --regex-itjs=\"/([a-zA-Z0-9_]+)[ \\t]*=[ \\t]*function/\\1/f,function/\"" +
                " --regex-itjs=\"/^[ \\t]*Class\\(([a-zA-Z0-9_]+)/\\1/c,class/\"" +
                " --regex-itjs=\"/^[ \\t]*ClassExtends\\(([a-zA-Z0-9_]+)/\\1/c,class/\"" +
                " --regex-itjs=\"/^[ \\t]*Func\\(([a-zA-Z0-9_]+)/\\1/f,function/\"" +
                " --regex-itjs=\"/^[ \\t]*OverrideFunc\\(([a-zA-Z0-9_]+)/\\1/f,function/\"" +
                " --regex-itjs=\"/([a-zA-Z0-9_]+)[ \\t]*=[ \\t]*LMD/\\1/f,function/\"" +
                " --regex-itjs=\"/^[ \\t]*setStaticMember[ \\t]*\\([^,]+,[ \\t]*\\\"([a-zA-Z0-9_]+)\\\"/\\1/s,static/\"" +
                " --regex-itjs=\"/^[ \\t]*Scripts.propSet[ \\t]*\\([^,]+,[ \\t]*\\\"([a-zA-Z0-9_]+)\\\"/\\1/s,static/\"" +
                " --regex-itjs=\"/^[ \\t]*setHiddenMember[ \\t]*\\([^,]+,[ \\t]*\\\"([a-zA-Z0-9_]+)\\\"/\\1/h,hidden/\"" +
                " --regex-itjs=\"/^[ \\t]*m4_define\\((&\\-\\-)?([a-zA-Z0-9_]+)/\\2/d,define/\"" +
                " --regex-itjs=\"/^[ \\t]*m4_pushdef\\((&\\-\\-)?([a-zA-Z0-9_]+)/\\2/d,define/\"" +
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
        if (this.runOnSaveLanguages.indexOf(document.languageId) >= 0) {
            this.updateCtags(true);
        }
    }

    public onDidChangeConfiguration() {
        this.loadConfiguration();
    }
}
