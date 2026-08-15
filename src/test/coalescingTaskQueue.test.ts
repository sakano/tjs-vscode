import * as assert from 'node:assert/strict';

import { CoalescingTaskQueue } from '../coalescingTaskQueue';

type Deferred = {
    promise: Promise<void>;
    resolve(): void;
};

function createDeferred(): Deferred {
    let resolve: (() => void) | undefined;
    const promise = new Promise<void>(promiseResolve => {
        resolve = promiseResolve;
    });
    return {
        promise,
        resolve: () => resolve?.(),
    };
}

suite('Coalescing task queue', () => {
    test('serializes one resource and coalesces the same pending task', async () => {
        const queue = new CoalescingTaskQueue();
        const firstStarted = createDeferred();
        const releaseFirst = createDeferred();
        const events: string[] = [];

        const first = queue.enqueue('tags', 'process-0', async () => {
            events.push('first:start');
            firstStarted.resolve();
            await releaseFirst.promise;
            events.push('first:end');
        });
        const replaced = queue.enqueue('tags', 'process-0', () => {
            events.push('replaced');
            return Promise.resolve();
        });
        const latest = queue.enqueue('tags', 'process-0', () => {
            events.push('latest');
            return Promise.resolve();
        });

        await firstStarted.promise;
        assert.deepEqual(events, ['first:start']);
        releaseFirst.resolve();
        await Promise.all([first, replaced, latest]);

        assert.deepEqual(events, ['first:start', 'first:end', 'latest']);
    });

    test('preserves distinct tasks that target the same resource', async () => {
        const queue = new CoalescingTaskQueue();
        const firstStarted = createDeferred();
        const releaseFirst = createDeferred();
        const events: string[] = [];

        const first = queue.enqueue('tags', 'process-0', async () => {
            events.push('first:start');
            firstStarted.resolve();
            await releaseFirst.promise;
            events.push('first:end');
        });
        const second = queue.enqueue('tags', 'process-1', () => {
            events.push('second');
            return Promise.resolve();
        });

        await firstStarted.promise;
        assert.deepEqual(events, ['first:start']);
        releaseFirst.resolve();
        await Promise.all([first, second]);

        assert.deepEqual(events, ['first:start', 'first:end', 'second']);
    });

    test('runs tasks for different resources in parallel', async () => {
        const queue = new CoalescingTaskQueue();
        const firstStarted = createDeferred();
        const releaseFirst = createDeferred();
        const events: string[] = [];

        const first = queue.enqueue('first.tags', 'process-0', async () => {
            events.push('first:start');
            firstStarted.resolve();
            await releaseFirst.promise;
            events.push('first:end');
        });
        await firstStarted.promise;
        await queue.enqueue('second.tags', 'process-0', () => {
            events.push('second');
            return Promise.resolve();
        });

        assert.deepEqual(events, ['first:start', 'second']);
        releaseFirst.resolve();
        await first;
        assert.deepEqual(events, ['first:start', 'second', 'first:end']);
    });

    test('cancels pending tasks without interrupting the running task', async () => {
        const queue = new CoalescingTaskQueue();
        const firstStarted = createDeferred();
        const releaseFirst = createDeferred();
        let pendingTaskRan = false;

        const first = queue.enqueue('tags', 'process-0', async () => {
            firstStarted.resolve();
            await releaseFirst.promise;
        });
        const pending = queue.enqueue('tags', 'process-0', () => {
            pendingTaskRan = true;
            return Promise.resolve();
        });

        await firstStarted.promise;
        queue.cancelPending(new Error('cancelled'));
        await assert.rejects(pending, /cancelled/u);
        assert.equal(pendingTaskRan, false);

        releaseFirst.resolve();
        await first;
    });

    test('continues with pending work after a task fails', async () => {
        const queue = new CoalescingTaskQueue();
        const events: string[] = [];

        const failed = queue.enqueue('tags', 'process-0', () => {
            events.push('failed');
            return Promise.reject(new Error('failure'));
        });
        const next = queue.enqueue('tags', 'process-1', () => {
            events.push('next');
            return Promise.resolve();
        });

        await assert.rejects(failed, /failure/u);
        await next;
        assert.deepEqual(events, ['failed', 'next']);
    });
});
