import * as assert from 'node:assert/strict';

import { DebouncedTaskQueue } from '../debouncedTaskQueue';
import { createDeferred } from './testSupport';

suite('Debounced task queue', () => {
    test('serializes one key and runs only the latest pending task', async () => {
        const queue = new DebouncedTaskQueue();
        const firstStarted = createDeferred();
        const releaseFirst = createDeferred();
        const events: string[] = [];

        const first = queue.enqueue('process-0', async () => {
            events.push('first:start');
            firstStarted.resolve();
            await releaseFirst.promise;
            events.push('first:end');
        });
        const replaced = queue.enqueue('process-0', () => {
            events.push('replaced');
            return Promise.resolve();
        });
        const latest = queue.enqueue('process-0', () => {
            events.push('latest');
            return Promise.resolve();
        });

        assert.equal(replaced, latest);
        await firstStarted.promise;
        assert.deepEqual(events, ['first:start']);
        releaseFirst.resolve();
        await Promise.all([first, replaced, latest]);

        assert.deepEqual(events, ['first:start', 'first:end', 'latest']);
    });

    test('runs different keys in parallel', async () => {
        const queue = new DebouncedTaskQueue();
        const firstStarted = createDeferred();
        const releaseFirst = createDeferred();
        const events: string[] = [];

        const first = queue.enqueue('process-0', async () => {
            events.push('first:start');
            firstStarted.resolve();
            await releaseFirst.promise;
            events.push('first:end');
        });
        await firstStarted.promise;
        await queue.enqueue('process-1', () => {
            events.push('second');
            return Promise.resolve();
        });

        assert.deepEqual(events, ['first:start', 'second']);
        releaseFirst.resolve();
        await first;
        assert.deepEqual(events, ['first:start', 'second', 'first:end']);
    });

    test('continues with the latest pending task after a failure', async () => {
        const queue = new DebouncedTaskQueue();
        const releaseFailure = createDeferred();
        const events: string[] = [];

        const failed = queue.enqueue('process-0', async () => {
            events.push('failed');
            await releaseFailure.promise;
            throw new Error('failure');
        });
        const next = queue.enqueue('process-0', () => {
            events.push('next');
            return Promise.resolve();
        });

        releaseFailure.resolve();
        await assert.rejects(failed, /failure/u);
        await next;
        assert.deepEqual(events, ['failed', 'next']);
    });

    test('cancels a pending task without interrupting the running task', async () => {
        const queue = new DebouncedTaskQueue();
        const firstStarted = createDeferred();
        const releaseFirst = createDeferred();
        let pendingTaskRan = false;

        const first = queue.enqueue('process-0', async () => {
            firstStarted.resolve();
            await releaseFirst.promise;
        });
        const pending = queue.enqueue('process-0', () => {
            pendingTaskRan = true;
            return Promise.resolve();
        });

        await firstStarted.promise;
        queue.cancelPending(new Error('cancelled'));
        await assert.rejects(pending, /cancelled/u);
        assert.equal(pendingTaskRan, false);

        releaseFirst.resolve();
        await first;
        await queue.whenIdle();
    });
});
