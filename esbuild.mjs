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

const problemMatcherPlugin = {
    name: 'problem-matcher',
    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd(result => {
            for (const error of result.errors) {
                console.error(`✘ [ERROR] ${error.text}`);
                if (error.location) {
                    console.error(`    ${error.location.file}:${error.location.line}:${error.location.column}:`);
                }
            }
            console.log('[watch] build finished');
        });
    }
};

const context = await esbuild.context({
    absWorkingDir: root,
    entryPoints: ['src/extension.ts'],
    bundle: true,
    external: ['vscode'],
    format: 'cjs',
    logLevel: 'silent',
    minify: production,
    outfile: join(root, 'dist/extension.js'),
    platform: 'node',
    plugins: [problemMatcherPlugin],
    sourcemap: production ? false : true,
    sourcesContent: false,
    target: 'node24.15'
});

if (watch) {
    await context.watch();
} else {
    try {
        await context.rebuild();
    } finally {
        await context.dispose();
    }
}
