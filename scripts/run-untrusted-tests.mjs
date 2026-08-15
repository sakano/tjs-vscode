/**
 * @fileOverview Runs extension integration tests in a genuinely untrusted VS Code workspace.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

// @vscode/test-electronの通常ランナーは--disable-workspace-trustを付与するため、
// Restricted Modeを実際に検証できるよう、このスクリプトではVS Codeを直接起動する。
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// 過去の信頼判断がテスト結果に混ざらないよう、毎回空のユーザーデータ領域を用意する。
const testStateRoot = await mkdtemp(path.join(tmpdir(), 'tjs-vscode-untrusted-'));

try {
    const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
    const extensionTestsPath = path.join(
        repositoryRoot,
        'node_modules/@vscode/test-cli/out/runner.cjs',
    );
    // 通常テストと同じMochaランナーを使い、Restricted Modeに関係するテストだけを読み込む。
    /** @type {NodeJS.ProcessEnv} */
    const testEnvironment = {
        ...process.env,
        VSCODE_TEST_OPTIONS: JSON.stringify({
            mochaOpts: { timeout: 20_000 },
            colorDefault: true,
            preload: [],
            files: [path.join(repositoryRoot, 'out/test/untrustedWorkspace.test.js')],
        }),
    };
    delete testEnvironment.ELECTRON_RUN_AS_NODE;

    // --disable-workspace-trustは意図的に含めず、未信頼fixtureをRestricted Modeで開く。
    const argumentsList = [
        path.join(repositoryRoot, 'src/test/fixtures/untrusted-workspace'),
        '--no-sandbox',
        '--disable-gpu-sandbox',
        '--disable-updates',
        '--disable-telemetry',
        '--skip-welcome',
        '--skip-release-notes',
        `--user-data-dir=${path.join(testStateRoot, 'user-data')}`,
        `--extensions-dir=${path.join(testStateRoot, 'extensions')}`,
        `--extensionDevelopmentPath=${repositoryRoot}`,
        `--extensionTestsPath=${extensionTestsPath}`,
    ];

    await new Promise((resolve, reject) => {
        const child = spawn(vscodeExecutablePath, argumentsList, {
            env: testEnvironment,
            shell: process.platform === 'win32' && vscodeExecutablePath.endsWith('.cmd'),
            stdio: 'inherit',
        });
        child.once('error', reject);
        child.once('close', (exitCode, signal) => {
            if (exitCode === 0) {
                resolve(undefined);
            } else {
                reject(new Error(`Untrusted workspace tests failed with ${exitCode ?? signal}.`));
            }
        });
    });
} finally {
    // この実行専用に作成した領域だけを対象にし、成功・失敗を問わず後始末する。
    await rm(testStateRoot, { force: true, recursive: true });
}
