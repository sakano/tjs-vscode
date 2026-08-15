import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import {
    buildCtagsArguments,
    createCtagsSpawnOptions,
    isPathInside,
    isValidCtagsLine,
    parseCtagsProcesses,
    parseRunOnSaveLanguages,
    resolveWorkspaceRelativePath,
    tokenizeLegacyExtraOption,
    validateExtraArgs,
    waitForCtagsProcess,
    type CtagsProcessConfiguration,
} from '../ctags';

const baseConfiguration: CtagsProcessConfiguration = {
    tagFilePath: '.tags',
    searchPath: '',
    searchRecursive: true,
    runOnSave: false,
    fileExtensions: ['.tjs'],
    extraArgs: [],
    timeoutMs: 120_000,
};

function createFakeChildProcess(): import('node:child_process').ChildProcessWithoutNullStreams {
    const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    return child as unknown as import('node:child_process').ChildProcessWithoutNullStreams;
}

suite('Ctags configuration', () => {
    // 設定が未指定でも、安全側の既定値だけで実行設定を組み立てられることを保証する。
    test('loads safe defaults', () => {
        const parsed = parseCtagsProcesses(undefined);

        assert.deepEqual(parsed.diagnostics, []);
        assert.deepEqual(parsed.processes, [{ index: 0, configuration: baseConfiguration }]);
    });

    // 旧形式をシェル展開せずに移行し、引用符・正規表現・Windowsパスを壊さないことを確認する。
    test('migrates legacy extraOption without shell expansion', () => {
        const parsed = parseCtagsProcesses([{
            extraOption: '--exclude="folder name" --regex-tjs=/foo\\1/ --exclude=C:\\temp',
        }]);

        const process = parsed.processes[0];
        const diagnostic = parsed.diagnostics[0];
        assert.ok(process);
        assert.ok(diagnostic);
        assert.deepEqual(process.configuration.extraArgs, [
            '--exclude=folder name',
            '--regex-tjs=/foo\\1/',
            '--exclude=C:\\temp',
        ]);
        assert.equal(parsed.diagnostics.length, 1);
        assert.equal(diagnostic.severity, 'warning');
        assert.match(diagnostic.message, /deprecated/u);
    });

    // 新旧の設定が併存した場合は、型安全なextraArgsを優先して移行結果を一意にする。
    test('prefers extraArgs over legacy extraOption', () => {
        const parsed = parseCtagsProcesses([{
            extraArgs: ['--sort=no'],
            extraOption: '--sort=yes',
        }]);

        const process = parsed.processes[0];
        const diagnostic = parsed.diagnostics[0];
        assert.ok(process);
        assert.ok(diagnostic);
        assert.deepEqual(process.configuration.extraArgs, ['--sort=no']);
        assert.match(diagnostic.message, /ignored/u);
    });

    // 曖昧な補正をせず、不正な引用符や型をプロセス起動前に設定エラーとして拒否する。
    test('rejects malformed legacy quotes and invalid field types', () => {
        assert.throws(() => tokenizeLegacyExtraOption('--exclude="unfinished'), /unclosed quote/u);

        const parsed = parseCtagsProcesses([
            { extraOption: '--exclude="unfinished' },
            { fileExtensions: 'tjs' },
            { timeoutMs: -1 },
        ]);
        assert.equal(parsed.processes.length, 0);
        assert.equal(parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length, 3);
    });

    // Ctags固有の制約は利用者とCtagsに委ね、spawnに必要な型とNULだけを検証する。
    test('minimally validates extraArgs without restricting ctags semantics', () => {
        const argumentsList = [
            '',
            'payload.tjs',
            '-',
            '--',
            '-foutside',
            '-o',
            '-Lfiles',
            '-a',
            '--append=yes',
            '--filter',
            '--options=project.ctags',
            'line one\r\nline two',
        ];

        assert.deepEqual(validateExtraArgs(argumentsList), argumentsList);
        assert.throws(() => validateExtraArgs('--sort=no'), /string array/u);
        assert.throws(() => validateExtraArgs([1]), /must be a string/u);
        assert.throws(() => validateExtraArgs(['before\0after']), /NUL/u);
    });

    // シェル用メタ文字を含む値も、展開されず単一のargv要素として扱われることを確認する。
    test('accepts shell metacharacters only as literal option content', () => {
        const argument = '--exclude=tmp; touch "marker" && echo unsafe';
        assert.deepEqual(validateExtraArgs([argument]), [argument]);

        const args = buildCtagsArguments(
            { ...baseConfiguration, extraArgs: [argument] },
            '/workspace/.tags.tmp',
            '/workspace',
        );
        assert.equal(args.filter(item => item === argument).length, 1);
    });

    // 保存時実行の言語一覧は配列だけでなく各要素まで検証し、不正値を見逃さないようにする。
    test('validates run-on-save languages by element', () => {
        assert.deepEqual(parseRunOnSaveLanguages(undefined), ['tjs']);
        assert.deepEqual(parseRunOnSaveLanguages(['tjs', 'javascript']), ['tjs', 'javascript']);
        assert.throws(() => parseRunOnSaveLanguages(['tjs', 1]), /non-empty strings/u);
    });
});

suite('Ctags paths and invocation', () => {
    // ctags本体と同じ先頭行判定で、疑似タグ・通常タグ・数値アドレスを受け入れる。
    test('recognizes the first line of Ctags files', () => {
        for (const line of [
            '!_TAG_FILE_FORMAT\t2\t/extended format/',
            'functionName\tsrc/example.tjs\t/^function functionName/;"\tf',
            'lineTag\tsrc/example.tjs\t42',
            'lineTag\tsrc/example.tjs\t42;"\tv',
            'backwardTag\tsrc/example.tjs\t?^var backwardTag?;"\tv',
        ]) {
            assert.equal(isValidCtagsLine(line), true, line);
        }
    });

    // 通常テキストや、ctagsの構文条件を一部だけ満たす行をタグファイルと誤認しない。
    test('rejects lines that Ctags would not accept as tag lines', () => {
        for (const line of [
            '{"name":"package"}',
            'plain text',
            '#tag\tsrc/example.tjs\t/^var tag/',
            'tag\t\t/^var tag/',
            'tag\tsrc/example.tjs;\t/^var tag/',
            'tag\tsrc/example.tjs\tnot-a-line-number',
            'tag\tsrc/example.tjs\t',
        ]) {
            assert.equal(isValidCtagsLine(line), false, line);
        }
    });

    // 単純な文字列前方一致による別ディレクトリや別ドライブの誤判定を防ぐ。
    test('checks POSIX and Windows containment without prefix confusion', () => {
        assert.equal(isPathInside('/workspace', '/workspace/src', path.posix), true);
        assert.equal(isPathInside('/workspace', '/workspace-other/src', path.posix), false);
        assert.equal(isPathInside('/workspace', '/outside', path.posix), false);

        assert.equal(isPathInside('C:\\workspace', 'C:\\workspace\\src', path.win32), true);
        assert.equal(isPathInside('C:\\workspace', 'C:\\workspace-other\\src', path.win32), false);
        assert.equal(isPathInside('C:\\workspace', 'D:\\workspace\\src', path.win32), false);
    });

    // タグ出力先と検索先をワークスペース内に限定し、絶対パスと親ディレクトリへの脱出を拒否する。
    test('rejects absolute paths and paths escaping the workspace', () => {
        const workspaceRoot = path.resolve('/workspace');

        assert.equal(
            resolveWorkspaceRelativePath(workspaceRoot, 'src/.tags', 'tagFilePath'),
            path.join(workspaceRoot, 'src', '.tags'),
        );
        assert.throws(
            () => resolveWorkspaceRelativePath(workspaceRoot, '../outside', 'tagFilePath'),
            /outside the workspace/u,
        );
        assert.throws(
            () => resolveWorkspaceRelativePath(workspaceRoot, path.resolve('/outside'), 'tagFilePath'),
            /must be relative/u,
        );
    });

    // 拡張機能が強制する入出力境界を末尾に置き、extraArgsから上書きできない順序を保証する。
    test('places enforced boundaries after custom arguments', () => {
        const extraArgument = '--exclude=folder with spaces;still-one-argument';
        const args = buildCtagsArguments(
            { ...baseConfiguration, extraArgs: [extraArgument] },
            '/workspace/.tags.tmp',
            '/workspace/src',
        );

        assert.ok(args.indexOf(extraArgument) < args.indexOf('--links=no'));
        assert.ok(args.indexOf('--links=no') < args.indexOf('-f'));
        assert.deepEqual(args.slice(-2), ['--recurse=yes', '/workspace/src']);
    });

    // 非再帰検索ではファイル一覧を標準入力で渡し、シェル展開とコマンドライン長制限を避ける。
    test('uses stdin file lists for non-recursive searches', () => {
        const args = buildCtagsArguments(
            { ...baseConfiguration, searchRecursive: false },
            '/workspace/.tags.tmp',
            '/workspace/src',
        );

        assert.deepEqual(args.slice(-3), ['--recurse=no', '-L', '-']);
    });

    // P0対策の中核として、パスや引数に関係なくシェルを介さずctagsを起動する。
    test('always disables the shell for the spawned process', () => {
        const controller = new AbortController();
        const options = createCtagsSpawnOptions('/workspace with spaces', controller.signal);

        assert.equal(options.cwd, '/workspace with spaces');
        assert.equal(options.killSignal, 'SIGKILL');
        assert.equal(options.shell, false);
        assert.equal(options.windowsHide, true);
        assert.equal(options.signal, controller.signal);
    });

    // 実際のNode子プロセスでも、timeout時のAbortSignalがSIGKILLとして終了させることを確認する。
    test('forcefully terminates a long-running process at timeout', async function () {
        this.timeout(5_000);
        const controller = new AbortController();
        const child = spawn(
            process.execPath,
            ['-e', "process.on('SIGTERM', () => undefined); setInterval(() => undefined, 1_000);"],
            createCtagsSpawnOptions(process.cwd(), controller.signal),
        ) as import('node:child_process').ChildProcessWithoutNullStreams;
        let closed = false;

        try {
            const result = await waitForCtagsProcess(child, controller, 25, 2_000);
            closed = result.closed;

            assert.equal(result.stopReason, 'timeout');
            assert.equal(result.closed, true);
            assert.equal(result.exitCode, null);
            assert.equal(result.signal, 'SIGKILL');
        } finally {
            if (!closed) {
                child.kill('SIGKILL');
            }
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
        }
    });

    // 強制終了要求後にcloseが来ない異常プロセスでも、関連Promiseを永久残留させない。
    test('stops waiting when a timed-out process never closes', async () => {
        const child = createFakeChildProcess();
        const controller = new AbortController();

        const result = await waitForCtagsProcess(child, controller, 1, 1);

        assert.equal(controller.signal.aborted, true);
        assert.equal(result.closed, false);
        assert.equal(result.stopReason, 'timeout');
        assert.equal(result.exitCode, null);
        assert.equal(result.signal, null);
    });

    // 強制終了後にcloseを確認できた場合は、最終待機期限を待たず終了情報を返す。
    test('uses close received during the forced-termination wait', async () => {
        const child = createFakeChildProcess();
        const controller = new AbortController();
        controller.signal.addEventListener('abort', () => {
            queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
        }, { once: true });

        const result = await waitForCtagsProcess(child, controller, 1, 1_000);

        assert.equal(result.closed, true);
        assert.equal(result.stopReason, 'timeout');
        assert.equal(result.exitCode, null);
        assert.equal(result.signal, 'SIGKILL');
    });

    // extensionのdisposeによる外部キャンセルにも、timeoutと同じ有限の終了待機を適用する。
    test('bounds the wait after external cancellation', async () => {
        const child = createFakeChildProcess();
        const controller = new AbortController();
        const completion = waitForCtagsProcess(child, controller, 0, 1);

        controller.abort();
        const result = await completion;

        assert.equal(result.closed, false);
        assert.equal(result.stopReason, 'cancelled');
    });
});
