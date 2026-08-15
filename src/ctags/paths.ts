import { randomUUID } from 'node:crypto';
import {
    lstat,
    open,
    readdir,
    stat,
    unlink,
} from 'node:fs/promises';
import * as path from 'node:path';
import type * as vscode from 'vscode';

import type { CtagsProcessConfiguration } from './configuration';

export type ResolvedCtagsPaths = {
    workspaceRoot: string;
    tagFilePath: string;
    searchPath: string;
    tagSettingPath: string;
    searchSettingPath: string;
};

export type PreparedCtagsPaths = ResolvedCtagsPaths & {
    temporaryTagFilePath: string;
};

/** 設定された検索先と出力先を絶対パスへ解決します。 */
export function resolveCtagsPaths(
    folder: vscode.WorkspaceFolder,
    configuration: CtagsProcessConfiguration,
    processIndex: number,
): ResolvedCtagsPaths {
    const workspaceRoot = path.resolve(folder.uri.fsPath);
    const settingPath = `tjs.ctagsProcess[${processIndex}]`;
    const tagSettingPath = `${settingPath}.tagFilePath`;
    const searchSettingPath = `${settingPath}.searchPath`;

    return {
        workspaceRoot,
        tagFilePath: path.resolve(workspaceRoot, configuration.tagFilePath),
        searchPath: path.resolve(workspaceRoot, configuration.searchPath || '.'),
        tagSettingPath,
        searchSettingPath,
    };
}

/** ctagsが有効なCtags形式の先頭行とみなすかを判定します。 */
export function isValidCtagsLine(rawLine: string): boolean {
    const nulIndex = rawLine.indexOf('\0');
    const line = nulIndex < 0 ? rawLine : rawLine.slice(0, nulIndex);
    const firstTab = line.indexOf('\t');
    const secondTab = firstTab < 0 ? -1 : line.indexOf('\t', firstTab + 1);

    if (firstTab <= 0 || secondTab <= firstTab + 1) {
        return false;
    }

    const tagName = line.slice(0, firstTab);
    const sourceFile = line.slice(firstTab + 1, secondTab);
    const address = line.slice(secondTab + 1);
    if (tagName.startsWith('#') || sourceFile.endsWith(';') || address.length === 0) {
        return false;
    }
    if (address.startsWith('/') || address.startsWith('?')) {
        return true;
    }

    const extensionSeparator = address.indexOf(';');
    const lineNumber = extensionSeparator < 0 ? address : address.slice(0, extensionSeparator);
    return /^[0-9]+$/u.test(lineNumber);
}

function isErrnoException(error: unknown, code: string): boolean {
    return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

async function fileHasValidTagFilePrefix(tagFilePath: string): Promise<boolean> {
    const file = await open(tagFilePath, 'r');
    const firstBytes = Buffer.alloc(2);

    try {
        const { bytesRead } = await file.read(firstBytes, 0, firstBytes.length, 0);
        if (bytesRead === 0) {
            return true;
        }
        if (
            bytesRead === 2
            && firstBytes[0] === 0x0c
            && (firstBytes[1] === 0x0a || firstBytes[1] === 0x0d)
        ) {
            return true;
        }

        for await (const line of file.readLines({ encoding: 'latin1' })) {
            return isValidCtagsLine(line);
        }
        return false;
    } finally {
        await file.close();
    }
}

/** 既存の出力先が、ctags自身も上書きを許可する通常のタグファイルか確認します。 */
export async function assertReplaceableTagFile(
    tagFilePath: string,
    settingPath: string,
): Promise<void> {
    try {
        const targetStats = await lstat(tagFilePath);
        if (targetStats.isSymbolicLink()) {
            throw new Error(`${settingPath} must not refer to a symbolic link.`);
        }
        if (!targetStats.isFile()) {
            throw new Error(`${settingPath} must refer to a regular file.`);
        }
        if (!await fileHasValidTagFilePrefix(tagFilePath)) {
            throw new Error(`${settingPath} does not look like a tag file; refusing to overwrite it.`);
        }
    } catch (error) {
        if (!isErrnoException(error, 'ENOENT')) {
            throw error;
        }
    }
}

/** ctagsが生成した一時ファイルが通常ファイルであることを確認します。 */
export async function assertGeneratedTagFile(tagFilePath: string): Promise<void> {
    const temporaryFileStats = await lstat(tagFilePath);
    if (!temporaryFileStats.isFile() || temporaryFileStats.isSymbolicLink()) {
        throw new Error('ctags did not create a regular tag file.');
    }
}

/** 非再帰検索用に、検索ディレクトリ直下の通常ファイルを決定的な順序で列挙します。 */
export async function getNonRecursiveInputFiles(searchPath: string): Promise<string[]> {
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

/** 設定パスが期待するファイル種別であることを確認します。 */
export async function prepareCtagsPaths(
    folder: vscode.WorkspaceFolder,
    configuration: CtagsProcessConfiguration,
    processIndex: number,
): Promise<PreparedCtagsPaths> {
    const paths = resolveCtagsPaths(folder, configuration, processIndex);

    const searchStats = await stat(paths.searchPath);
    if (!searchStats.isDirectory()) {
        throw new Error(`${paths.searchSettingPath} must refer to a directory.`);
    }

    const tagDirectory = path.dirname(paths.tagFilePath);
    const tagDirectoryStats = await stat(tagDirectory);
    if (!tagDirectoryStats.isDirectory()) {
        throw new Error(`${paths.tagSettingPath} parent must be a directory.`);
    }
    await assertReplaceableTagFile(paths.tagFilePath, paths.tagSettingPath);

    return {
        ...paths,
        temporaryTagFilePath: path.join(
            tagDirectory,
            `.${path.basename(paths.tagFilePath)}.tjs-ctags-${randomUUID()}.tmp`,
        ),
    };
}

/** 存在する一時ファイルを削除します。存在しない場合は何もしません。 */
export async function removeFileIfExists(filePath: string): Promise<void> {
    try {
        await unlink(filePath);
    } catch (error) {
        if (!isErrnoException(error, 'ENOENT')) {
            throw error;
        }
    }
}
