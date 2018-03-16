'use strict';
import * as vscode from 'vscode';

interface Reference extends vscode.QuickPickItem {
    url: string;
}

export class ReferenceProvider {
    private readonly tjsReferenceMap: Reference[] = [
        { label: "Array", description: "(TJS)", url: "http://krkrz.github.io/docs/tjs2/j/contents/array.html" },
        { label: "Date", description: "(TJS)", url: "http://krkrz.github.io/docs/tjs2/j/contents/date.html" },
        { label: "Dictionary", description: "(TJS)", url: "http://krkrz.github.io/docs/tjs2/j/contents/dictionary.html" },
        { label: "Exception", description: "(TJS)", url: "http://krkrz.github.io/docs/tjs2/j/contents/exception.html" },
        { label: "Math", description: "(TJS)", url: "http://krkrz.github.io/docs/tjs2/j/contents/math.html" },
        { label: "Math.RandomGenerator", description: "(TJS)", url: "http://krkrz.github.io/docs/tjs2/j/contents/randomgenerator.html" },
        { label: "Octet", description: "(TJS)", url: "http://krkrz.github.io/docs/tjs2/j/contents/octet.html" },
        { label: "String", description: "(TJS)", url: "http://krkrz.github.io/docs/tjs2/j/contents/string.html" },
        { label: "RegExp", description: "(TJS)", url: "http://krkrz.github.io/docs/tjs2/j/contents/regexp.html" },
    ];
    private readonly krkr2ReferenceMap: Reference[] = [
        { label: "AsyncTrigger", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_AsyncTrigger.html" },
        { label: "CDDASoundBuffer", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_CDDASoundBuffer.html" },
        { label: "Clipboard", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Clipboard.html" },
        { label: "Console", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Console.html" },
        { label: "Controller", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Controller.html" },
        { label: "Debug", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Debug.html" },
        { label: "Font", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Font.html" },
        { label: "KAGParser", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_KAGParser.html" },
        { label: "Layer", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Layer.html" },
        { label: "MenuItem", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_MenuItem.html" },
        { label: "MIDISoundBuffer", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_MIDISoundBuffer.html" },
        { label: "Pad", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Pad.html" },
        { label: "Plugins", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Plugins.html" },
        { label: "Scripts", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Scripts.html" },
        { label: "Storages", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Storages.html" },
        { label: "System", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_System.html" },
        { label: "Timer", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Timer.html" },
        { label: "VideoOverlay", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_VideoOverlay.html" },
        { label: "WaveSoundBuffer", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_WaveSoundBuffer.html" },
        { label: "WaveSoundBufferPhaseVocoder", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_WaveSoundBuffer.PhaseVocoder.html" },
        { label: "Window", description: "(krkr2)", url: "https://krkrz.github.io/krkr2doc/kr2doc/contents/f_Window.html" },
    ];
    private readonly krkrZReferenceMap: Reference[] = [
        { label: "AsyncTrigger", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_AsyncTrigger.html" },
        { label: "Bitmap", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Bitmap.html" },
        { label: "BitmapLayerTreeOwner", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_BitmapLayerTreeOwner.html" },
        { label: "Clipboard", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Clipboard.html" },
        { label: "Debug", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Debug.html" },
        { label: "Font", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Font.html" },
        { label: "ImageFunction", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_ImageFunction.html" },
        { label: "Layer", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Layer.html" },
        { label: "Plugins", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Plugins.html" },
        { label: "Rect", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Rect.html" },
        { label: "Scripts", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Scripts.html" },
        { label: "Storages", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Storages.html" },
        { label: "System", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_System.html" },
        { label: "Timer", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Timer.html" },
        { label: "VideoOverlay", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_VideoOverlay.html" },
        { label: "WaveSoundBuffer", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_WaveSoundBuffer.html" },
        { label: "WaveSoundBuffer.PhaseVocoder", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_WaveSoundBuffer.PhaseVocoder.html" },
        { label: "Window", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Window.html" },
        { label: "Window.BasicDrawDevice", description: "(krkrZ)", url: "http://krkrz.github.io/docs/kirikiriz/j/contents/f_Window.BasicDrawDevice.html" },
    ];
    private readonly dllReferenceMap: Reference[] = [
        { label: "addFont.dll", description: "プライベートフォント対応(DLL)", url: "https://github.com/wtnbgo/addFont/blob/master/readme.txt" },
        { label: "binaryStream.dll", description: "バイナリファイル対応(DLL)", url: "https://github.com/wtnbgo/binaryStream/blob/master/manual.tjs" },
        { label: "clipboardEx.dll", description: "クリップボード拡張(DLL)", url: "https://github.com/krkrz/clipboardEx/blob/master/manual.tjs" },
        { label: "csvParser.dll", description: "CSVファイル読み込み(DLL)", url: "https://github.com/wtnbgo/csvParser/blob/master/manual.tjs" },
        { label: "flashPlayer.dll", description: "Flash再生(DLL)", url: "https://github.com/krkrz/krkr2/blob/master/kirikiri2/branches/2.32stable/kirikiri2/src/plugins/win32/flashPlayer/manual.tjs" },
        { label: "fstat.dll", description: "Storages拡張(DLL)", url: "https://github.com/wtnbgo/fstat/blob/master/manual.tjs" },
        { label: "gamePad.dll", description: "ゲームパッド対応(DLL)", url: "https://github.com/krkrz/gamepad/blob/master/readme.txt" },
        { label: "getSample.dll", description: "WaveSoundBuffer拡張(DLL)", url: "https://github.com/wtnbgo/getSample/blob/master/manual.tjs" },
        { label: "httpRequest.dll", description: "HTTPクライアント(DLL)", url: "https://github.com/wtnbgo/httprequest/blob/master/manual.tjs" },
        { label: "httpserv.dll", description: "ローカルHTTPサーバ(DLL)", url: "https://github.com/wtnbgo/httpserv/blob/master/manual.tjs" },
        { label: "json.dll", description: "JSON読み書き(DLL)", url: "https://github.com/wtnbgo/json/blob/master/manual.tjs" },
        { label: "KAGParserEx.dll", description: "KAGParser拡張(DLL)", url: "https://github.com/wtnbgo/KAGParserEx/blob/master/readme.txt" },
        { label: "KAGParserExb.dll", description: "KAGParser拡張(DLL)", url: "https://github.com/sakano/krkr_archives/blob/master/kagex_plugin/KAGParserExb/%E4%BD%BF%E3%81%84%E6%96%B9.txt" },
        { label: "krLanczosGPU.dll", description: "画像リサイズ(Lanczos)(DLL)", url: "https://github.com/sakano/krLanczosGPU/blob/master/manual.tjs" },
        { label: "layerExAreaAverage.dll", description: "画像リサイズ(面積平均法)(DLL)", url: "https://github.com/wtnbgo/layerExAreaAverage/blob/master/manual.tjs" },
        { label: "layerExBTOA.dll", description: "アルファ・領域画像操作(DLL)", url: "https://github.com/wtnbgo/layerExBTOA/blob/master/manual.tjs" },
        { label: "layerExDraw.dll", description: "GDI+描画(DLL)", url: "https://github.com/wtnbgo/layerExDraw/blob/master/manual.tjs" },
        { label: "layerExImage.dll", description: "画像エフェクト(DLL)", url: "https://github.com/wtnbgo/layerExImage/blob/master/manual.tjs" },
        { label: "layerExLongExposure.dll", description: "長時間露光画像生成(DLL)", url: "https://github.com/wtnbgo/layerExLongExposure/blob/master/manual.tjs" },
        { label: "layerExRaster.dll", description: "ラスター処理(DLL)", url: "https://github.com/wtnbgo/layerExRaster/blob/master/manual.tjs" },
        { label: "layerExSave.dll", description: "TLG5,PNG保存 / レイヤ操作拡張(DLL)", url: "https://github.com/wtnbgo/layerExSave/blob/master/manual.tjs" },
        { label: "limitCursor.dll", description: "マウスカーソル範囲制限(DLL)", url: "https://github.com/sakano/krkr_archives/blob/master/kag_plugin/limitCursor/readme.txt" },
        { label: "lineParser.dll", description: "行単位ファイル読み込み(DLL)", url: "https://github.com/wtnbgo/lineParser/blob/master/manual.tjs" },
        { label: "memfile.dll", description: "メモリ上ファイルシステム(DLL)", url: "https://github.com/wtnbgo/memfile/blob/master/manual.tjs" },
        { label: "messenger.dll", description: "吉里吉里プロセス間通信(DLL)", url: "https://github.com/wtnbgo/messenger/blob/master/manual.tjs" },
        { label: "minizip.dll", description: "ZIP読み書き/ZIPファイルシステム(DLL)", url: "https://github.com/wtnbgo/minizip/blob/master/manual.tjs" },
        { label: "process.dll", description: "外部プロセス起動(DLL)", url: "https://github.com/wtnbgo/process/blob/master/manual.tjs" },
        { label: "psd.dll", description: "PSD読み込み(DLL)", url: "https://github.com/wtnbgo/psdfile/blob/master/manual.tjs" },
        { label: "qrcode.dll", description: "QRコード生成(DLL)", url: "https://github.com/krkrz/qrcode/blob/master/manual.tjs" },
        { label: "registory.dll", description: "レジストリ書き込み(DLL)", url: "https://github.com/krkrz/registory/blob/master/manual.tjs" },
        { label: "resourceRW.dll", description: "リソース読み書き(DLL)", url: "https://github.com/wtnbgo/resourceRW/blob/master/manual.tjs" },
        { label: "saveStruct.dll", description: "UTF-8読み書き / Array,Dictionary文字列化(DLL)", url: "https://github.com/wtnbgo/saveStruct/blob/master/manual.tjs" },
        { label: "scriptsEx.dll", description: "Scripts拡張(DLL)", url: "https://github.com/wtnbgo/scriptsEx/blob/master/manual.tjs" },
        { label: "shellExecute.dll", description: "外部プロセス起動[obsolete](DLL)", url: "https://github.com/wtnbgo/shellExecute/blob/master/manual.tjs" },
        { label: "shrinkCopy.dll", description: "画像リサイズ(面積平均法)(DLL)", url: "https://github.com/wtnbgo/shrinkCopy/blob/master/manual.tjs" },
        { label: "sigcheck.dll", description: "署名チェック(DLL)", url: "https://github.com/wtnbgo/sigcheck/blob/master/manual.tjs" },
        { label: "stdio.dll", description: "標準入出力(DLL)", url: "https://github.com/wtnbgo/stdio/blob/master/manual.tjs" },
        { label: "steam.dll", description: "Steam対応(DLL)", url: "https://github.com/wtnbgo/steam/blob/master/manual.tjs" },
        { label: "systemEx.dll", description: "System拡張(DLL)", url: "https://github.com/wtnbgo/systemEx/blob/master/manual.tjs" },
        { label: "taskTray.dll", description: "タスクトレイ対応(DLL)", url: "https://github.com/krkrz/tasktray/blob/master/manual.tjs" },
        { label: "tftSave.dll", description: "レンダリング済みフォント読み書き(DLL)", url: "https://github.com/wtnbgo/tftSave/blob/master/manual.tjs" },
        { label: "videoEncoder.dll", description: "WMV書き込み(DLL)", url: "https://github.com/krkrz/videoEncoder/blob/master/manual.tjs" },
        { label: "win32dialog.dll", description: "Win32ダイアログ対応(DLL)", url: "https://github.com/wtnbgo/win32dialog/blob/master/manual.tjs" },
        { label: "win32ole.dll", description: "OLE/ActiveX対応(DLL)", url: "https://github.com/wtnbgo/win32ole/blob/master/manual.tjs" },
        { label: "windowEx.dll", description: "Window/MenuItem/Console/Pad拡張(DLL)", url: "https://github.com/wtnbgo/windowEx/blob/master/manual.tjs" },
        { label: "windowExProgress.dll", description: "プロブレスバー表示(DLL)", url: "https://github.com/wtnbgo/windowExProgress/blob/master/manual.tjs" },
    ];

    private readonly pickItems: Reference[] = [];

    public constructor() {
        this.loadConfiguration();
    }

    private loadConfiguration() {
        const config = vscode.workspace.getConfiguration("tjs").referencePalletEnable;
        const check = (key: string, def: boolean): boolean => {
            if (def) {
                return config === undefined || config[key] === undefined || config[key];
            } else {
                return config !== undefined && config[key] !== undefined && config[key];
            }
        };

        this.pickItems.length = 0;
        if (check("tjs", false)) { Array.prototype.push.apply(this.pickItems, this.tjsReferenceMap); }
        if (check("krkr2", true)) { Array.prototype.push.apply(this.pickItems, this.krkr2ReferenceMap); }
        if (check("krkrZ", true)) { Array.prototype.push.apply(this.pickItems, this.krkrZReferenceMap); }
        if (check("dll", true)) { Array.prototype.push.apply(this.pickItems, this.dllReferenceMap); }
        this.pickItems.sort(this.compare);
    }

    private compare(a: vscode.QuickPickItem, b: vscode.QuickPickItem): number {
        const aStr = a.label + a.description;
        const bStr = b.label + b.description;
        return aStr > bStr ? 1 : aStr === bStr ? 0 : -1;
    }

    public openPallet() {
        const options: vscode.QuickPickOptions = {
            "placeHolder": "Which reference will you open?",
            "matchOnDescription": true
        };

        vscode.window.showQuickPick<Reference>(this.pickItems, options).then(item => {
            if (item === undefined) { return; }
            vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(item.url));
        });
    }

    public onDidChangeConfiguration() {
        this.loadConfiguration();
    }
}

