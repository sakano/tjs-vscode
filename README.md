# TJS for Visual Studio Code

日本語版のREADMEは[こちら](https://github.com/sakano/tjs-vscode/blob/master/README-ja.md)にあります。

Adds TJS language support for Visual Studio Code. If you needs KAG/KAGEX support, check [kagex-vscode](https://marketplace.visualstudio.com/items?itemName=Biscrat.kagex-vscode).


# Features
- Full syntax highlighting including type specifiers on Kirikiri Z
- Ctags support
- Snippets such as class, function and for loop
- The codes between "//#region" and "//#endregion" can be folded
- The Reference search pallet to open API references


# Refrence search palette
You can open API references with your browser by following the steps
1. Push Ctrl+Shift+P to open the Command Pallet.
3. Execute the command "TJS: Open reference search palette".
3. Input class name to open the reference.
"Ctrl+Shift+Alt+R" is default shortcut key to open reference search palette.

## Configuration
You can choose references to search by following configuration. By default, TJS reference and kirikirZ reference is enabled.
```js
  "tjs.referencePalletEnable": {
    "tjs": true, // TJS reference
    "krkrz": true, // kirikirZ reference
    "krkr2": false, // kirikir2 reference
    "dll": false // some dll reference
  }
```

# Optional: Ctags support
You must install ctags to use code navigation features such as "Go to Definition and "Peek definition".
## Installation
1. Install ctags and put it in your system path. I recommend [Exuberant Ctags](http://ctags.sourceforge.net/).
2. Install [ctagsx](https://marketplace.visualstudio.com/items?itemName=jtanx.ctagsx) to Visual Studio Code.

## Update index file
1. Open the directory which contains tjs files with Visual Studio Code.
2. Push Ctrl+Shift+P to open command palette.
3. Execute the command "TJS: Update Ctags File".

Now ".tags" file is created in your directory and you can use [ctagsx](https://marketplace.visualstudio.com/items?itemName=jtanx.ctagsx) features.

## Configuration
You can change ctags behavior by the following configuration.
```js
  "tjs.ctagsProcess": [
    {
      "tagFilePath": ".tags", // Path to Ctags' index file
      "searchPath": "", // Path to the directory where ctags search tjs files
      "searchRecursive": true, // Whether search tjs files recursively
      "runOnSave": false, // Whether recreate the index file automatically when tjs file is saved
      "fileExtensions": [ // File extesions to be searched as tjs file
        ".tjs"
      ],
      "extraOption": "" // Command-line options which will be passed to ctags
    }
  ]
```
If you want to generate multiple index files, define multiple settings in tjs.ctagsProcess.

Below is the example to generate index files in src and out directory.
```js
  "tjs.ctagsProcess": [
    // Search tjs files in src directory and generate "src/.tags"
    {
      "tagFilePath": "src/.tags",
      "searchPath": "src/",
      "searchRecursive": true,
      "runOnSave": true,
    },
    // Search tjs files in out directory and generate "out/.tags"
    {
      "tagFilePath": "out/.tags",
      "searchPath": "out/",
      "searchRecursive": true,
      "runOnSave": true,
    }
  ]
```


# Issues
Submit the [issues](https://github.com/sakano/tjs-vscode/issues) if you find any bug or have any suggestion.
