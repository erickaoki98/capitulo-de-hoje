import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import * as dbFunctions from './db.ts';

const migrationUrl = new URL('../migrations/0006_archive_categories.sql', import.meta.url);
const schemaUrl = new URL('../schema.sql', import.meta.url);
const indexUrl = new URL('./index.ts', import.meta.url);
const renderUrl = new URL('./render.ts', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const publishScriptUrl = new URL('../scripts/publish-archive.mjs', import.meta.url);

const ARCHIVED_VARIANTS = [
  'Coração Acelerado',
  'coração acelerado',
  'CORAÇÃO ACELERADO',
  'Coracao Acelerado',
  'coracao-acelerado',
  '  Coração__Acelerado!  ',
  'Coração Acelerado'.normalize('NFD'),
  'Coração\u00a0Acelerado',
  'Coração—Acelerado',
  'Coração💓Acelerado',
];

const PUBLIC_LOOKALIKES = [
  'Coração Muito Acelerado',
  'Coração Desacelerado',
  'Coração Não Acelerado',
];

function fakeDb({ rows = [], firstRow = null } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql, binds: [] };
      calls.push(call);
      const statement = {
        bind(...binds) {
          call.binds = binds;
          return statement;
        },
        async all() {
          return { results: rows };
        },
        async first() {
          return firstRow;
        },
      };
      return statement;
    },
  };
  return { db, calls };
}

function asD1(sqlite) {
  return {
    prepare(sql) {
      let binds = [];
      const statement = {
        bind(...values) {
          binds = values;
          return statement;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...binds) };
        },
        async first() {
          return sqlite.prepare(sql).get(...binds) ?? null;
        },
        async run() {
          const result = sqlite.prepare(sql).run(...binds);
          return { meta: { last_row_id: Number(result.lastInsertRowid) } };
        },
      };
      return statement;
    },
  };
}

function createPostsDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      category TEXT,
      tags TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT 'Erick Aoki',
      hero_image TEXT,
      draft INTEGER NOT NULL DEFAULT 0,
      pub_date INTEGER NOT NULL DEFAULT 0,
      updated_date INTEGER NOT NULL DEFAULT 0,
      source_url TEXT
    );
    CREATE TABLE pageviews_hourly (
      bucket TEXT NOT NULL,
      path TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (bucket, path)
    );
  `);
  return sqlite;
}

function insertPost(sqlite, slug, category, title = slug) {
  sqlite.prepare(
    `INSERT INTO posts
       (slug, title, description, content, category, draft, pub_date, updated_date)
     VALUES (?, ?, '', '', ?, 0, ?, ?)`,
  ).run(slug, title, category, Date.now(), Date.now());
}

function assertPublicVisibility(sql) {
  assert.match(sql, /\bdraft\s*=\s*0\b/i);
  assert.match(sql, /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+archived_categories\b/i);
  assert.match(sql, /category_value\s+LIKE\s+replace\(archived_match\.archive_key,\s*' ',\s*'%'\)/i);
  assert.match(sql, /NOT\s+GLOB\s+'\*\[a-z0-9\]\*'/i);
  assert.doesNotMatch(sql, /archived\.category\s*=/i);
}

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `seção não encontrada: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `fim da seção não encontrado: ${end}`);
  return source.slice(startAt, endAt);
}

test('normalização compartilhada produz a mesma chave para acentos, caixa, espaços e pontuação', async () => {
  const archive = await import('./archive.ts');
  assert.equal(typeof archive.normalizeCategoryKey, 'function');
  for (const category of ARCHIVED_VARIANTS) {
    assert.equal(archive.normalizeCategoryKey(category), 'coracao acelerado');
  }
  for (const category of PUBLIC_LOOKALIKES) {
    assert.notEqual(archive.normalizeCategoryKey(category), 'coracao acelerado');
  }
  assert.equal(archive.normalizeCategoryKey(null), '');
});

test('migration e schema persistem chave canônica, nome editorial e trigger sem alterar posts', async () => {
  const [migration, schema, archive] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(schemaUrl, 'utf8'),
    import('./archive.ts'),
  ]);

  for (const sql of [migration, schema]) {
    assert.match(sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+archived_categories\s*\(\s*category_key\s+TEXT\s+PRIMARY\s+KEY\s*,\s*category\s+TEXT\s+NOT\s+NULL/is);
    assert.match(sql, /INSERT\s+OR\s+IGNORE\s+INTO\s+archived_categories\s*\(\s*category_key\s*,\s*category\s*,\s*archived_at\s*\)\s*VALUES\s*\(\s*'coracao acelerado'\s*,\s*'Coração Acelerado'\s*,\s*unixepoch\(\)\s*\)/is);
    assert.match(sql, /CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+posts_block_archived_category\s+BEFORE\s+INSERT\s+ON\s+posts/is);
    assert.ok(
      sql.includes(archive.sqlArchivedCategoryMatch('NEW.category', 'archived.category_key')),
      'migration/schema devem usar o match SQL compartilhado por tokens',
    );
  }

  assert.doesNotMatch(migration, /\b(?:DELETE\s+FROM|UPDATE)\s+posts\b/i);
});

test('trigger real bloqueia todas as variantes arquivadas, permite ativa e preserva edição histórica', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const sqlite = createPostsDatabase();
  insertPost(sqlite, 'historico', 'CORAÇÃO ACELERADO', 'Título antigo');
  sqlite.exec(migration);
  sqlite.exec(migration); // retry seguro se um passo posterior da publicação falhar

  insertPost(sqlite, 'ativa', 'A Nobreza do Amor');
  for (const [index, category] of ARCHIVED_VARIANTS.entries()) {
    assert.throws(
      () => insertPost(sqlite, `bloqueada-${index}`, category),
      /category is archived/i,
      category,
    );
  }
  for (const [index, category] of PUBLIC_LOOKALIKES.entries()) {
    assert.doesNotThrow(() => insertPost(sqlite, `parecida-${index}`, category), category);
  }

  sqlite.prepare("UPDATE posts SET title = 'Título revisado' WHERE slug = 'historico'").run();
  assert.equal(sqlite.prepare("SELECT title FROM posts WHERE slug = 'historico'").get().title, 'Título revisado');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 2 + PUBLIC_LOOKALIKES.length);
  sqlite.close();
});

test('consultas públicas executadas em SQLite real ocultam todas as variantes e admin preserva o histórico', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const sqlite = createPostsDatabase();
  for (const [index, category] of ARCHIVED_VARIANTS.entries()) {
    insertPost(sqlite, `legada-${index}`, category);
  }
  for (const [index, category] of PUBLIC_LOOKALIKES.entries()) {
    insertPost(sqlite, `parecida-${index}`, category);
  }
  insertPost(sqlite, 'ativa', 'A Nobreza do Amor');
  sqlite.exec(migration);
  const db = asD1(sqlite);

  const publicPosts = await dbFunctions.listPosts(db, { includeDrafts: false, limit: 50 });
  assert.deepEqual(
    publicPosts.map((post) => post.slug).sort(),
    ['ativa', ...PUBLIC_LOOKALIKES.map((_, index) => `parecida-${index}`)].sort(),
  );

  const adminPosts = await dbFunctions.listPosts(db, { includeDrafts: true, limit: 50 });
  assert.equal(adminPosts.length, ARCHIVED_VARIANTS.length + PUBLIC_LOOKALIKES.length + 1);
  assert.equal(await dbFunctions.countPublishedPosts(db), PUBLIC_LOOKALIKES.length + 1);
  assert.deepEqual(
    (await dbFunctions.listPostsForSitemap(db, 50, 0)).map((post) => post.slug).sort(),
    ['ativa', ...PUBLIC_LOOKALIKES.map((_, index) => `parecida-${index}`)].sort(),
  );

  assert.equal(await dbFunctions.getPublicPostBySlug(db, 'legada-2'), null);
  assert.equal((await dbFunctions.getPostBySlug(db, 'legada-2')).slug, 'legada-2');
  assert.deepEqual(await dbFunctions.getPublicPostsBySlugList(db, ['legada-2']), []);
  assert.equal((await dbFunctions.getPostsBySlugList(db, ['legada-2'])).length, 1);

  for (const category of ARCHIVED_VARIANTS) {
    assert.equal(await dbFunctions.isCategoryArchived(db, category), true, category);
  }
  for (const category of PUBLIC_LOOKALIKES) {
    assert.equal(await dbFunctions.isCategoryArchived(db, category), false, category);
  }
  assert.deepEqual(
    [...await dbFunctions.listArchivedCategoryKeys(db)],
    ['coracao acelerado'],
  );
  assert.equal(await dbFunctions.isCategoryArchived(db, null), false);
  sqlite.close();
});

test('consultas públicas centralizam a comparação pela chave canônica', async () => {
  const publicList = fakeDb();
  await dbFunctions.listPosts(publicList.db, { includeDrafts: false, limit: 12 });
  assertPublicVisibility(publicList.calls[0].sql);

  const count = fakeDb({ firstRow: { n: 0 } });
  await dbFunctions.countPublishedPosts(count.db);
  assertPublicVisibility(count.calls[0].sql);

  const sitemap = fakeDb();
  await dbFunctions.listPostsForSitemap(sitemap.db, 1000, 0);
  assertPublicVisibility(sitemap.calls[0].sql);

  const single = fakeDb();
  await dbFunctions.getPublicPostBySlug(single.db, 'legada');
  assertPublicVisibility(single.calls[0].sql);

  const cards = fakeDb();
  await dbFunctions.getPublicPostsBySlugList(cards.db, ['legada']);
  assertPublicVisibility(cards.calls[0].sql);

  const admin = fakeDb();
  await dbFunctions.listPosts(admin.db, { includeDrafts: true, limit: 500 });
  assert.doesNotMatch(admin.calls[0].sql, /archived_categories/i);
});

test('ranking público filtra arquivadas antes do LIMIT e mantém ranking administrativo intacto', async () => {
  assert.equal(typeof dbFunctions.topPublicPostsByViews, 'function');
  const migration = await readFile(migrationUrl, 'utf8');
  const sqlite = createPostsDatabase();
  insertPost(sqlite, 'legada', 'Coração Acelerado');
  insertPost(sqlite, 'ativa', 'A Nobreza do Amor');
  sqlite.exec(migration);
  const bucket = new Date().toISOString().slice(0, 13);
  sqlite.prepare('INSERT INTO pageviews_hourly (bucket, path, count) VALUES (?, ?, ?)').run(bucket, '/legada', 1000);
  sqlite.prepare('INSERT INTO pageviews_hourly (bucket, path, count) VALUES (?, ?, ?)').run(bucket, '/ativa', 100);
  const db = asD1(sqlite);

  const publicTop = await dbFunctions.topPublicPostsByViews(db, 24, 1);
  assert.deepEqual(publicTop.map(({ path, views }) => ({ path, views })), [{ path: '/ativa', views: 100 }]);
  const adminTop = await dbFunctions.topPostsByViews(db, 24, 1);
  assert.deepEqual(adminTop.map(({ path, views }) => ({ path, views })), [{ path: '/legada', views: 1000 }]);
  sqlite.close();
});

test('rotas públicas usam getters e rankings públicos, enquanto admin mantém ranking completo', async () => {
  const source = await readFile(indexUrl, 'utf8');

  const topApi = section(source, '// ===== GET /api/posts/top', '// ===== GET /api/posts/:slug');
  assert.match(topApi, /topPublicPostsByViews\(env\.DB/);
  assert.match(topApi, /getPublicPostsBySlugList\(env\.DB,\s*slugs\)/);
  assert.doesNotMatch(topApi, /\btopPostsByViews\(env\.DB/);

  const singleApi = section(source, '// ===== GET /api/posts/:slug', '// ===== GET /api/posts (lista)');
  assert.match(singleApi, /getPublicPostBySlug\(env\.DB,\s*slug\)/);
  assert.doesNotMatch(singleApi, /\bgetPostBySlug\(env\.DB/);

  const publicPage = section(source, '// ===== Public: post at bare /<slug>', '// ===== Default 404');
  assert.match(publicPage, /getPublicPostBySlug\(env\.DB,\s*slug\)/);
  assert.equal((publicPage.match(/topPublicPostsByViews\(env\.DB/g) ?? []).length, 2);
  assert.equal((publicPage.match(/getPublicPostsBySlugList\(env\.DB/g) ?? []).length, 2);
  assert.doesNotMatch(publicPage, /\btopPostsByViews\(env\.DB/);

  const dashboard = section(source, '// ===== Admin: login', '// ===== Admin: Posts list');
  assert.match(dashboard, /topPostsByViews\(env\.DB/);
});

test('POST da API preserva idempotência e recusa categoria arquivada antes do INSERT', async () => {
  const [source, archive] = await Promise.all([
    readFile(indexUrl, 'utf8'),
    import('./archive.ts'),
  ]);
  const createApi = section(source, '// ===== POST /api/posts (criar)', '// ===== Endpoint não encontrado dentro de /api/*');
  const duplicateAt = createApi.indexOf('const existing = await getPostBySlug');
  const archivedAt = createApi.indexOf('await isCategoryArchived(env.DB, category)');
  const createAt = createApi.indexOf('await createPost(env.DB');

  assert.ok(duplicateAt >= 0, 'a checagem idempotente de slug deve continuar existindo');
  assert.ok(archivedAt > duplicateAt, 'um retry de slug existente deve continuar idempotente');
  assert.ok(createAt > archivedAt, 'categoria arquivada deve receber 409 antes do INSERT');
  assert.match(createApi, /status:\s*409/);

  assert.equal(archive.isArchivedCategoryError(new Error('D1_ERROR: category is archived: SQLITE_CONSTRAINT')), true);
  assert.equal(archive.isArchivedCategoryError(new Error('UNIQUE constraint failed: posts.slug')), false);
  const insertCatch = section(createApi, 'try {\n            id = await createPost', '          return new Response(JSON.stringify({\n            id, slug');
  assert.match(insertCatch, /isArchivedCategoryError\(e\)/);
  assert.match(insertCatch, /status:\s*409/);
});

test('admin/new devolve 400 explícito e importação registra arquivados como skipped antes do batch', async () => {
  const source = await readFile(indexUrl, 'utf8');
  const adminNew = section(source, '// ===== Admin: new post (POST)', '// ===== Admin: edit post (GET form)');
  const archivedAt = adminNew.indexOf('await isCategoryArchived(env.DB, input.category)');
  const createAt = adminNew.indexOf('await createPost(env.DB, input)');
  assert.ok(archivedAt >= 0 && archivedAt < createAt);
  assert.match(adminNew, /categoria[^\n]*arquivada/i);
  assert.match(adminNew, /status:\s*400/);
  assert.match(adminNew, /isArchivedCategoryError\(e\)/);

  const importer = source.slice(source.indexOf('async function importPostsBatch('));
  const lookupAt = importer.indexOf('listArchivedCategoryKeys(env.DB)');
  const skipAt = importer.indexOf("reason: `categoria arquivada:");
  const batchAt = importer.indexOf('await createPostsBatch(');
  assert.ok(lookupAt >= 0 && skipAt > lookupAt && batchAt > skipAt);
  assert.match(importer, /normalizeCategoryKey\(p\.category\)/);
});

test('home, RSS e API de lista herdam a listagem pública', async () => {
  const source = await readFile(indexUrl, 'utf8');
  assert.match(section(source, '// ===== Public: home', '// ===== Public: privacy'), /listPosts\(env\.DB,\s*\{\s*includeDrafts:\s*false/);
  assert.match(section(source, '// ===== RSS feed', '// ===== Admin: login'), /listPosts\(env\.DB,\s*\{\s*includeDrafts:\s*false/);
  assert.match(section(source, '// ===== GET /api/posts (lista)', '// ===== POST /api/posts (criar)'), /listPosts\(env\.DB,\s*\{\s*includeDrafts:\s*false/);
});

test('publicação controlada exige confirmação e mantém migration, deploy e bump nessa ordem', async () => {
  const [publisher, packageJson] = await Promise.all([
    import(publishScriptUrl.href),
    readFile(packageUrl, 'utf8').then(JSON.parse),
  ]);
  assert.equal(packageJson.scripts.deploy, 'wrangler deploy');
  assert.equal(packageJson.scripts['publish:archive'], 'node scripts/publish-archive.mjs');
  assert.deepEqual(publisher.PUBLISH_ARCHIVE_STEPS.map((step) => step.id), [
    'preflight-clean',
    'preflight-base',
    'preflight-count',
    'preflight-scope',
    'migration',
    'deploy',
    'cache-bump',
  ]);

  assert.equal(publisher.PUBLISH_ARCHIVE_STEPS[0].command, 'git');
  assert.deepEqual(publisher.PUBLISH_ARCHIVE_STEPS[0].args, [
    'status', '--porcelain=v1', '--untracked-files=all',
  ]);
  assert.deepEqual(publisher.PUBLISH_ARCHIVE_STEPS[1].args, [
    'merge-base', '--is-ancestor', 'origin/main', 'HEAD',
  ]);
  assert.deepEqual(publisher.PUBLISH_ARCHIVE_STEPS[2].args, [
    'rev-list', '--count', 'origin/main..HEAD',
  ]);
  assert.deepEqual(publisher.PUBLISH_ARCHIVE_STEPS[3].args, [
    'diff', '--name-only', 'origin/main...HEAD',
  ]);
  assert.deepEqual([...publisher.ARCHIVE_PUBLISH_ALLOWLIST], [
    'migrations/0006_archive_categories.sql',
    'package.json',
    'schema.sql',
    'scripts/publish-archive.mjs',
    'src/archive.test.mjs',
    'src/archive.ts',
    'src/db.ts',
    'src/index.ts',
    'src/render.ts',
    'tsconfig.json',
  ]);

  const migration = publisher.PUBLISH_ARCHIVE_STEPS[4];
  assert.deepEqual(migration.args, [
    'wrangler', 'd1', 'execute', 'capitulo-de-hoje', '--remote',
    '--file=./migrations/0006_archive_categories.sql',
  ]);
  assert.deepEqual(publisher.PUBLISH_ARCHIVE_STEPS[5].args, ['wrangler', 'deploy']);
  const bumpArgs = publisher.PUBLISH_ARCHIVE_STEPS[6].args.join(' ');
  assert.match(bumpArgs, /--remote/);
  assert.match(bumpArgs, /cache\.version/);
  assert.match(bumpArgs, /cache\.last_purged_at/);

  const bumpSql = publisher.PUBLISH_ARCHIVE_STEPS[6].args.at(-1);
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  sqlite.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('cache.version', '7', 0)").run();
  sqlite.exec(bumpSql);
  assert.equal(sqlite.prepare("SELECT value FROM settings WHERE key = 'cache.version'").get().value, '8');
  assert.ok(Number(sqlite.prepare("SELECT value FROM settings WHERE key = 'cache.last_purged_at'").get().value) > 0);
  sqlite.close();

  const calls = [];
  const logLines = [];
  const code = publisher.runPublishArchive({
    argv: ['--confirm-production'],
    spawn(command, args) {
      calls.push({ command, args });
      if (args[0] === 'rev-list') return { status: 0, stdout: '1\n' };
      if (args[0] === 'diff') {
        return { status: 0, stdout: `${publisher.ARCHIVE_PUBLISH_ALLOWLIST.join('\n')}\n` };
      }
      return { status: 0, stdout: '' };
    },
    logger: {
      info: (line) => logLines.push(line),
      warn: (line) => logLines.push(line),
      error: (line) => logLines.push(line),
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map((call) => call.args), publisher.PUBLISH_ARCHIVE_STEPS.map((step) => step.args));
  assert.match(logLines.join('\n'), /produção|production/i);

  const unconfirmedCalls = [];
  assert.notEqual(publisher.runPublishArchive({
    argv: [],
    spawn: (...args) => { unconfirmedCalls.push(args); return { status: 0 }; },
    logger: { info() {}, warn() {}, error() {} },
  }), 0);
  assert.equal(unconfirmedCalls.length, 0);
});

test('publicação controlada aborta no primeiro erro e nunca faz bump antes de deploy aprovado', async () => {
  const publisher = await import(publishScriptUrl.href);
  const calls = [];
  const statuses = [0, 0, 0, 0, 0, 7, 0];
  const code = publisher.runPublishArchive({
    argv: ['--confirm-production'],
    spawn(command, args) {
      const status = statuses[calls.length];
      calls.push({ command, args });
      if (args[0] === 'rev-list') return { status, stdout: '1\n' };
      if (args[0] === 'diff') return { status, stdout: 'src/archive.ts\n' };
      return { status, stdout: '' };
    },
    logger: { info() {}, warn() {}, error() {} },
  });
  assert.equal(code, 7);
  assert.deepEqual(calls.map((call) => call.args), publisher.PUBLISH_ARCHIVE_STEPS.slice(0, 6).map((step) => step.args));
});

test('publicação controlada aborta no preflight sujo sem executar nenhum comando remoto', async () => {
  const publisher = await import(publishScriptUrl.href);
  for (const dirtyStatus of [' M src/index.ts\n', '?? arquivo-nao-rastreado.txt\n']) {
    const calls = [];
    const code = publisher.runPublishArchive({
      argv: ['--confirm-production'],
      spawn(command, args) {
        calls.push({ command, args });
        return { status: 0, stdout: dirtyStatus };
      },
      logger: { info() {}, warn() {}, error() {} },
    });
    assert.notEqual(code, 0);
    assert.deepEqual(calls, [{
      command: 'git',
      args: ['status', '--porcelain=v1', '--untracked-files=all'],
    }]);
  }
});

test('publicação controlada recusa base inválida, commits extras e caminhos fora da allowlist', async () => {
  const publisher = await import(publishScriptUrl.href);
  const scenarios = [
    {
      name: 'base não ancestral',
      responses: [
        { status: 0, stdout: '' },
        { status: 1, stdout: '' },
      ],
      expectedCalls: 2,
    },
    {
      name: 'dois commits de tarefa',
      responses: [
        { status: 0, stdout: '' },
        { status: 0, stdout: '' },
        { status: 0, stdout: '2\n' },
      ],
      expectedCalls: 3,
    },
    {
      name: 'arquivo fora do escopo',
      responses: [
        { status: 0, stdout: '' },
        { status: 0, stdout: '' },
        { status: 0, stdout: '1\n' },
        { status: 0, stdout: 'src/archive.ts\nsrc/nao-autorizado.ts\n' },
      ],
      expectedCalls: 4,
    },
  ];

  for (const scenario of scenarios) {
    const calls = [];
    const code = publisher.runPublishArchive({
      argv: ['--confirm-production'],
      spawn(command, args) {
        const response = scenario.responses[calls.length];
        calls.push({ command, args });
        return response;
      },
      logger: { info() {}, warn() {}, error() {} },
    });
    assert.notEqual(code, 0, scenario.name);
    assert.equal(calls.length, scenario.expectedCalls, scenario.name);
    assert.equal(calls.some((call) => call.command === 'npx'), false, scenario.name);
  }
});

test('rodapé público não oferece link para Coração Acelerado', async () => {
  const source = await readFile(renderUrl, 'utf8');
  const footer = section(source, '<footer class="site-footer">', '</footer>');
  assert.doesNotMatch(footer, /Coração Acelerado/);
  assert.doesNotMatch(footer, /Cora%C3%A7%C3%A3o%20Acelerado/);
});
