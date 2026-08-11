/**
 * @fileOverview Removes generated build and test output from the repository.
 */

import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

await Promise.all([
    rm(join(root, 'dist'), { force: true, maxRetries: 3, recursive: true }),
    rm(join(root, 'out'), { force: true, maxRetries: 3, recursive: true })
]);
