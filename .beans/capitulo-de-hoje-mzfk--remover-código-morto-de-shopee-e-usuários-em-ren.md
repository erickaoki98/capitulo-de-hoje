---
# capitulo-de-hoje-mzfk
title: Remover código morto de Shopee e Usuários em render.ts para o tsc do projeto passar
status: todo
type: task
priority: normal
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:55:41Z
parent: capitulo-de-hoje-h0xf
---

`src/render.ts` carrega telas e tipos de funcionalidades que não existem mais no Worker. Isso quebra a checagem de tipos do projeto inteiro.

## Evidência
- `src/render.ts:5-7`: importa `ShopeeProduct`, `AdminUser`, `ShopeeClickDay`, `ShopeeProductDayClicks` de `./db` (não exportados), `ShopeeApiProduct` de `./shopee` (arquivo não existe) e `UserRole` de `./auth` (não exportado).
- `src/render.ts:3605-4031`: `renderShopeeAnalytics`, `renderAdminShopee`, `renderShopeeInlineCard`, sem rota em `src/index.ts`.
- `src/render.ts:897` (`adminUserToAuthorProfile`) e `src/render.ts:4285` em diante (`renderAdminUsers`): sem uso.
- `src/render.ts:1084` e `737-886`: `renderPost`/`planAndInjectBlocks` ainda têm o ramo de injeção Shopee; `src/index.ts:1442` sempre passa `null`.
- `docs/d1-cost-protection.md:27`: "A verificação global do projeto possui erros anteriores em tipos/imports de `render.ts`". Por isso `tsconfig.cost-guard.json` só cobre 15 módulos.

## O que fazer
- [ ] Remover as funções, tipos, ícones (`shopee`, `users` em `AdminSection`/`ICONS`) e parâmetros Shopee/Usuários sem uso
- [ ] `npx tsc -p tsconfig.json` sem erros
- [ ] Avaliar trocar `check:deploy` para checar o `tsconfig.json` completo, mantendo os testes obrigatórios
- [ ] `npm run check:deploy` e `wrangler deploy --dry-run` passando
