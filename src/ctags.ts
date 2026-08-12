'use strict';

import { randomUUID } from 'node:crypto';
import {
    spawn,
    type ChildProcessWithoutNullStreams,
    type SpawnOptions,
} from 'node:child_process';
import {
    lstat,
    readdir,
    realpath,
    rename,
    stat,
    unlink,
} from 'node:fs/promises';
import * as path from 'node:path';
import type { Readable } from 'node:stream';
import * as vscode from 'vscode';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_RUN_ON_SAVE_LANGUAGES = ['tjs'] as const;

const TJS_REGEX_ARGS = [
    '--regex-tjs=/^[ \\t]*class[ \\t]+([a-zA-Z0-9_]+)/\\1/c,class/',
    '--regex-tjs=/^[ \\t]*function[ \\t]+([a-zA-Z0-9_]+)/\\1/f,function/',
    '--regex-tjs=/^[ \\t]*property[ \\t]+([a-zA-Z0-9_]+)/\\1/p,property/',
    '--regex-tjs=/^[ \\t]*var[ \\t]+([a-zA-Z0-9_]+)/\\1/v,value/',
    '--regex-tjs=/^[ \\t]*const[ \\t]+([a-zA-Z0-9_]+)/\\1/v,value/',
    '--regex-tjs=/^[ \\t]*([a-zA-Z0-9_]+)[ \\t]*:[ \\t]*function/\\1/f,function/',
    '--regex-tjs=/([a-zA-Z0-9_]+)[ \\t]*=[ \\t]*function/\\1/f,function/',
] as const;

const FORBIDDEN_EXTRA_ARG_PATTERNS = [
    /^-[fo]/,
    /^-L/,
    /^-a(?:$|[^-])/,
    /^--(?:append|file-list|filter(?:-terminator)?|options(?:-maybe)?|output)(?:=|$)/,
] as const;

/** ctagsでタグファイルを生成するための設定 */
export type CtagsProcessConfiguration = {
    tagFilePath: string;
    searchPath: string;
    searchRecursive: boolean;
    runOnSave: boolean;
    fileExtensions: string[];
    extraArgs: string[];
    timeoutMs: number;
};

/** 設定解析中に検出した警告またはエラー */
export type ConfigurationDiagnostic = {
    severity: 'warning' | 'error';
    message: string;
};

/**
 * `tjs.ctagsProcess`を項目ごとに解析した結果。
 */
export type ParsedCtagsConfiguration = {
    processes: Array<{
        index: number;
        configuration: CtagsProcessConfiguration;
    }>;
    diagnostics: ConfigurationDiagnostic[];
};

type PathOperations = Pick<typeof path, 'isAbsolute' | 'relative' | 'sep'>;

const DEFAULT_PROCESS: Readonly<CtagsProcessConfiguration> = {
    tagFilePath: '.tags',
    searchPath: '',
    searchRecursive: true,
    runOnSave: false,
    fileExtensions: ['.tjs'],
    extraArgs: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
    process: Record<string, unknown>,
    key: 'tagFilePath' | 'searchPath',
    fallback: string,
    index: number,
): string {
    const value = process[key];
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== 'string') {
        throw new Error(`tjs.ctagsProcess[${index}].${key} must be a string.`);
    }
    if (value.includes('\0')) {
        throw new Error(`tjs.ctagsProcess[${index}].${key} must not contain NUL.`);
    }
    return value;
}

function readBoolean(
    process: Record<string, unknown>,
    key: 'searchRecursive' | 'runOnSave',
    fallback: boolean,
    index: number,
): boolean {
    const value = process[key];
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== 'boolean') {
        throw new Error(`tjs.ctagsProcess[${index}].${key} must be a boolean.`);
    }
    return value;
}

function readFileExtensions(
    process: Record<string, unknown>,
    index: number,
): string[] {
    const value = process.fileExtensions;
    if (value === undefined) {
        return [...DEFAULT_PROCESS.fileExtensions];
    }
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`tjs.ctagsProcess[${index}].fileExtensions must be a non-empty string array.`);
    }
    if (!value.every(extension => typeof extension === 'string' && extension.length > 0 && !/[\0\r\n]/u.test(extension))) {
        throw new Error(`tjs.ctagsProcess[${index}].fileExtensions must contain non-empty strings without control characters.`);
    }
    return [...value];
}

function readTimeout(process: Record<string, unknown>, index: number): number {
    const value = process.timeoutMs;
    if (value === undefined) {
        return DEFAULT_PROCESS.timeoutMs;
    }
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_TIMEOUT_MS) {
        throw new Error(`tjs.ctagsProcess[${index}].timeoutMs must be an integer from 0 to ${MAX_TIMEOUT_MS}.`);
    }
    return value as number;
}

/**
 * 非推奨の`extraOption`文字列を、シェルを介さず個別の引数へ分割します。
 *
 * 引用符と必要最小限のバックスラッシュエスケープだけを解釈し、環境変数、
 * コマンド置換、ワイルドカードなどのシェル展開は行いません。
 *
 * @param value 分割する旧形式の設定値。
 * @returns 引用符を取り除いたctags引数。
 * @throws 引用符が閉じられていない場合。
 */
export function tokenizeLegacyExtraOption(value: string): string[] {
    const result: string[] = [];
    let token = '';
    let tokenStarted = false;
    let quote: '\'' | '"' | undefined;

    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (character === '\\' && quote !== '\'') {
            const nextCharacter = value[index + 1];
            const escapesNextCharacter = nextCharacter !== undefined && (
                nextCharacter === '\\'
                || nextCharacter === quote
                || (quote === undefined && (/\s/u.test(nextCharacter) || nextCharacter === '\'' || nextCharacter === '"'))
            );
            if (escapesNextCharacter) {
                token += nextCharacter;
                tokenStarted = true;
                index++;
            } else {
                token += character;
                tokenStarted = true;
            }
            continue;
        }
        if (quote !== undefined) {
            if (character === quote) {
                quote = undefined;
            } else {
                token += character;
            }
            tokenStarted = true;
            continue;
        }
        if (character === '\'' || character === '"') {
            quote = character;
            tokenStarted = true;
            continue;
        }
        if (/\s/u.test(character)) {
            if (tokenStarted) {
                result.push(token);
                token = '';
                tokenStarted = false;
            }
            continue;
        }
        token += character;
        tokenStarted = true;
    }

    if (quote !== undefined) {
        throw new Error('extraOption contains an unclosed quote.');
    }
    if (tokenStarted) {
        result.push(token);
    }
    return result;
}

/**
 * 追加引数が文字列配列であり、ctagsの入出力境界を変更しないことを検証します。
 *
 * シェル用メタ文字は`spawn`によって展開されないため拒否せず、引数内のリテラル文字として保持します。
 *
 * @param value 検証する設定値。
 * @param settingPath エラーメッセージに含める設定項目のパス。
 * @returns 検証済みの新しい引数配列。
 * @throws 値が文字列配列でない場合、ファイルオペランドを含む場合、または予約済み引数を含む場合。
 */
export function validateExtraArgs(value: unknown, settingPath = 'extraArgs'): string[] {
    if (!Array.isArray(value)) {
        throw new Error(`${settingPath} must be a string array.`);
    }

    return value.map((argument, argumentIndex) => {
        if (typeof argument !== 'string' || argument.length === 0) {
            throw new Error(`${settingPath}[${argumentIndex}] must be a non-empty string.`);
        }
        if (/[\0\r\n]/u.test(argument)) {
            throw new Error(`${settingPath}[${argumentIndex}] must not contain control characters.`);
        }
        if (!argument.startsWith('-') || argument === '-' || argument === '--') {
            throw new Error(`${settingPath}[${argumentIndex}] must be a ctags option, not a file operand.`);
        }
        if (FORBIDDEN_EXTRA_ARG_PATTERNS.some(pattern => pattern.test(argument))) {
            throw new Error(`${settingPath}[${argumentIndex}] controls ctags input or output and is reserved by the extension.`);
        }
        return argument;
    });
}

function readExtraArgs(
    process: Record<string, unknown>,
    index: number,
    diagnostics: ConfigurationDiagnostic[],
): string[] {
    const settingPath = `tjs.ctagsProcess[${index}]`;
    if (process.extraArgs !== undefined) {
        const extraArgs = validateExtraArgs(process.extraArgs, `${settingPath}.extraArgs`);
        if (typeof process.extraOption === 'string' && process.extraOption.trim().length > 0) {
            diagnostics.push({
                severity: 'warning',
                message: `${settingPath}.extraOption is deprecated and was ignored because extraArgs is set.`,
            });
        }
        return extraArgs;
    }

    if (process.extraOption === undefined || process.extraOption === '') {
        return [];
    }
    if (typeof process.extraOption !== 'string') {
        throw new Error(`${settingPath}.extraOption must be a string.`);
    }

    const extraArgs = validateExtraArgs(
        tokenizeLegacyExtraOption(process.extraOption),
        `${settingPath}.extraOption`,
    );
    diagnostics.push({
        severity: 'warning',
        message: `${settingPath}.extraOption is deprecated; migrate it to extraArgs.`,
    });
    return extraArgs;
}

/**
 * `tjs.ctagsProcess`の値を項目ごとに解析し、形式検証を通過した設定と診断情報に分けます。
 *
 * ここでは各項目の型、値の範囲、追加引数を検証します。パスの存在やシンボリックリンクは、
 * ctagsを実行する直前に`preparePaths`で検証します。
 * 配列内の設定は個別に解析するため、一つの設定が不正でも他の正常な設定は保持されます。
 * 値が未指定の場合は安全な既定設定を一つ生成します。
 *
 * @param value VS Code設定APIから取得した未検証値。
 * @returns 形式検証を通過した設定と、解析中に検出した警告・エラー。
 */
export function parseCtagsProcesses(value: unknown): ParsedCtagsConfiguration {
    const diagnostics: ConfigurationDiagnostic[] = [];
    const rawProcesses = value === undefined ? [DEFAULT_PROCESS] : value;

    if (!Array.isArray(rawProcesses)) {
        return {
            processes: [],
            diagnostics: [{ severity: 'error', message: 'tjs.ctagsProcess must be an array.' }],
        };
    }

    const processes: ParsedCtagsConfiguration['processes'] = [];
    rawProcesses.forEach((rawProcess, index) => {
        try {
            if (!isRecord(rawProcess)) {
                throw new Error(`tjs.ctagsProcess[${index}] must be an object.`);
            }
            const tagFilePath = readString(rawProcess, 'tagFilePath', DEFAULT_PROCESS.tagFilePath, index);
            if (tagFilePath.length === 0) {
                throw new Error(`tjs.ctagsProcess[${index}].tagFilePath must not be empty.`);
            }

            processes.push({
                index,
                configuration: {
                    tagFilePath,
                    searchPath: readString(rawProcess, 'searchPath', DEFAULT_PROCESS.searchPath, index),
                    searchRecursive: readBoolean(rawProcess, 'searchRecursive', DEFAULT_PROCESS.searchRecursive, index),
                    runOnSave: readBoolean(rawProcess, 'runOnSave', DEFAULT_PROCESS.runOnSave, index),
                    fileExtensions: readFileExtensions(rawProcess, index),
                    extraArgs: readExtraArgs(rawProcess, index, diagnostics),
                    timeoutMs: readTimeout(rawProcess, index),
                },
            });
        } catch (error) {
            diagnostics.push({
                severity: 'error',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    });

    return { processes, diagnostics };
}

/**
 * 保存時更新の対象となる言語ID一覧を検証します。
 *
 * @param value `tjs.ctagsRunOnSaveLanguages`の未検証値。
 * @returns 検証済みの言語ID一覧。未指定の場合は`tjs`を返します。
 * @throws 空でない文字列の配列でない場合。
 */
export function parseRunOnSaveLanguages(value: unknown): string[] {
    if (value === undefined) {
        return [...DEFAULT_RUN_ON_SAVE_LANGUAGES];
    }
    if (!Array.isArray(value) || !value.every(language => typeof language === 'string' && language.length > 0)) {
        throw new Error('tjs.ctagsRunOnSaveLanguages must be an array of non-empty strings.');
    }
    return [...value];
}

/**
 * 候補パスがルート自身またはその配下にあるかを、パス要素単位で判定します。
 *
 * この関数は字句的な判定だけを行います。シンボリックリンクを含む実体パスの検証には
 * `realpath`で正規化した値を渡してください。
 *
 * @param rootPath 境界となるルートパス。
 * @param candidatePath 判定する候補パス。
 * @param pathOperations POSIX形式やWindows形式を明示して検証するためのパス操作。
 * @returns 候補がルート自身または配下なら`true`。
 */
export function isPathInside(
    rootPath: string,
    candidatePath: string,
    pathOperations: PathOperations = path,
): boolean {
    const relativePath = pathOperations.relative(rootPath, candidatePath);
    return relativePath === '' || (
        relativePath !== '..'
        && !relativePath.startsWith(`..${pathOperations.sep}`)
        && !pathOperations.isAbsolute(relativePath)
    );
}

/**
 * ワークスペース相対の設定値を絶対パスへ変換し、字句的に境界内であることを確認します。
 *
 * @param workspaceRoot ワークスペースフォルダーの絶対パス。
 * @param configuredPath 設定された相対パス。空文字列はワークスペースルートを表します。
 * @param settingPath エラーメッセージに含める設定項目のパス。
 * @returns ワークスペース内に解決された絶対パス。
 * @throws 絶対パスが指定された場合、またはワークスペース外へ解決された場合。
 */
export function resolveWorkspaceRelativePath(
    workspaceRoot: string,
    configuredPath: string,
    settingPath: string,
): string {
    if (path.isAbsolute(configuredPath)) {
        throw new Error(`${settingPath} must be relative to the workspace folder.`);
    }
    const resolvedPath = path.resolve(workspaceRoot, configuredPath || '.');
    if (!isPathInside(workspaceRoot, resolvedPath)) {
        throw new Error(`${settingPath} resolves outside the workspace folder.`);
    }
    return resolvedPath;
}

/**
 * 形式検証を通過した設定から、ctagsへ直接渡す引数配列を構築します。
 *
 * 拡張機能が管理するリンク追跡、出力先、再帰設定は`extraArgs`より後ろに配置し、
 * 呼び出し側の設定から上書きされないようにします。
 *
 * @param configuration 形式検証を通過したタグ生成設定。
 * @param temporaryTagFilePath ctagsに書き込ませる一時タグファイルの絶対パス。
 * @param searchPath 検索対象ディレクトリの検証済み実体パス。
 * @returns `ctags`実行ファイルへ渡す引数配列。
 */
export function buildCtagsArguments(
    configuration: CtagsProcessConfiguration,
    temporaryTagFilePath: string,
    searchPath: string,
): string[] {
    const argumentsList = [
        '--langdef=tjs',
        `--langmap=tjs:${configuration.fileExtensions.join('')}`,
        ...TJS_REGEX_ARGS,
        ...configuration.extraArgs,
        '--links=no',
        '-f',
        temporaryTagFilePath,
        configuration.searchRecursive ? '--recurse=yes' : '--recurse=no',
    ];

    if (configuration.searchRecursive) {
        argumentsList.push(searchPath);
    } else {
        argumentsList.push('-L', '-');
    }
    return argumentsList;
}

/**
 * シェルを無効化したctagsプロセス起動オプションを作成します。
 *
 * @param cwd ctagsの作業ディレクトリ。
 * @param signal タイムアウトまたは破棄時にプロセスを中止するためのシグナル。
 * @returns 標準入出力をパイプ接続し、シェルを使用しない起動オプション。
 */
export function createCtagsSpawnOptions(cwd: string, signal: AbortSignal): SpawnOptions {
    return {
        cwd,
        shell: false,
        signal,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    };
}

function isErrnoException(error: unknown, code: string): boolean {
    return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

/**
 * 既存のタグ出力先が、置換可能な通常ファイルであることを確認します。
 * 出力先がまだ存在しない場合は許可します。
 */
async function assertRegularOutputTarget(tagFilePath: string, settingPath: string): Promise<void> {
    try {
        const targetStats = await lstat(tagFilePath);
        if (targetStats.isSymbolicLink()) {
            throw new Error(`${settingPath} must not refer to a symbolic link.`);
        }
        if (!targetStats.isFile()) {
            throw new Error(`${settingPath} must refer to a regular file.`);
        }
    } catch (error) {
        if (!isErrnoException(error, 'ENOENT')) {
            throw error;
        }
    }
}

/** 非再帰検索用に、検索ディレクトリ直下の通常ファイルを決定的な順序で列挙します。 */
async function getNonRecursiveInputFiles(searchPath: string): Promise<string[]> {
    const directoryEntries = await readdir(searchPath, { withFileTypes: true });
    const inputFiles = directoryEntries
        .filter(entry => entry.isFile())
        .map(entry => path.join(searchPath, entry.name))
        .sort((left, right) => left.localeCompare(right));

    const unsupportedPath = inputFiles.find(filePath => /[\r\n]/u.test(filePath) || /\s$/u.test(filePath));
    if (unsupportedPath !== undefined) {
        throw new Error(`Cannot pass a file name containing a line break or trailing whitespace to ctags: ${unsupportedPath}`);
    }
    return inputFiles;
}

/** ctags起動前に検証・正規化したパス一式です。 */
type PreparedPaths = {
    workspaceRoot: string;
    tagFilePath: string;
    temporaryTagFilePath: string;
    searchPath: string;
};

/**
 * 設定パスをワークスペース内の実体パスへ変換し、シンボリックリンクとファイル種別を検証します。
 * タグファイルと同じディレクトリに、原子的置換用の一意な一時パスも生成します。
 */
async function preparePaths(
    folder: vscode.WorkspaceFolder,
    configuration: CtagsProcessConfiguration,
    processIndex: number,
): Promise<PreparedPaths> {
    const workspaceRoot = path.resolve(folder.uri.fsPath);
    const canonicalWorkspaceRoot = await realpath(workspaceRoot);
    const tagSettingPath = `tjs.ctagsProcess[${processIndex}].tagFilePath`;
    const searchSettingPath = `tjs.ctagsProcess[${processIndex}].searchPath`;
    const tagFilePath = resolveWorkspaceRelativePath(workspaceRoot, configuration.tagFilePath, tagSettingPath);
    const searchPath = resolveWorkspaceRelativePath(workspaceRoot, configuration.searchPath, searchSettingPath);

    const canonicalSearchPath = await realpath(searchPath);
    if (!isPathInside(canonicalWorkspaceRoot, canonicalSearchPath)) {
        throw new Error(`${searchSettingPath} resolves through a symbolic link outside the workspace folder.`);
    }
    const searchStats = await stat(canonicalSearchPath);
    if (!searchStats.isDirectory()) {
        throw new Error(`${searchSettingPath} must refer to a directory.`);
    }

    const tagDirectory = path.dirname(tagFilePath);
    const canonicalTagDirectory = await realpath(tagDirectory);
    if (!isPathInside(canonicalWorkspaceRoot, canonicalTagDirectory)) {
        throw new Error(`${tagSettingPath} resolves through a symbolic link outside the workspace folder.`);
    }
    const tagDirectoryStats = await stat(canonicalTagDirectory);
    if (!tagDirectoryStats.isDirectory()) {
        throw new Error(`${tagSettingPath} parent must be a directory.`);
    }
    await assertRegularOutputTarget(tagFilePath, tagSettingPath);

    return {
        workspaceRoot,
        tagFilePath,
        temporaryTagFilePath: path.join(
            tagDirectory,
            `.${path.basename(tagFilePath)}.tjs-ctags-${randomUUID()}.tmp`,
        ),
        searchPath: canonicalSearchPath,
    };
}

/** {@link CTagsSupportProvider}の依存関係を差し替えるためのオプション(テスト用) */
export type CTagsSupportProviderOptions = {
    outputChannel?: vscode.OutputChannel;
    spawnProcess?: typeof spawn;
    isWorkspaceTrusted?: () => boolean;
};

/** ctagsインデックスを更新する */
export class CTagsSupportProvider implements vscode.Disposable {
    private readonly outputChannel: vscode.OutputChannel;
    private readonly ownsOutputChannel: boolean;
    private readonly spawnProcess: typeof spawn;
    private readonly isWorkspaceTrusted: () => boolean;
    private readonly controllers = new Set<AbortController>();

    public constructor(options: CTagsSupportProviderOptions = {}) {
        this.outputChannel = options.outputChannel ?? vscode.window.createOutputChannel('TJS Ctags');
        this.ownsOutputChannel = options.outputChannel === undefined;
        this.spawnProcess = options.spawnProcess ?? spawn;
        this.isWorkspaceTrusted = options.isWorkspaceTrusted ?? (() => vscode.workspace.isTrusted);
    }

    public dispose(): void {
        for (const controller of this.controllers) {
            controller.abort();
        }
        this.controllers.clear();
        if (this.ownsOutputChannel) {
            this.outputChannel.dispose();
        }
    }

    /**
     * 対象フォルダーに設定されたctagsプロセスを実行します。
     *
     * @param save `true`の場合は保存時実行として扱い、`runOnSave`が有効な設定だけを実行します。
     * @param folder 対象フォルダー。省略時はアクティブ文書または利用者の選択から決定します。
     */
    public async updateCtags(save = false, folder?: vscode.WorkspaceFolder): Promise<void> {
        if (!this.isWorkspaceTrusted()) {
            this.outputChannel.appendLine('[trust] Ctags execution was blocked because the workspace is not trusted.');
            if (!save) {
                void vscode.window.showWarningMessage('TJS ctags is disabled in Restricted Mode. Trust this workspace before running ctags.');
            }
            return;
        }

        const targetFolder = folder ?? await this.selectWorkspaceFolder();
        if (targetFolder === undefined) {
            if (!save) {
                this.notifyError('No supported workspace folder is currently open.');
            }
            return;
        }
        if (!this.isSupportedWorkspaceFolder(targetFolder)) {
            this.outputChannel.appendLine(`[workspace] Ctags execution was blocked for unsupported URI scheme ${JSON.stringify(targetFolder.uri.scheme)}.`);
            if (!save) {
                this.notifyError('Ctags requires a local or VS Code Remote workspace folder.');
            }
            return;
        }

        const configuration = vscode.workspace.getConfiguration('tjs', targetFolder.uri);
        const parsedConfiguration = parseCtagsProcesses(configuration.get<unknown>('ctagsProcess'));
        this.reportConfigurationDiagnostics(parsedConfiguration.diagnostics, !save);

        const runnableProcesses = parsedConfiguration.processes
            .filter(({ configuration: processConfiguration }) => !save || processConfiguration.runOnSave);

        await Promise.allSettled(runnableProcesses.map(async ({ configuration: processConfiguration, index }) => {
            try {
                await this.executeProcess(targetFolder, processConfiguration, index);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.outputChannel.appendLine(`[ctagsProcess:${index}] ERROR ${message}`);
                if (!save) {
                    this.notifyError(`ctagsProcess[${index}] failed: ${message}`);
                }
            }
        }));
    }

    /**
     * 保存された文書の言語とワークスペースを確認し、該当する保存時ctags更新を開始します。
     *
     * @param document 保存された文書。
     */
    public async onDidSaveTextDocument(document: vscode.TextDocument): Promise<void> {
        if (!this.isWorkspaceTrusted()) {
            return;
        }
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (folder === undefined || !this.isSupportedWorkspaceFolder(folder)) {
            return;
        }

        try {
            const languages = parseRunOnSaveLanguages(
                vscode.workspace.getConfiguration('tjs', folder.uri).get<unknown>('ctagsRunOnSaveLanguages'),
            );
            if (languages.includes(document.languageId)) {
                await this.updateCtags(true, folder);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`[configuration] ERROR ${message}`);
        }
    }

    private isSupportedWorkspaceFolder(folder: vscode.WorkspaceFolder): boolean {
        return folder.uri.scheme === 'file'
            || (folder.uri.scheme === 'vscode-remote' && vscode.env.remoteName !== undefined);
    }

    private async selectWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
        const activeDocument = vscode.window.activeTextEditor?.document;
        if (activeDocument !== undefined) {
            const activeFolder = vscode.workspace.getWorkspaceFolder(activeDocument.uri);
            if (activeFolder !== undefined && this.isSupportedWorkspaceFolder(activeFolder)) {
                return activeFolder;
            }
        }

        const supportedFolders = (vscode.workspace.workspaceFolders ?? [])
            .filter(folder => this.isSupportedWorkspaceFolder(folder));
        if (supportedFolders.length === 1) {
            return supportedFolders[0];
        }
        if (supportedFolders.length === 0) {
            return undefined;
        }

        const selection = await vscode.window.showQuickPick(
            supportedFolders.map(folder => ({
                label: folder.name,
                description: folder.uri.toString(),
                folder,
            })),
            { placeHolder: 'Select the workspace folder whose ctags index should be updated.' },
        );
        return selection?.folder;
    }

    private reportConfigurationDiagnostics(
        diagnostics: readonly ConfigurationDiagnostic[],
        interactive: boolean,
    ): void {
        for (const diagnostic of diagnostics) {
            this.outputChannel.appendLine(`[configuration] ${diagnostic.severity.toUpperCase()} ${diagnostic.message}`);
            if (interactive) {
                if (diagnostic.severity === 'error') {
                    this.notifyError(diagnostic.message);
                } else {
                    void vscode.window.showWarningMessage(diagnostic.message);
                }
            }
        }
    }

    private notifyError(message: string): void {
        void vscode.window.showErrorMessage(message, 'Show Output').then(selection => {
            if (selection === 'Show Output') {
                this.outputChannel.show(true);
            }
        });
    }

    /**
     * 一つの形式検証済み設定についてパスを確認してからctagsを起動し、
     * 成功した一時タグファイルを正式な出力へ昇格させます。
     * タイムアウト、起動失敗、異常終了時には既存タグを残し、一時ファイルを削除します。
     */
    private async executeProcess(
        folder: vscode.WorkspaceFolder,
        configuration: CtagsProcessConfiguration,
        processIndex: number,
    ): Promise<void> {
        const paths = await preparePaths(folder, configuration, processIndex);
        const nonRecursiveInputFiles = configuration.searchRecursive
            ? []
            : await getNonRecursiveInputFiles(paths.searchPath);
        const argumentsList = buildCtagsArguments(
            configuration,
            paths.temporaryTagFilePath,
            paths.searchPath,
        );
        const controller = new AbortController();
        this.controllers.add(controller);
        let timedOut = false;
        let timeout: NodeJS.Timeout | undefined;
        let temporaryFileWasPromoted = false;

        this.outputChannel.appendLine(`[ctagsProcess:${processIndex}] cwd=${JSON.stringify(paths.workspaceRoot)}`);
        this.outputChannel.appendLine(`[ctagsProcess:${processIndex}] argv=${JSON.stringify(['ctags', ...argumentsList])}`);

        try {
            const child = this.spawnProcess(
                'ctags',
                argumentsList,
                createCtagsSpawnOptions(paths.workspaceRoot, controller.signal),
            ) as ChildProcessWithoutNullStreams;
            const flushStdout = this.pipeToOutput(child.stdout, `[ctagsProcess:${processIndex}] stdout`);
            const flushStderr = this.pipeToOutput(child.stderr, `[ctagsProcess:${processIndex}] stderr`);

            const completion = new Promise<void>((resolve, reject) => {
                let processError: Error | undefined;
                let inputError: Error | undefined;

                child.once('error', error => {
                    processError = error;
                });
                child.stdin.once('error', error => {
                    inputError = error;
                });
                child.once('close', (exitCode, signal) => {
                    flushStdout();
                    flushStderr();
                    if (timedOut) {
                        reject(new Error(`ctags timed out after ${configuration.timeoutMs} ms.`));
                    } else if (controller.signal.aborted) {
                        reject(new Error('ctags was cancelled.'));
                    } else if (processError !== undefined) {
                        reject(new Error(`Unable to start ctags: ${processError.message}`));
                    } else if (inputError !== undefined && exitCode === 0) {
                        reject(new Error(`Unable to send the file list to ctags: ${inputError.message}`));
                    } else if (exitCode !== 0) {
                        reject(new Error(`ctags exited with code ${String(exitCode)}${signal === null ? '' : ` (${signal})`}.`));
                    } else {
                        resolve();
                    }
                });
            });

            if (configuration.timeoutMs > 0) {
                timeout = setTimeout(() => {
                    timedOut = true;
                    controller.abort();
                }, configuration.timeoutMs);
            }

            if (configuration.searchRecursive) {
                child.stdin.end();
            } else {
                const fileList = nonRecursiveInputFiles.length === 0
                    ? ''
                    : `${nonRecursiveInputFiles.join('\n')}\n`;
                child.stdin.end(fileList, 'utf8');
            }

            await completion;
            const temporaryFileStats = await lstat(paths.temporaryTagFilePath);
            if (!temporaryFileStats.isFile() || temporaryFileStats.isSymbolicLink()) {
                throw new Error('ctags did not create a regular tag file.');
            }
            await rename(paths.temporaryTagFilePath, paths.tagFilePath);
            temporaryFileWasPromoted = true;
            this.outputChannel.appendLine(`[ctagsProcess:${processIndex}] Updated ${paths.tagFilePath}`);
        } finally {
            if (timeout !== undefined) {
                clearTimeout(timeout);
            }
            this.controllers.delete(controller);
            if (!temporaryFileWasPromoted) {
                try {
                    await unlink(paths.temporaryTagFilePath);
                } catch (error) {
                    if (!isErrnoException(error, 'ENOENT')) {
                        this.outputChannel.appendLine(`[ctagsProcess:${processIndex}] WARN Could not remove temporary file: ${String(error)}`);
                    }
                }
            }
        }
    }

    /**
     * ctagsの出力ストリームを行単位で出力チャンネルへ転送します。
     *
     * @returns 改行で終わらなかった最後の内容を転送するフラッシュ関数。
     */
    private pipeToOutput(stream: Readable, prefix: string): () => void {
        stream.setEncoding('utf8');
        let pending = '';
        stream.on('data', (chunk: string) => {
            pending += chunk;
            const lines = pending.split(/\r?\n/u);
            pending = lines.pop() ?? '';
            for (const line of lines) {
                this.outputChannel.appendLine(`${prefix}: ${line}`);
            }
        });
        return () => {
            if (pending.length > 0) {
                this.outputChannel.appendLine(`${prefix}: ${pending}`);
                pending = '';
            }
        };
    }
}
