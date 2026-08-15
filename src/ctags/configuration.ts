const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const DEFAULT_RUN_ON_SAVE_LANGUAGES = ['tjs'] as const;

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

export type ConfigurationDiagnostic = {
    severity: 'warning' | 'error';
    message: string;
};

type ParsedCtagsConfiguration = {
    processes: Array<{
        index: number;
        configuration: CtagsProcessConfiguration;
    }>;
    diagnostics: ConfigurationDiagnostic[];
};

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
    if (!value.every((extension): extension is string => typeof extension === 'string' && extension.length > 0 && !/[\0\r\n]/u.test(extension))) {
        throw new Error(`tjs.ctagsProcess[${index}].fileExtensions must contain non-empty strings without control characters.`);
    }
    return [...value];
}

function readTimeout(process: Record<string, unknown>, index: number): number {
    const value = process.timeoutMs;
    if (value === undefined) {
        return DEFAULT_PROCESS.timeoutMs;
    }
    if (
        typeof value !== 'number'
        || !Number.isInteger(value)
        || value < 0
        || value > MAX_TIMEOUT_MS
    ) {
        throw new Error(`tjs.ctagsProcess[${index}].timeoutMs must be an integer from 0 to ${MAX_TIMEOUT_MS}.`);
    }
    return value;
}

/**
 * 非推奨の`extraOption`文字列を、シェルを介さず個別の引数へ分割します。
 *
 * 引用符と必要最小限のバックスラッシュエスケープだけを解釈し、環境変数、
 * コマンド置換、ワイルドカードなどのシェル展開は行いません。
 */
export function tokenizeLegacyExtraOption(value: string): string[] {
    const result: string[] = [];
    let token = '';
    let tokenStarted = false;
    let quote: '\'' | '"' | undefined;

    for (let index = 0; index < value.length; index++) {
        const character = value.charAt(index);
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

/** 追加引数がプロセス引数として表現可能な文字列配列であることを検証します。 */
export function validateExtraArgs(value: unknown, settingPath = 'extraArgs'): string[] {
    if (!Array.isArray(value)) {
        throw new Error(`${settingPath} must be a string array.`);
    }

    return value.map((argument, argumentIndex) => {
        if (typeof argument !== 'string') {
            throw new Error(`${settingPath}[${argumentIndex}] must be a string.`);
        }
        if (argument.includes('\0')) {
            throw new Error(`${settingPath}[${argumentIndex}] must not contain NUL.`);
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

/** `tjs.ctagsProcess`を項目ごとに解析し、正常な設定と診断情報に分けます。 */
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

/** 保存時更新の対象となる言語ID一覧を検証します。 */
export function parseRunOnSaveLanguages(value: unknown): string[] {
    if (value === undefined) {
        return [...DEFAULT_RUN_ON_SAVE_LANGUAGES];
    }
    if (!Array.isArray(value) || !value.every((language): language is string => typeof language === 'string' && language.length > 0)) {
        throw new Error('tjs.ctagsRunOnSaveLanguages must be an array of non-empty strings.');
    }
    return [...value];
}
