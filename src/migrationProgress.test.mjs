import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { maybeCollectMigrationProgress } from './migrationProgress.ts';

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, 'index.ts'), 'utf8');

test('scheduled migration skips D1 progress scans', async () => {
  let calls = 0;
  const progress = await maybeCollectMigrationProgress(false, async () => {
    calls += 1;
    return { pending: 1, totalWithImages: 2, migrated: 1 };
  });

  assert.equal(progress, null);
  assert.equal(calls, 0);
  assert.match(indexSource, /collectProgress:\s*false/);
});

test('admin migration still loads progress totals', async () => {
  let calls = 0;
  const expected = { pending: 3, totalWithImages: 10, migrated: 7 };
  const progress = await maybeCollectMigrationProgress(true, async () => {
    calls += 1;
    return expected;
  });

  assert.deepEqual(progress, expected);
  assert.equal(calls, 1);
});
