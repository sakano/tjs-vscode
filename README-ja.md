# TJS for Visual Studio Code

Visual Studio CodeにTJSファイル用の機能を追加します。 KAG/KAGEXの機能が必要な場合は[kagex-vscode](https://marketplace.visualstudio.com/items?itemName=Biscrat.kagex-vscode)を使ってください。


# 機能
- 吉里吉里Zの型指定構文も含む完全なシンタックスハイライト。
- Ctagsをサポート。
- classやfunction, forループなどのスニペット。
- 「//#region」と「//#endregion」で囲まれた部分の折りたたみ。
- リファレンス検索パレットでAPIリファレンスを開けます


# リファレンス検索パレット
次の手順でAPIリファレンスを開けます。
1. Ctrl+Shift+Pを押してコマンドパレットを開きます。
2. 「TJS: Open reference search palette」というコマンドを実行します。
3. リファレンスを開きたいクラス名を入力します。
デフォルトでは「Ctrl+Shift+Alt+R」がリファレンス検索パレットを開くキーボードショートカットです。

## 設定
次の設定で使用するリファレンスを変更できます。デフォルトではTJSリファレンスと吉里吉里Zリファレンスが使われます。
```js
  "tjs.referencePalletEnable": {
    "tjs": true, // TJSリファレンス
    "krkrz": true, // 吉里吉里Zリファレンス
    "krkr2": false, // 吉里吉里2リファレンス
    "dll": false // DLLプラグインのリファレンス
  }
```


# Ctagsサポートについて
「定義へ移動」や「定義をここに表示」などの機能を使うにはCtagsをインストールする必要があります。

## インストール手順
1. Ctagsをインストールしてパスが通った場所に配置します。[exuberant ctags 日本語対応版](http://hp.vector.co.jp/authors/VA025040/ctags/)を使うことをお勧めします。
2. Visual Studio Codeに[ctagsx](https://marketplace.visualstudio.com/items?itemName=jtanx.ctagsx)をインストールします。

## インデックスファイルの更新
1. tjsファイルが入ったディレクトリをVisual Studio Codeで開きます。
2. 「Ctrl+Shift+P」を押してコマンドパレットを開きます
3. 「TJS: Update Ctags File」というコマンドを実行します。

以上で、「.tags」というファイルが開いたディレクトリに作成されctagsx[ctagsx](https://marketplace.visualstudio.com/items?itemName=jtanx.ctagsx)の機能を使えるようになります。

## 設定
次の設定でCtagsの動作を変更できます。
```js
  "tjs.ctagsProcess": [
    {
      "tagFilePath": ".tags", // Ctagsのインデックスファイルへのパス
      "searchPath": "", // Ctagsがtjsファイルを検索するディレクトリへのパス
      "searchRecursive": true, // tjsファイルを再帰的に検索するか
      "runOnSave": false, // tjsファイルが保存されたときに自動的にインデックスファイルを再生成するか
      "fileExtensions": [ // tjsファイルとして検索されるファイル拡張子
        ".tjs"
      ],
      "extraOption": "" // Ctagsに渡す追加のコマンドラインオプション
    }
  ]
```
複数のインデックスファイルを生成するにはtjs.ctagsProcessに複数設定してください。

次の設定はsrcディレクトリとoutディレクトリにインデックスファイルを生成する例です。
```js
  "tjs.ctagsProcess": [
    // srcディレクトリ内のtjsファイルを検索してsrc/.tagsを生成する
    {
      "tagFilePath": "src/.tags",
      "searchPath": "src/",
      "searchRecursive": true,
      "runOnSave": true,
    },
    // outディレクトリ内のtjsファイルを検索してout/.tagsを生成する
    {
      "tagFilePath": "out/.tags",
      "searchPath": "out/",
      "searchRecursive": true,
      "runOnSave": true,
    }
  ]
```


# 連絡先
バグや機能追加の提案などは[issues](https://github.com/sakano/tjs-vscode/issues)に連絡してください。
