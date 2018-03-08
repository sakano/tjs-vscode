# TJS for Visual Studio Code

Adds TJS language support for Visual Studio Code. If you needs KAG/KAGEX support, check [kagex-vscode](https://marketplace.visualstudio.com/items?itemName=Biscrat.kagex-vscode).


# Features
- Full syntax highlighting including type specifiers on Kirikiri Z
- Ctags support
- Snippets such as class, function and for loop
- The codes between "//#region" and "//#endregion" can be folded


# Optional: Ctags support
You must install ctags to use code navigation features such as "Go to Definition and "Peek definition".
## Installation
1. Install ctags and put it in your system path. I recommend [Exuberant Ctags](http://ctags.sourceforge.net/).
2. Install [ctagsx](https://marketplace.visualstudio.com/items?itemName=jtanx.ctagsx).

## Update index file
1. Open the directory which contains tjs files with Visual Studio Code.
2. Press Ctrl+Shift+P to open command palette.
3. Execute the command "TJS: Update Ctags File".

Now ".tags" file is created in your directory and you can use [ctagsx](https://marketplace.visualstudio.com/items?itemName=jtanx.ctagsx) features.

## Settings
### tjs.ctagsRunOnSave
If it is true, ctags index file is automatically recreated when tjs file is saved. It is false by default.

### tjs.ctagsFilePath
Ctags index file name. It is ".tags" by default.

### tjs.ctagsRootpath
Relative path from the workspace where ctags search tjs files. It is "" by default and all tjs files in workspace are searched.
For example, if it is "src\\", only files in src directory are searched.

### tjs.ctagsFileExtensions
File extensions which are searched as tjs file. By default, only ".tjs" file is handled as tjs file.

### tjs.ctagsExtraOption
Extra options which are passed when ctags executed.


# Issues
Submit the [issues](https://github.com/sakano/tjs-vscode/issues) if you find any bug or have any suggestion.
