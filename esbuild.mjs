import * as esbuild from 'esbuild';
import { join } from 'node:path';

const supportedArguments = new Set(['--production', '--watch']);
const arguments_ = new Set(process.argv.slice(2));
const root = import.meta.dirname;

for (const argument of arguments_) {
    if (!supportedArguments.has(argument)) {
        throw new Error(`Unsupported argument: ${argument}`);
    }
}

const production = arguments_.has('--production');
const watch = arguments_.has('--watch');

/**
 * @typedef {{
 *     onStart(label: string): void;
 *     onEnd(label: string): void;
 * }} WatchBuildReporter
 */

/**
 * @param {readonly string[]} labels
 * @returns {WatchBuildReporter}
 */
function createWatchBuildReporter(labels) {
    const pendingInitialBuilds = new Set(labels);
    const activeBuilds = new Set();
    let cycleStarted = false;

    return {
        onStart(label) {
            if (!cycleStarted) {
                console.log('[watch] build started');
                cycleStarted = true;
            }
            activeBuilds.add(label);
        },
        onEnd(label) {
            activeBuilds.delete(label);
            pendingInitialBuilds.delete(label);

            if (cycleStarted && activeBuilds.size === 0 && pendingInitialBuilds.size === 0) {
                console.log('[watch] build finished');
                cycleStarted = false;
            }
        },
    };
}

/**
 * @param {string} label
 * @param {WatchBuildReporter | undefined} watchBuildReporter
 * @returns {import('esbuild').Plugin}
 */
function createProblemMatcherPlugin(label, watchBuildReporter) {
    return {
        name: `problem-matcher-${label}`,
        setup(build) {
            build.onStart(() => {
                watchBuildReporter?.onStart(label);
                console.log(`[watch:${label}] build started`);
            });
            build.onEnd(result => {
                for (const error of result.errors) {
                    console.error(`✘ [ERROR] ${error.text}`);
                    if (error.location) {
                        console.error(`    ${error.location.file}:${error.location.line}:${error.location.column}:`);
                    }
                }
                console.log(`[watch:${label}] build finished`);
                watchBuildReporter?.onEnd(label);
            });
        },
    };
}

/** @satisfies {import('esbuild').BuildOptions} */
const commonOptions = {
    absWorkingDir: root,
    bundle: true,
    external: ['vscode'],
    format: 'cjs',
    logLevel: 'silent',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
};

const webEntryPoints = production
    ? ['src/web/extension.ts']
    : [
        'src/web/extension.ts',
        'src/web/test/suite/index.ts',
    ];

const watchBuildReporter = watch
    ? createWatchBuildReporter(['node', 'web'])
    : undefined;

const contexts = await Promise.all([
    esbuild.context({
        ...commonOptions,
        entryPoints: ['src/extension.ts'],
        outfile: join(root, 'dist/extension.js'),
        platform: 'node',
        plugins: [createProblemMatcherPlugin('node', watchBuildReporter)],
        target: 'node24.15',
    }),
    esbuild.context({
        ...commonOptions,
        entryPoints: webEntryPoints,
        outbase: join(root, 'src/web'),
        outdir: join(root, 'dist/web'),
        platform: 'browser',
        plugins: [createProblemMatcherPlugin('web', watchBuildReporter)],
        target: 'es2022',
    }),
]);

if (watch) {
    await Promise.all(contexts.map(context => context.watch()));
} else {
    try {
        await Promise.all(contexts.map(context => context.rebuild()));
    } finally {
        await Promise.all(contexts.map(context => context.dispose()));
    }
}
