import 'mocha/mocha';

/** VS Code Web extension hostから呼び出されるMochaテストentryです。 */
export async function run(): Promise<void> {
    mocha.setup({
        ui: 'tdd',
        reporter: undefined,
    });
    await import('./extensionTest.js');

    await new Promise<void>((resolve, reject) => {
        try {
            mocha.run(failures => {
                if (failures === 0) {
                    resolve();
                } else {
                    reject(new Error(`${failures} web extension test(s) failed.`));
                }
            });
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}
