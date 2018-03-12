# TJS for Visual Studio Code

Visual Studio CodeにTJSファイル用の機能を追加します。 KAG/KAGEXの機能が必要な場合は[kagex-vscode](https://marketplace.visualstudio.com/items?itemName=Biscrat.kagex-vscode)を使ってください。


# 機能
- 吉里吉里Zの型指定構文も含む完全なシンタックスハイライト。
- Ctagsをサポート。
- classやfunction, forループなどのスニペット。
- 「//#region」と「//#endregion」で囲まれた部分の折りたたみ。


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
### tjs.ctagsRunOnSave
trueならtjsファイルが保存されたときにインデックスファイルを自動的に再生成するようになります。デフォルトではfalseです。

### tjs.ctagsFilePath
インデックスファイルの名前です。デフォルトでは".tags"です

### tjs.ctagsRootpath
ctagsがtjsファイルを検索するディレクトリへの、ワークスペースからの相対パスです。デフォルトの""ではワークスペースの全てのtjsファイルが検索されます。
例えば、"src\\"と設定するとワークスペースのsrcディレクトリ以下のtjsファイルのみが検索されます。

### tjs.ctagsFileExtensions
ctagsのファイル検索時にtjsファイルとして認識される拡張子です。デフォルトでは拡張子が".tjs"のファイルのみがtjsファイルとして扱われます。

### tjs.ctagsExtraOption
ctagsを実行するときに渡される追加のコマンドラインオプションです。


# 連絡先
バグや機能追加の提案などは[issues](https://github.com/sakano/tjs-vscode/issues)に連絡してください。
