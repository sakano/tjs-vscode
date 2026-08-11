/**
 * @fileOverview Runs npm scripts sequentially or in parallel without an external task runner.
 */

import { spawn } from 'node:child_process';

const arguments_ = process.argv.slice(2);
const parallel = arguments_[0] === '--parallel';
const scripts = parallel ? arguments_.slice(1) : arguments_;
const npmExecPath = process.env.npm_execpath;

if (scripts.length === 0 || scripts.some(script => script.startsWith('-'))) {
    throw new Error('Usage: node scripts/run-scripts.mjs [--parallel] <script>...');
}

if (!npmExecPath) {
    throw new Error('This script must be started by npm so npm_execpath is available.');
}

function startScript(script) {
    const child = spawn(process.execPath, [npmExecPath, 'run', script], {
        env: process.env,
        stdio: 'inherit'
    });
    const completion = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            resolve({ code, script, signal });
        });
    });
    return { child, completion };
}

function assertSucceeded(result) {
    if (result.signal) {
        throw new Error(`npm run ${result.script} terminated by ${result.signal}.`);
    }
    if (result.code !== 0) {
        throw new Error(`npm run ${result.script} failed with exit code ${result.code}.`);
    }
}

async function runSequentially() {
    for (const script of scripts) {
        const running = startScript(script);
        assertSucceeded(await running.completion);
    }
}

async function runInParallel() {
    const running = scripts.map(startScript);
    let stopping = false;

    function stopOthers(completedChild) {
        if (stopping) {
            return;
        }
        stopping = true;
        for (const item of running) {
            if (item.child !== completedChild && item.child.exitCode === null && item.child.signalCode === null) {
                item.child.kill();
            }
        }
    }

    for (const item of running) {
        void item.completion.then(() => stopOthers(item.child));
    }

    const results = await Promise.all(running.map(item => item.completion));
    for (const result of results) {
        assertSucceeded(result);
    }
}

if (parallel) {
    await runInParallel();
} else {
    await runSequentially();
}
