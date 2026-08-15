type Task = () => Promise<void>;

type TaskWaiter = {
    resolve(): void;
    reject(error: unknown): void;
};

type ScheduledTask = {
    taskKey: string;
    task: Task;
    waiters: TaskWaiter[];
};

type QueueState = {
    pending: ScheduledTask[];
};

/**
 * 同じリソースを更新するタスクを直列化し、同じタスクの待機中の要求を最新版へ集約します。
 * 異なるリソースに対するタスクは互いに待機しません。
 */
export class CoalescingTaskQueue {
    private readonly queues = new Map<string, QueueState>();
    private readonly idleWaiters: Array<() => void> = [];

    public enqueue(resourceKey: string, taskKey: string, task: Task): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const waiter: TaskWaiter = { resolve, reject };
            const queue = this.queues.get(resourceKey);

            if (queue === undefined) {
                const newQueue: QueueState = { pending: [] };
                this.queues.set(resourceKey, newQueue);
                void this.drain(resourceKey, newQueue, { taskKey, task, waiters: [waiter] });
                return;
            }

            const pendingTask = queue.pending.find(candidate => candidate.taskKey === taskKey);
            if (pendingTask === undefined) {
                queue.pending.push({ taskKey, task, waiters: [waiter] });
            } else {
                pendingTask.task = task;
                pendingTask.waiters.push(waiter);
            }
        });
    }

    /** 実行開始前のタスクをすべて取り消します。実行中のタスクは呼び出し側で停止します。 */
    public cancelPending(error: unknown): void {
        for (const queue of this.queues.values()) {
            const pendingTasks = queue.pending.splice(0);
            for (const pendingTask of pendingTasks) {
                for (const waiter of pendingTask.waiters) {
                    waiter.reject(error);
                }
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
        resourceKey: string,
        queue: QueueState,
        initialTask: ScheduledTask,
    ): Promise<void> {
        let currentTask: ScheduledTask | undefined = initialTask;

        while (currentTask !== undefined) {
            try {
                await currentTask.task();
                for (const waiter of currentTask.waiters) {
                    waiter.resolve();
                }
            } catch (error) {
                for (const waiter of currentTask.waiters) {
                    waiter.reject(error);
                }
            }
            currentTask = queue.pending.shift();
        }

        if (this.queues.get(resourceKey) === queue) {
            this.queues.delete(resourceKey);
        }
        if (this.queues.size === 0) {
            const idleWaiters = this.idleWaiters.splice(0);
            for (const resolve of idleWaiters) {
                resolve();
            }
        }
    }
}
