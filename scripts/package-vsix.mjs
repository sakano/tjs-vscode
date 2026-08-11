/**
 * @fileOverview Creates a reproducible VSIX and optionally verifies byte-identical builds.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import vsce from '@vscode/vsce';

const { createVSIX, listFiles, PackageManager } = vsce;
const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const expectedFiles = [
    'CHANGELOG.md',
    'LICENSE',
    'README-ja.md',
    'README.md',
    'dist/extension.js',
    'images/tjsicon.png',
    'language-configuration.json',
    'package.json',
    'package.nls.ja.json',
    'package.nls.json',
    'snippets/tjs.json',
    'syntaxes/tjs.tmLanguage.json'
];
const expectedManifestFiles = expectedFiles.filter(file => file !== 'package.json');

function compareFileLists(actual, expected, description) {
    const actualSorted = [...actual].sort();
    const expectedSorted = [...expected].sort();

    if (JSON.stringify(actualSorted) === JSON.stringify(expectedSorted)) {
        return;
    }

    const actualSet = new Set(actualSorted);
    const expectedSet = new Set(expectedSorted);
    const missing = expectedSorted.filter(file => !actualSet.has(file));
    const unexpected = actualSorted.filter(file => !expectedSet.has(file));
    throw new Error([
        `${description} does not match the reviewed allowlist.`,
        missing.length > 0 ? `Missing: ${missing.join(', ')}` : undefined,
        unexpected.length > 0 ? `Unexpected: ${unexpected.join(', ')}` : undefined
    ].filter(Boolean).join('\n'));
}

function validateEpoch(value) {
    if (!/^\d+$/.test(value)) {
        throw new Error('SOURCE_DATE_EPOCH must contain Unix timestamp digits only.');
    }

    const epoch = Number(value);
    if (!Number.isSafeInteger(epoch) || epoch < 315532800) {
        throw new Error('SOURCE_DATE_EPOCH must be a safe Unix timestamp on or after 1980-01-01.');
    }

    return String(epoch);
}

async function getSourceDateEpoch() {
    if (process.env.SOURCE_DATE_EPOCH !== undefined) {
        return validateEpoch(process.env.SOURCE_DATE_EPOCH);
    }

    const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%ct'], {
        cwd: root,
        encoding: 'utf8'
    });
    return validateEpoch(stdout.trim());
}

async function sha256(path) {
    const contents = await readFile(path);
    return createHash('sha256').update(contents).digest('hex');
}

async function buildVsix(packagePath) {
    await createVSIX({
        cwd: root,
        dependencies: false,
        githubBranch: 'master',
        packagePath
    });
}

async function main() {
    const arguments_ = process.argv.slice(2);
    const verify = arguments_.length === 1 && arguments_[0] === '--verify';
    if (arguments_.length > (verify ? 1 : 0)) {
        throw new Error('Usage: node scripts/package-vsix.mjs [--verify]');
    }

    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
        throw new Error('package.json must contain string name and version fields.');
    }

    const outputPath = join(root, `${manifest.name}-${manifest.version}.vsix`);
    await rm(outputPath, { force: true });

    try {
        if (!Array.isArray(manifest.files) || new Set(manifest.files).size !== manifest.files.length) {
            throw new Error('package.json#files must be a duplicate-free array.');
        }
        compareFileLists(manifest.files, expectedManifestFiles, 'package.json#files');

        const epoch = await getSourceDateEpoch();
        process.env.SOURCE_DATE_EPOCH = epoch;

        console.log(`SOURCE_DATE_EPOCH=${epoch}`);
        await buildVsix(outputPath);

        const packagedFiles = await listFiles({
            cwd: root,
            packageManager: PackageManager.None
        });
        compareFileLists(packagedFiles, expectedFiles, 'VSIX contents');

        const firstHash = await sha256(outputPath);
        console.log(`SHA-256 ${firstHash}  ${outputPath}`);

        if (!verify) {
            return;
        }

        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tjs-vscode-vsix-'));
        try {
            const secondPath = join(temporaryDirectory, `${manifest.name}-${manifest.version}.vsix`);
            await buildVsix(secondPath);
            const [firstContents, secondContents] = await Promise.all([
                readFile(outputPath),
                readFile(secondPath)
            ]);

            if (!firstContents.equals(secondContents)) {
                const secondHash = createHash('sha256').update(secondContents).digest('hex');
                throw new Error(`VSIX files are not byte-identical.\nFirst:  ${firstHash}\nSecond: ${secondHash}`);
            }
        } finally {
            await rm(temporaryDirectory, { force: true, recursive: true });
        }

        console.log('Verified: two clean builds produced byte-identical VSIX files.');
    } catch (error) {
        await rm(outputPath, { force: true });
        throw error;
    }
}

await main();
