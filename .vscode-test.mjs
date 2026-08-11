import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
    {
        label: 'minimum',
        files: 'out/test/**/*.test.js',
        version: '1.125.0',
        workspaceFolder: './src/test/fixtures/trusted-workspace',
    },
    {
        label: 'stable',
        files: 'out/test/**/*.test.js',
        version: 'stable',
        workspaceFolder: './src/test/fixtures/trusted-workspace',
    },
]);
