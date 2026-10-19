---
# capitulo-de-hoje-u2ew
title: Remover DDL sob demanda de ad_mix_events no endpoint público /api/ev
status: todo
type: bug
priority: normal
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:56:00Z
---

Ainda existe DDL sob demanda num endpoint público, contra a regra do `AGENTS.md`.

## Evidência
- `AGENTS.md` (seção "D1: custo e sobrecarga"): "Não executar DDL por visita/heartbeat. Tabelas e índices devem existir por migrations, verificadas antes do deploy."
- `src/db.ts:739-775`: `recordAdMixEvents` executa `CREATE TABLE IF NOT EXISTS ad_mix_events` quando recebe "no such table". O comentário diz "a tabela é criada sob demanda na 1ª escrita (deploy não roda migrations)".
- Esse caminho é chamado pelo endpoint público `POST /api/ev` (`src/index.ts:1145-1158`), uma vez por página vista com o teste de banners ativo.
- `migrations/0007-ad-mix-events.sql` já cria a tabela, mas o próprio arquivo avisa que o Worker também a cria.
- `src/db.ts:796` (`ensureActiveVisitorsTable`) é o DDL antigo do heartbeat. Não é mais usado, mas continua exportado.
- O teste `src/workerSafety.test.mjs:74-89` cobre o heartbeat, mas não `/api/ev`.

## O que fazer
- [ ] Confirmar em produção que `ad_mix_events` existe (consulta somente leitura)
- [ ] Remover o fallback de `CREATE TABLE` em `recordAdMixEvents` e apagar `ensureActiveVisitorsTable`
- [ ] Estender o teste de "nenhum DDL por visita" para `/api/ev`

Relacionado: capitulo-de-hoje-0j9d (schema.sql e migrations).
