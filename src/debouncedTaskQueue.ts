type Task = () => Promise<void>;

type ScheduledTask = {
    task: Task;
    promise: Promise<void>;
    resolve(): void;
    reject(error: unknown): void;
};

type QueueState = {
    pending: ScheduledTask | undefined;
};

function createScheduledTask(task: Task): ScheduledTask {
    let resolve: (() => void) | undefined;
    let reject: ((error: unknown) => void) | undefined;
    const promise = new Promise<void>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return {
        task,
        promise,
        resolve: () => resolve?.(),
        reject: error => reject?.(error),
    };
}

/**
 * 同じキーのタスクを直列化し、実行中に追加された要求を最新の一件へ集約します。
 * 異なるキーのタスクは互いに待機しません。
 */
export class DebouncedTaskQueue {
    private readonly queues = new Map<string, QueueState>();
    private readonly idleWaiters: Array<() => void> = [];

    public enqueue(key: string, task: Task): Promise<void> {
        const queue = this.queues.get(key);
        if (queue === undefined) {
            const newQueue: QueueState = { pending: undefined };
            const scheduledTask = createScheduledTask(task);
            this.queues.set(key, newQueue);
            void this.drain(key, newQueue, scheduledTask);
            return scheduledTask.promise;
        }

        if (queue.pending === undefined) {
            queue.pending = createScheduledTask(task);
        } else {
            queue.pending.task = task;
        }
        return queue.pending.promise;
    }

    /** 実行開始前のタスクをすべて取り消します。実行中のタスクは呼び出し側で停止します。 */
    public cancelPending(error: unknown): void {
        for (const queue of this.queues.values()) {
            const pendingTask = queue.pending;
            if (pendingTask !== undefined) {
                queue.pending = undefined;
                pendingTask.reject(error);
            }
        }
    }

    /** 現在実行中または待機中のタスクがすべて終了するまで待ちます。 */
    public whenIdle(): Promise<void> {
        if (this.queues.size === 0) {
            return Promise.resolve();
        }
        return new Promise(resolve => {
            this.idleWaiters.push(resolve);
        });
    }

    private async drain(
        key: string,
        queue: QueueState,
        initialTask: ScheduledTask,
    ): Promise<void> {
        let currentTask: ScheduledTask | undefined = initialTask;

        while (currentTask !== undefined) {
            try {
                await currentTask.task();
                currentTask.resolve();
            } catch (error) {
                currentTask.reject(error);
            }
            currentTask = queue.pending;
            queue.pending = undefined;
        }

        if (this.queues.get(key) === queue) {
            this.queues.delete(key);
        }
        if (this.queues.size === 0) {
            const idleWaiters = this.idleWaiters.splice(0);
            for (const resolve of idleWaiters) {
                resolve();
            }
        }
    }
}
