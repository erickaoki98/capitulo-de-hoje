# Projeto: Capítulo de Hoje

Blog em Cloudflare Workers + D1 + R2. Server-rendered HTML via TypeScript template literals.

## Regras obrigatórias

- **Sempre usar Superpowers skills** em qualquer tarefa — invocar o skill relevante ANTES de agir.
- **Sempre usar o skill `ui-ux-pro-max`** para qualquer trabalho de design, UX, UI, CSS ou estilização.
- Comunicar em português brasileiro.

## Stack

- Runtime: Cloudflare Workers
- Database: D1 (SQLite)
- Storage: R2 (imagens)
- CSS: Design system com tokens `--adm-*` (admin) e variáveis públicas
- Deploy: `wrangler deploy`
- Dev local: `npx wrangler dev` (porta 8787)

## Arquivos principais

- `src/index.ts` — Worker entry point, rotas
- `src/render.ts` — Todas as funções de renderização HTML
- `src/types.ts` — Interfaces TypeScript
- `public/styles.css` — CSS completo (público + admin)
