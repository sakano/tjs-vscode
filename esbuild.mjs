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

function createProblemMatcherPlugin(label) {
    return {
        name: `problem-matcher-${label}`,
        setup(build) {
            build.onStart(() => {
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
            });
        },
    };
}

const commonOptions = {
    absWorkingDir: root,
    bundle: true,
    external: ['vscode'],
    format: 'cjs',
    logLevel: 'silent',
    minify: production,
    sourcemap: production ? false : true,
    sourcesContent: false,
};

const contexts = await Promise.all([
    esbuild.context({
        ...commonOptions,
        entryPoints: ['src/extension.ts'],
        outfile: join(root, 'dist/extension.js'),
        platform: 'node',
        plugins: [createProblemMatcherPlugin('node')],
        target: 'node24.15',
    }),
    esbuild.context({
        ...commonOptions,
        entryPoints: [
            'src/web/extension.ts',
            'src/web/test/suite/index.ts',
        ],
        outbase: join(root, 'src/web'),
        outdir: join(root, 'dist/web'),
        platform: 'browser',
        plugins: [createProblemMatcherPlugin('web')],
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
