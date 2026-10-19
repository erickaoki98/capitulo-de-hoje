---
# capitulo-de-hoje-0j9d
title: 'schema.sql desatualizado: D1 local fica sem tabelas e índices exigidos'
status: todo
type: bug
priority: normal
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:55:41Z
---

`schema.sql` não representa mais o banco real. O comando indicado no `CLAUDE.md` para o D1 local cria um banco incompleto.

## Evidência
- `CLAUDE.md` (seção "Uso na nuvem"): manda usar `db:migrate:local`, que em `package.json` executa só `schema.sql`.
- `schema.sql` não tem as tabelas `settings`, `pageviews_hourly`, `api_keys`, `ab_events` e `active_visitors`, nem a coluna `posts.images_migrated_at`, nem os índices `idx_ph_bucket_path_count`, `idx_active_visitors_last_seen` e `idx_posts_ranking_metadata`. Tudo isso só existe em `migrations/0002`, `0003`, `0005`, `0007_d1_cost_guard.sql` e `0008_d1_overload.sql`.
- `AGENTS.md` (seção "D1: custo e sobrecarga"): o produtor do ranking exige `idx_posts_ranking_metadata` e falha fechado sem ele. Num banco local criado por `schema.sql`, o ranking fica bloqueado.
- Os testes compensam executando migrations manualmente (`src/d1Overload.test.mjs:8`).
- Duas migrations com o mesmo número: `migrations/0007-ad-mix-events.sql` e `migrations/0007_d1_cost_guard.sql`, com separadores diferentes (`-` e `_`). Não há registro de quais foram aplicadas em produção.

## O que fazer
- [ ] Atualizar `schema.sql` para o estado atual (ou fazer `db:migrate:local` aplicar `schema.sql` + migrations em ordem)
- [ ] Padronizar a numeração das migrations sem reaplicar nada em produção
- [ ] Teste que compare o banco gerado por `schema.sql` com o gerado pelas migrations
