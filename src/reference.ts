'use strict';
import * as vscode from 'vscode';

type RefernceMap = {
  [index: string]: string;
};

interface QuickPickItemWithURL extends vscode.QuickPickItem {
  url: string;
}

export class ReferenceProvider {
    private readonly tjsReferenceMap: RefernceMap = {
        "Array": "http://krkrz.github.io/docs/tjs2/j/contents/array.html",
        "Date": "http://krkrz.github.io/docs/tjs2/j/contents/date.html",
        "Dictionary": "http://krkrz.github.io/docs/tjs2/j/contents/dictionary.html",
        "Exception": "http://krkrz.github.io/docs/tjs2/j/contents/exception.html",
        "Math": "http://krkrz.github.io/docs/tjs2/j/contents/math.html",
        "Math.RandomGenerator": "http://krkrz.github.io/docs/tjs2/j/contents/randomgenerator.html",
        "RegExp": "http://krkrz.github.io/docs/tjs2/j/contents/regexp.html",
    };
    private readonly krkr2ReferenceMap: RefernceMap = {
        "AsyncTrigger": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_AsyncTrigger.html",
        "CDDASoundBuffer": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_CDDASoundBuffer.html",
        "Clipboard": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Clipboard.html",
        "Console": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Console.html",
        "Controller": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Controller.html",
        "Debug": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Debug.html",
        "Font": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Font.html",
        "KAGParser": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_KAGParser.html",
        "Layer": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Layer.html",
        "MenuItem": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_MenuItem.html",
        "MIDISoundBuffer": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_MIDISoundBuffer.html",
        "Pad": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Pad.html",
        "Plugins": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Plugins.html",
        "Scripts": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Scripts.html",
        "Storages": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Storages.html",
        "System": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_System.html",
        "Timer": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Timer.html",
        "VideoOverlay": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_VideoOverlay.html",
        "WaveSoundBuffer": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_WaveSoundBuffer.html",
        "WaveSoundBufferPhaseVocoder": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_WaveSoundBuffer.PhaseVocoder.html",
        "Window": "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Window.html",
    };
    private readonly krkrZReferenceMap: RefernceMap = {
        "AsyncTrigger": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_AsyncTrigger.html",
        "Bitmap": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Bitmap.html",
        "BitmapLayerTreeOwner": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_BitmapLayerTreeOwner.html",
        "Clipboard": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Clipboard.html",
        "Debug": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Debug.html",
        "Font": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Font.html",
        "ImageFunction": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_ImageFunction.html",
        "Layer": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Layer.html",
        "Plugins": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Plugins.html",
        "Rect": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Rect.html",
        "Scripts": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Scripts.html",
        "Storages": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Storages.html",
        "System": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_System.html",
        "Timer": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Timer.html",
        "VideoOverlay": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_VideoOverlay.html",
        "WaveSoundBuffer": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_WaveSoundBuffer.html",
        "WaveSoundBuffer.PhaseVocoder": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_WaveSoundBuffer.PhaseVocoder.html",
        "Window": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Window.html",
        "Window.BasicDrawDevice": "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Window.BasicDrawDevice.html",
    };
    private readonly dllReferenceMap: RefernceMap = {
        "addFont.dll": "https://github.com/wtnbgo/addFont/blob/master/readme.txt",
        "binaryStream.dll": "https://github.com/wtnbgo/binaryStream/blob/master/manual.tjs",
        "clipboardEx.dll": "https://github.com/krkrz/clipboardEx/blob/master/manual.tjs",
        "csvParser.dll": "https://github.com/wtnbgo/csvParser/blob/master/manual.tjs",
        "flashPlayer.dll": "https://github.com/krkrz/krkr2/blob/master/kirikiri2/branches/2.32stable/kirikiri2/src/plugins/win32/flashPlayer/manual.tjs",
        "fstat.dll": "https://github.com/wtnbgo/fstat/blob/master/manual.tjs",
        "gamePad.dll": "https://github.com/krkrz/gamepad/blob/master/readme.txt",
        "getSample.dll": "https://github.com/wtnbgo/getSample/blob/master/manual.tjs",
        "httpRequest.dll": "https://github.com/wtnbgo/httprequest/blob/master/manual.tjs",
        "httpserv.dll": "https://github.com/wtnbgo/httpserv/blob/master/manual.tjs",
        "json.dll": "https://github.com/wtnbgo/json/blob/master/manual.tjs",
        "KAGParserEx.dll": "https://github.com/wtnbgo/KAGParserEx/blob/master/readme.txt",
        "KAGParserExb.dll": "https://github.com/sakano/krkr_archives/blob/master/kagex_plugin/KAGParserExb/%E4%BD%BF%E3%81%84%E6%96%B9.txt",
        "krLanczosGPU.dll": "https://github.com/sakano/krLanczosGPU/blob/master/manual.tjs",
        "layerExAreaAverage.dll": "https://github.com/wtnbgo/layerExAreaAverage/blob/master/manual.tjs",
        "layerExBTOA.dll": "https://github.com/wtnbgo/layerExBTOA/blob/master/manual.tjs",
        "layerExDraw.dll": "https://github.com/wtnbgo/layerExDraw/blob/master/manual.tjs",
        "layerExImage.dll": "https://github.com/wtnbgo/layerExImage/blob/master/manual.tjs",
        "layerExLongExposure.dll": "https://github.com/wtnbgo/layerExLongExposure/blob/master/manual.tjs",
        "layerExRaster.dll": "https://github.com/wtnbgo/layerExRaster/blob/master/manual.tjs",
        "layerExSave.dll": "https://github.com/wtnbgo/layerExSave/blob/master/manual.tjs",
        "limitCursor.dll": "https://github.com/sakano/krkr_archives/blob/master/kag_plugin/limitCursor/readme.txt",
        "lineParser.dll": "https://github.com/wtnbgo/lineParser/blob/master/manual.tjs",
        "memfile.dll": "https://github.com/wtnbgo/memfile/blob/master/manual.tjs",
        "messenger.dll": "https://github.com/wtnbgo/messenger/blob/master/manual.tjs",
        "minizip.dll": "https://github.com/wtnbgo/minizip/blob/master/manual.tjs",
        "process.dll": "https://github.com/wtnbgo/process/blob/master/manual.tjs",
        "psd.dll": "https://github.com/wtnbgo/psdfile/blob/master/manual.tjs",
        "qrcode.dll": "https://github.com/krkrz/qrcode/blob/master/manual.tjs",
        "registory.dll": "https://github.com/krkrz/registory/blob/master/manual.tjs",
        "resourceRW.dll": "https://github.com/wtnbgo/resourceRW/blob/master/manual.tjs",
        "saveStruct.dll": "https://github.com/wtnbgo/saveStruct/blob/master/manual.tjs",
        "scriptsEx.dll": "https://github.com/wtnbgo/scriptsEx/blob/master/manual.tjs",
        "shellExecute.dll": "https://github.com/wtnbgo/shellExecute/blob/master/manual.tjs",
        "shrinkCopy.dll": "https://github.com/wtnbgo/shrinkCopy/blob/master/manual.tjs",
        "sigcheck.dll": "https://github.com/wtnbgo/sigcheck/blob/master/manual.tjs",
        "stdio.dll": "https://github.com/wtnbgo/stdio/blob/master/manual.tjs",
        "steam.dll": "https://github.com/wtnbgo/steam/blob/master/manual.tjs",
        "systemEx.dll": "https://github.com/wtnbgo/systemEx/blob/master/manual.tjs",
        "taskTray.dll": "https://github.com/krkrz/tasktray/blob/master/manual.tjs",
        "tftSave.dll": "https://github.com/wtnbgo/tftSave/blob/master/manual.tjs",
        "videoEncoder.dll": "https://github.com/krkrz/videoEncoder/blob/master/manual.tjs",
        "win32dialog.dll": "https://github.com/wtnbgo/win32dialog/blob/master/manual.tjs",
        "win32ole.dll": "https://github.com/wtnbgo/win32ole/blob/master/manual.tjs",
        "windowEx.dll": "https://github.com/wtnbgo/windowEx/blob/master/manual.tjs",
        "windowExProgress.dll": "https://github.com/wtnbgo/windowExProgress/blob/master/manual.tjs",
    };

    private readonly pickItems: QuickPickItemWithURL[] = [];

    public constructor() {
        this.loadConfiguration();
    }

    private loadConfiguration() {
        const config = vscode.workspace.getConfiguration("itjs").referencePromptEnable;
        const check = (key: string, def: boolean): boolean => {
            if (def) {
                return config === undefined || config[key] === undefined || config[key];
            } else {
                return config !== undefined && config[key] !== undefined && config[key];
            }
        };

        const referenceMaps: { category: string; map: RefernceMap; }[] = [];
        if (check("tjs", true)) { referenceMaps.push({ category: "TJS Document", map: this.tjsReferenceMap }); }
        if (check("krkr2", false)) { referenceMaps.push({ category: "krkr2 Document", map: this.krkr2ReferenceMap }); }
        if (check("krkrZ", true)) { referenceMaps.push({ category: "krkrZ Document", map: this.krkrZReferenceMap }); }
        if (check("dll", false)) { referenceMaps.push({ category: "DLL Document", map: this.dllReferenceMap }); }
        this.pickItems.length = 0;
        referenceMaps.forEach(referenceMap => {
            for (const label in referenceMap.map) {
                this.pickItems.push({ "label": label, "description": referenceMap.category, "url": referenceMap.map[label] });
            }
        });
        this.pickItems.sort(this.compare);
    }

    private compare(a: vscode.QuickPickItem, b: vscode.QuickPickItem): number {
        const aStr = a.label + a.description;
        const bStr = b.label + b.description;
        return aStr > bStr ? 1 : aStr === bStr ? 0 : -1;
    }

    public showPrompt() {
        const options: vscode.QuickPickOptions = {
            "placeHolder": "Which reference will you open?",
            "matchOnDescription": true
        };

        vscode.window.showQuickPick<QuickPickItemWithURL>(this.pickItems, options).then(item => {
            if (item === undefined) { return; }
            vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(item.url));
        });
    }

    public onDidChangeConfiguration() {
        this.loadConfiguration();
    }
}

