import { defineConfig } from '@vscode/test-cli';

const trustedTestFiles = [
    'out/test/ctags.test.js',
    'out/test/debouncedTaskQueue.test.js',
    'out/test/extension.test.js',
    'out/test/providers.test.js',
];
const mocha = { timeout: 20_000 };

export default defineConfig([
    {
        label: 'minimum',
        files: trustedTestFiles,
        mocha,
        version: '1.125.0',
        workspaceFolder: './src/test/fixtures/trusted-workspace',
    },
    {
        label: 'stable',
        files: trustedTestFiles,
        mocha,
        version: 'stable',
        workspaceFolder: './src/test/fixtures/trusted-workspace',
    },
]);
