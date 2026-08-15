import * as assert from 'node:assert/strict';
import type {
    ChildProcessWithoutNullStreams,
    SpawnOptions,
} from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readdir, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import * as vscode from 'vscode';

interface Deferred {
    promise: Promise<void>;
    resolve(): void;
}

interface FakeSpawnInvocation {
    command: string;
    args: readonly string[];
    options: SpawnOptions;
}

type FakeChildProcess = ChildProcessWithoutNullStreams & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
};

export function createDeferred(): Deferred {
    let resolve: (() => void) | undefined;
    const promise = new Promise<void>(promiseResolve => {
        resolve = promiseResolve;
    });
    return {
        promise,
        resolve: () => resolve?.(),
    };
}

export function createFakeChildProcess(): FakeChildProcess {
    const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    return child as unknown as FakeChildProcess;
}

export function createSuccessfulFakeSpawn(
    defaultGeneratedTags: string,
    onInvocation?: (invocation: FakeSpawnInvocation) => string | void | Promise<string | void>,
): typeof import('node:child_process').spawn {
    return ((
        command: string,
        args: readonly string[],
        options: SpawnOptions,
    ) => {
        const child = createFakeChildProcess();

        queueMicrotask(() => {
            void (async () => {
                const generatedTags = await onInvocation?.({ command, args, options });
                const outputOptionIndex = args.indexOf('-f');
                const temporaryTagFilePath = args[outputOptionIndex + 1];
                if (outputOptionIndex < 0 || temporaryTagFilePath === undefined) {
                    throw new Error('ctags output path was not provided');
                }
                await writeFile(
                    temporaryTagFilePath,
                    generatedTags ?? defaultGeneratedTags,
                    'utf8',
                );
                child.stdout.end('generated tags\n');
                child.stderr.end('diagnostic output\n');
                child.emit('close', 0, null);
            })().catch(error => {
                child.emit('error', error);
                child.emit('close', 1, null);
            });
        });
        return child;
    }) as unknown as typeof import('node:child_process').spawn;
}

export function createOutputChannelStub(logLines?: string[]): vscode.OutputChannel {
    return {
        appendLine: (line: string) => {
            logLines?.push(line);
        },
    } as unknown as vscode.OutputChannel;
}

export function getTestWorkspaceFolder(expectedTrusted: boolean): vscode.WorkspaceFolder {
    assert.equal(
        vscode.workspace.isTrusted,
        expectedTrusted,
        `Expected a ${expectedTrusted ? 'trusted' : 'restricted'} test workspace`,
    );
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'The test workspace was not opened');
    return folder;
}

export async function activateTestExtension(): Promise<void> {
    const extension = vscode.extensions.all.find(candidate => {
        const packageJson: unknown = candidate.packageJSON;
        return typeof packageJson === 'object'
            && packageJson !== null
            && 'name' in packageJson
            && packageJson.name === 'tjs-vscode';
    });
    assert.ok(extension, 'TJS extension was not found');
    await extension.activate();
}

export async function assertTjsLanguageFeatures(folder: vscode.WorkspaceFolder): Promise<void> {
    const fixtureDocument = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(folder.uri, 'example.tjs'),
    );
    assert.equal(fixtureDocument.languageId, 'tjs');

    const foldingDocument = await vscode.workspace.openTextDocument({
        language: fixtureDocument.languageId,
        content: '//#region Example\nvar value = 1;\n//#endregion\n',
    });
    const foldingRanges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
        'vscode.executeFoldingRangeProvider',
        foldingDocument.uri,
    );
    assert.ok(
        foldingRanges?.some(range => range.start === 0 && range.end === 2),
        'A region folding range was not provided',
    );
}

export async function getTemporaryTagFiles(tagFilePath: string): Promise<string[]> {
    const directory = path.dirname(tagFilePath);
    const temporaryFilePrefix = `.${path.basename(tagFilePath)}.tjs-ctags-`;
    return (await readdir(directory))
        .filter(fileName => fileName.startsWith(temporaryFilePrefix));
}

export async function cleanupTagOutput(tagFilePath: string): Promise<void> {
    const removeFile = async (filePath: string): Promise<void> => {
        try {
            await unlink(filePath);
        } catch (error) {
            if (!(error instanceof Error)
                || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
    };

    await removeFile(tagFilePath);
    const directory = path.dirname(tagFilePath);
    await Promise.all((await getTemporaryTagFiles(tagFilePath))
        .map(fileName => removeFile(path.join(directory, fileName))));
}
