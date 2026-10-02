import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { viewsForPaths } from './db.ts';

test('batch views preserve totals and time window, with indexed queries and bounded bindings', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE pageviews_hourly (bucket TEXT, path TEXT, count INTEGER); CREATE INDEX idx_ph_path_bucket ON pageviews_hourly(path, bucket DESC)');
  const now = new Date().toISOString().slice(0, 13);
  const insert = sqlite.prepare('INSERT INTO pageviews_hourly VALUES (?, ?, ?)');
  for (let i = 0; i < 201; i++) { insert.run(now, `/post-${i}`, i + 1); insert.run('2000-01-01T00', `/post-${i}`, 9999); }
  insert.run(now, '/post-0', 10);
  insert.run(now, '/unrequested', 777);
  const queries = [];
  const DB = { prepare(sql) { const item = { sql, args: [] }; queries.push(item); return {
    bind(...args) { item.args = args; return this; },
    async all() { return { results: sqlite.prepare(sql).all(...item.args) }; },
  }; } };
  try {
    assert.equal((await viewsForPaths(DB, [], 24)).size, 0);
    assert.equal(queries.length, 0);
    const paths = Array.from({ length: 201 }, (_, i) => `/post-${i}`);
    const totals = await viewsForPaths(DB, [...paths, '/missing', '/post-0'], 24);
    assert.equal(totals.get('/post-0'), 11);
    assert.equal(totals.get('/post-200'), 201);
    assert.equal(totals.get('/missing'), 0);
    assert.equal(totals.has('/unrequested'), false);
    assert.equal(queries.length, 3);
    for (const { sql, args } of queries) {
      assert.ok(args.length <= 101);
      const plan = sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args);
      assert.match(JSON.stringify(plan), /idx_ph_path_bucket/);
      assert.doesNotMatch(JSON.stringify(plan), /SCAN pageviews_hourly/);
    }
  } finally { sqlite.close(); }
});
