import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { recordHeartbeat, countActiveVisitors, cleanupStaleVisitors } from './db.ts';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  const queries = [];
  const DB = { prepare(sql) {
    queries.push(sql);
    let args = [];
    const stmt = {
      bind(...values) { args = values; return stmt; },
      async run() { return sqlite.prepare(sql).run(...args); },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    };
    return stmt;
  }};
  return { sqlite, queries, DB };
}

test('existing visitors table: 1000 heartbeats and admin reads execute zero DDL', async () => {
  const { sqlite, queries, DB } = database();
  sqlite.exec('CREATE TABLE active_visitors (visitor_id TEXT PRIMARY KEY, path TEXT, last_seen INTEGER)');
  try {
    for (let i = 0; i < 1000; i++) await recordHeartbeat(DB, `visitor-${i}`, '/artigo');
    assert.equal(await countActiveVisitors(DB), 1000);
    await cleanupStaleVisitors(DB);
    assert.equal(queries.filter(sql => /CREATE/.test(sql)).length, 0);
    assert.equal(await countActiveVisitors(DB), 1000);
  } finally { sqlite.close(); }
});

test('missing visitors table: concurrent calls share recovery and preserve every heartbeat', async () => {
  const { sqlite, queries, DB } = database();
  try {
    await Promise.all(Array.from({ length: 50 }, (_, i) => recordHeartbeat(DB, `visitor-${i}`, '/artigo')));
    assert.equal(await countActiveVisitors(DB), 50);
    assert.equal(queries.filter(sql => /CREATE TABLE/.test(sql)).length, 1);
    assert.equal(queries.filter(sql => /CREATE INDEX/.test(sql)).length, 1);
    const plan = sqlite.prepare('EXPLAIN QUERY PLAN SELECT COUNT(*) FROM active_visitors WHERE last_seen >= ?').all(0);
    assert.match(JSON.stringify(plan), /idx_active_visitors_last_seen/);
    sqlite.exec('INSERT INTO active_visitors VALUES (\'stale\', \'/\', 0)');
    await cleanupStaleVisitors(DB);
    assert.equal(await countActiveVisitors(DB), 50);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM active_visitors').get().n, 50);
  } finally { sqlite.close(); }
});

test('admin count can bootstrap an empty database', async () => {
  const { sqlite, DB } = database();
  try { assert.equal(await countActiveVisitors(DB), 0); } finally { sqlite.close(); }
});

test('unrelated database errors never trigger DDL or a retry', async () => {
  for (const message of ['D1 unavailable', 'no such table: other_table', 'no such column: last_seen']) {
    let calls = 0;
    const DB = { prepare() { calls++; return { bind() { return this; }, async run() { throw Error(message); } }; } };
    await assert.rejects(recordHeartbeat(DB, 'a', '/'), { message });
    assert.equal(calls, 1);
  }
});

test('failed bootstrap backs off instead of issuing DDL on every heartbeat', async () => {
  let ddl = 0;
  const DB = { prepare(sql) { return { bind() { return this; }, async run() {
    if (/CREATE/.test(sql)) { ddl++; throw Error('D1 unavailable'); }
    throw Error('D1_ERROR: no such table: active_visitors: SQLITE_ERROR');
  } }; } };
  for (let i = 0; i < 20; i++) await assert.rejects(recordHeartbeat(DB, 'a', '/'), /D1 unavailable/);
  assert.equal(ddl, 1);
});
