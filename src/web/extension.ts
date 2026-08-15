import type { ExtensionContext } from 'vscode';

import { activateCommon } from '../commonExtension';

/** Browser WebWorker上で利用可能な機能だけを登録します。 */
export function activate(context: ExtensionContext): void {
    activateCommon(context);
}
