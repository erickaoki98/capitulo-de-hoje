import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIRMATION_FLAG = '--confirm-production';
const SAFE_BASE = 'origin/main';

export const ARCHIVE_PUBLISH_ALLOWLIST = Object.freeze([
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

const CACHE_BUMP_SQL = `
INSERT INTO settings (key, value, updated_at)
VALUES ('cache.version', '2', unixepoch() * 1000)
ON CONFLICT(key) DO UPDATE SET
  value = CAST(CASE
    WHEN CAST(settings.value AS INTEGER) >= 1 THEN CAST(settings.value AS INTEGER) + 1
    ELSE 1
  END AS TEXT),
  updated_at = excluded.updated_at;

INSERT INTO settings (key, value, updated_at)
VALUES ('cache.last_purged_at', CAST(unixepoch() * 1000 AS TEXT), unixepoch() * 1000)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;
`.trim();

export const PUBLISH_ARCHIVE_STEPS = Object.freeze([
  Object.freeze({
    id: 'preflight-clean',
    label: 'Confirmar checkout/worktree totalmente limpo',
    command: 'git',
    args: Object.freeze(['status', '--porcelain=v1', '--untracked-files=all']),
  }),
  Object.freeze({
    id: 'preflight-base',
    label: `Confirmar que ${SAFE_BASE} é ancestral de HEAD`,
    command: 'git',
    args: Object.freeze(['merge-base', '--is-ancestor', SAFE_BASE, 'HEAD']),
  }),
  Object.freeze({
    id: 'preflight-count',
    label: `Confirmar exatamente um commit à frente de ${SAFE_BASE}`,
    command: 'git',
    args: Object.freeze(['rev-list', '--count', `${SAFE_BASE}..HEAD`]),
  }),
  Object.freeze({
    id: 'preflight-scope',
    label: 'Confirmar que o commit contém somente arquivos desta tarefa',
    command: 'git',
    args: Object.freeze(['diff', '--name-only', `${SAFE_BASE}...HEAD`]),
  }),
  Object.freeze({
    id: 'migration',
    label: 'Aplicar migration 0006 no D1 remoto',
    command: 'npx',
    args: Object.freeze([
      'wrangler', 'd1', 'execute', 'capitulo-de-hoje', '--remote',
      '--file=./migrations/0006_archive_categories.sql',
    ]),
  }),
  Object.freeze({
    id: 'deploy',
    label: 'Publicar o Worker',
    command: 'npx',
    args: Object.freeze(['wrangler', 'deploy']),
  }),
  Object.freeze({
    id: 'cache-bump',
    label: 'Invalidar cache público após o deploy',
    command: 'npx',
    args: Object.freeze([
      'wrangler', 'd1', 'execute', 'capitulo-de-hoje', '--remote',
      '--command', CACHE_BUMP_SQL,
    ]),
  }),
]);

/**
 * Fluxo de produção deliberadamente síncrono: qualquer falha impede os passos
 * seguintes, sobretudo o bump de cache antes de o Worker novo estar ativo.
 */
export function runPublishArchive({
  argv = process.argv.slice(2),
  spawn = spawnSync,
  logger = console,
} = {}) {
  logger.warn('ATENÇÃO: este fluxo altera D1, Worker e cache de produção; execute somente após confirmação explícita do Erick.');
  if (!argv.includes(CONFIRMATION_FLAG)) {
    logger.error(`Confirmação ausente. Use ${CONFIRMATION_FLAG} somente após a aprovação de produção.`);
    return 2;
  }

  for (const step of PUBLISH_ARCHIVE_STEPS) {
    logger.info(`[${step.id}] ${step.label}`);
    const isPreflight = step.id.startsWith('preflight-');
    const result = spawn(step.command, [...step.args], {
      cwd: repositoryRoot,
      ...(isPreflight
        ? { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        : { stdio: 'inherit' }),
    });
    if (result.error) {
      logger.error(`[${step.id}] ${result.error.message}`);
      return 1;
    }
    if (result.status !== 0) {
      const status = result.status ?? 1;
      logger.error(`[${step.id}] falhou com status ${status}; sequência abortada.`);
      return status;
    }
    const output = String(result.stdout ?? '').trim();
    if (step.id === 'preflight-clean' && output !== '') {
      logger.error('[preflight] checkout/worktree possui mudanças rastreadas ou não rastreadas; nenhuma ação remota foi executada.');
      return 3;
    }
    if (step.id === 'preflight-count' && output !== '1') {
      logger.error(`[preflight] esperado exatamente um commit de tarefa à frente de ${SAFE_BASE}; encontrado: ${output || 'nenhum'}.`);
      return 4;
    }
    if (step.id === 'preflight-scope') {
      const changedPaths = output ? output.split(/\r?\n/).filter(Boolean) : [];
      const outsideScope = changedPaths.filter((path) => !ARCHIVE_PUBLISH_ALLOWLIST.includes(path));
      if (changedPaths.length === 0 || outsideScope.length > 0) {
        logger.error(`[preflight] escopo de commit inválido: ${outsideScope.join(', ') || 'nenhum arquivo da tarefa'}.`);
        return 5;
      }
    }
  }

  logger.info('Arquivo publicado e cache invalidado após o deploy.');
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  process.exitCode = runPublishArchive();
}
