/**
 * ctags機能の公開facade。
 *
 * 実装は設定解析、パス検証、プロセス実行、VS Code Providerへ分割し、
 * 既存のimport先を維持するため、このモジュールから必要なAPIだけを再公開します。
 */
export {
    parseCtagsProcesses,
    parseRunOnSaveLanguages,
    tokenizeLegacyExtraOption,
    validateExtraArgs,
    type CtagsProcessConfiguration,
} from './ctags/configuration';
export {
    isPathInside,
    isValidCtagsLine,
    resolveWorkspaceRelativePath,
} from './ctags/paths';
export {
    buildCtagsArguments,
    createCtagsSpawnOptions,
    waitForCtagsProcess,
} from './ctags/process';
export { CTagsSupportProvider } from './ctags/provider';
