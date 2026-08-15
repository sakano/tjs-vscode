import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
    mkdir,
    mkdtemp,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import {
    buildCtagsArguments,
    createCtagsSpawnOptions,
    isValidCtagsLine,
    parseCtagsProcesses,
    parseRunOnSaveLanguages,
    tokenizeLegacyExtraOption,
    validateExtraArgs,
    waitForCtagsProcess,
    type CtagsProcessConfiguration,
} from '../ctags';
import {
    assertReplaceableTagFile,
    getNonRecursiveInputFileLines,
    MAX_TAG_FILE_FIRST_LINE_BYTES,
    prepareCtagsPaths,
    resolveCtagsPaths,
} from '../ctags/paths';
import {
    createCtagsOutputForwarder,
    CtagsOutputLimitError,
    writeNonRecursiveInputFiles,
    type CtagsOutputLimits,
} from '../ctags/process';
import {
    createFakeChildProcess,
    createOutputChannelStub,
    getTestWorkspaceFolder,
} from './testSupport';

const baseConfiguration: CtagsProcessConfiguration = {
    tagFilePath: '.tags',
    searchPath: '',
    searchRecursive: true,
    runOnSave: false,
    fileExtensions: ['.tjs'],
    extraArgs: [],
    timeoutMs: 120_000,
};

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

    // 既存タグの先頭行は固定長だけ読み、境界内の行を許可して境界超過を明示的に拒否する。
    test('bounds the existing tag file first-line read', async () => {
        const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'tjs-ctags-prefix-'));
        const tagFilePath = path.join(temporaryRoot, 'tags');
        const validPrefix = 'tag\texample.tjs\t/';
        const boundaryLine = validPrefix
            + 'x'.repeat(MAX_TAG_FILE_FIRST_LINE_BYTES - Buffer.byteLength(validPrefix));

        try {
            await writeFile(tagFilePath, `${boundaryLine}\n`, 'latin1');
            await assert.doesNotReject(
                assertReplaceableTagFile(tagFilePath, 'test.tagFilePath'),
            );

            await writeFile(tagFilePath, `${boundaryLine}x\n`, 'latin1');
            await assert.rejects(
                assertReplaceableTagFile(tagFilePath, 'test.tagFilePath'),
                new RegExp(`first line exceeds ${String(MAX_TAG_FILE_FIRST_LINE_BYTES)} bytes`, 'u'),
            );
        } finally {
            await rm(temporaryRoot, { recursive: true, force: true });
        }
    });

    // 相対パスはワークスペース基準、絶対パスはそのまま解決する。
    test('resolves relative and absolute configured paths', async () => {
        const folder = getTestWorkspaceFolder(true);
        const workspaceRoot = path.resolve(folder.uri.fsPath);
        const parentDirectory = path.dirname(workspaceRoot);
        const absoluteTagFilePath = path.join(
            parentDirectory,
            `.tjs-ctags-path-test-${String(process.pid)}.tags`,
        );

        const relativePaths = resolveCtagsPaths(folder, {
            ...baseConfiguration,
            tagFilePath: '../outside.tags',
            searchPath: '..',
        }, 0);
        assert.equal(relativePaths.tagFilePath, path.resolve(workspaceRoot, '../outside.tags'));
        assert.equal(relativePaths.searchPath, parentDirectory);

        const absoluteConfiguration = {
            ...baseConfiguration,
            tagFilePath: absoluteTagFilePath,
            searchPath: parentDirectory,
        };
        const preparedPaths = await prepareCtagsPaths(folder, absoluteConfiguration, 0);
        assert.equal(preparedPaths.tagFilePath, absoluteTagFilePath);
        assert.equal(preparedPaths.searchPath, parentDirectory);
        assert.equal(path.dirname(preparedPaths.temporaryTagFilePath), parentDirectory);
    });

    // 出力先と入力指定を末尾に組み立てる一方、リンク追跡の方針は利用者とctagsに委ねる。
    test('appends managed paths without forcing link traversal behavior', () => {
        const extraArgument = '--links=yes';
        const args = buildCtagsArguments(
            { ...baseConfiguration, extraArgs: [extraArgument] },
            '/workspace/.tags.tmp',
            '/workspace/src',
        );

        assert.ok(args.indexOf(extraArgument) < args.indexOf('-f'));
        assert.equal(args.includes('--links=no'), false);
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

    // UTF-8の文字数ではなくbyte数で1行を制限し、保持した範囲だけを診断へ転送する。
    test('truncates and rejects an overlong ctags output line by byte length', () => {
        const stream = new PassThrough();
        const logLines: string[] = [];
        const failures: CtagsOutputLimitError[] = [];
        const limits: CtagsOutputLimits = {
            maxLineBytes: 4,
            maxTotalBytes: 100,
            maxLines: 10,
        };
        const forwarder = createCtagsOutputForwarder(
            stream,
            createOutputChannelStub(logLines),
            '[test] stdout',
            'stdout',
            error => failures.push(error),
            limits,
        );

        try {
            stream.write('あab', 'utf8');
            stream.write('ignored\n', 'utf8');
            forwarder.flush();

            assert.equal(failures.length, 1);
            assert.equal(forwarder.failure, failures[0]);
            assert.match(failures[0]?.message ?? '', /4-byte line limit/u);
            assert.deepEqual(logLines, ['[test] stdout: あa… [truncated]']);
        } finally {
            forwarder.dispose();
        }
    });

    // 改行を含む複数chunkでもstream全体のbyte数を数え、途中行だけを有限長で残す。
    test('truncates and rejects ctags output beyond the total byte limit', () => {
        const stream = new PassThrough();
        const logLines: string[] = [];
        let failure: CtagsOutputLimitError | undefined;
        const forwarder = createCtagsOutputForwarder(
            stream,
            createOutputChannelStub(logLines),
            '[test] stderr',
            'stderr',
            error => {
                failure = error;
            },
            { maxLineBytes: 10, maxTotalBytes: 5, maxLines: 10 },
        );

        try {
            stream.write('a\n', 'utf8');
            stream.write('bcdX', 'utf8');

            assert.match(failure?.message ?? '', /5-byte output limit/u);
            assert.deepEqual(logLines, [
                '[test] stderr: a',
                '[test] stderr: bcd… [truncated]',
            ]);
        } finally {
            forwarder.dispose();
        }
    });

    // 空行の連打でもOutputChannel呼出し回数を行数上限内に留める。
    test('rejects ctags output beyond the line count limit', () => {
        const stream = new PassThrough();
        const logLines: string[] = [];
        let failure: CtagsOutputLimitError | undefined;
        const forwarder = createCtagsOutputForwarder(
            stream,
            createOutputChannelStub(logLines),
            '[test] stdout',
            'stdout',
            error => {
                failure = error;
            },
            { maxLineBytes: 10, maxTotalBytes: 100, maxLines: 2 },
        );

        try {
            stream.write('\n\nthird\n', 'utf8');

            assert.match(failure?.message ?? '', /2-line output limit/u);
            assert.deepEqual(logLines, ['[test] stdout: ', '[test] stdout: ']);
        } finally {
            forwarder.dispose();
        }
    });

    // CRLFは行終端のCRだけを除き、改行なしの末尾CRは従来どおり内容として保持する。
    test('preserves bounded output line ending behavior across chunks', () => {
        const stream = new PassThrough();
        const logLines: string[] = [];
        const forwarder = createCtagsOutputForwarder(
            stream,
            createOutputChannelStub(logLines),
            '[test] stdout',
            'stdout',
            error => assert.fail(error.message),
            { maxLineBytes: 20, maxTotalBytes: 100, maxLines: 10 },
        );

        try {
            stream.write('first\r', 'utf8');
            stream.write('\nsecond\r', 'utf8');
            forwarder.flush();

            assert.deepEqual(logLines, ['[test] stdout: first', '[test] stdout: second\r']);
        } finally {
            forwarder.dispose();
        }
    });

    // 巨大なflat directoryでも全件を配列化せず、stdinのbackpressureに従って通常ファイルだけを送る。
    test('streams non-recursive input files with backpressure', async () => {
        const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'tjs-ctags-input-'));
        const searchPath = path.join(temporaryRoot, 'flat');
        const firstFilePath = path.join(searchPath, 'z-first.tjs');
        const secondFilePath = path.join(searchPath, 'a second.tjs');
        const receivedChunks: Buffer[] = [];

        try {
            await mkdir(path.join(searchPath, 'nested'), { recursive: true });
            await Promise.all([
                writeFile(firstFilePath, '', 'utf8'),
                writeFile(secondFilePath, '', 'utf8'),
                writeFile(path.join(searchPath, 'nested', 'ignored.tjs'), '', 'utf8'),
            ]);

            const input = new Writable({
                highWaterMark: 1,
                write(chunk: Buffer, _encoding, callback): void {
                    setImmediate(() => {
                        receivedChunks.push(Buffer.from(chunk));
                        callback();
                    });
                },
            });
            const controller = new AbortController();

            await writeNonRecursiveInputFiles(searchPath, input, controller.signal);

            const receivedPaths = Buffer.concat(receivedChunks)
                .toString('utf8')
                .split('\n')
                .filter(line => line.length > 0);
            assert.deepEqual(
                new Set(receivedPaths),
                new Set([firstFilePath, secondFilePath]),
            );
            assert.equal(input.writableFinished, true);
        } finally {
            await rm(temporaryRoot, { recursive: true, force: true });
        }
    });

    // backpressure待機中の中断でも列挙を停止し、directory handleとstdinを閉じる。
    test('cancels non-recursive input streaming', async () => {
        const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'tjs-ctags-cancel-'));
        const searchPath = path.join(temporaryRoot, 'flat');
        let releaseWrite: (() => void) | undefined;
        let notifyWriteStarted: (() => void) | undefined;
        const writeStarted = new Promise<void>(resolve => {
            notifyWriteStarted = resolve;
        });

        try {
            await mkdir(searchPath);
            await writeFile(path.join(searchPath, 'example.tjs'), '', 'utf8');

            const input = new Writable({
                highWaterMark: 1,
                write(_chunk: Buffer, _encoding, callback): void {
                    releaseWrite = () => callback();
                    notifyWriteStarted?.();
                },
            });
            const controller = new AbortController();
            const writing = writeNonRecursiveInputFiles(searchPath, input, controller.signal);

            await writeStarted;
            controller.abort();
            releaseWrite?.();

            await assert.rejects(
                writing,
                (error: unknown) => error instanceof Error && error.name === 'AbortError',
            );
            assert.equal(input.destroyed, true);
        } finally {
            releaseWrite?.();
            await rm(temporaryRoot, { recursive: true, force: true });
        }
    });

    // generator単体でも中断を各entry間で検出し、以降の列挙を続けない。
    test('checks cancellation while enumerating non-recursive files', async () => {
        const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'tjs-ctags-iterate-'));
        const controller = new AbortController();
        let iterator: AsyncGenerator<string> | undefined;

        try {
            await writeFile(path.join(temporaryRoot, 'example.tjs'), '', 'utf8');
            iterator = getNonRecursiveInputFileLines(temporaryRoot, controller.signal);

            const first = await iterator.next();
            assert.equal(first.done, false);

            const cancellation = new Error('cancel directory iteration');
            controller.abort(cancellation);
            await assert.rejects(iterator.next(), error => error === cancellation);
        } finally {
            controller.abort();
            await iterator?.return(undefined);
            await rm(temporaryRoot, { recursive: true, force: true });
        }
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
