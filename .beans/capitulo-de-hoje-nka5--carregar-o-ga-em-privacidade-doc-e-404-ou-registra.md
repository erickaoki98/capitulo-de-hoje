---
# capitulo-de-hoje-nka5
title: Carregar o GA em /privacidade, /doc e 404 ou registrar a exceção
status: todo
type: task
priority: low
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:55:41Z
---

O Google Analytics não é carregado em `/privacidade`, `/doc` e nas páginas 404, embora a regra do projeto diga que toda página pública precisa do `gaId`.

## Evidência
- `CLAUDE.md` (seção "Google Analytics — proteger a injeção do gaId"): "toda página pública (home, post e qualquer rota pública nova) DEVE carregar o `gaId` e repassá-lo ao render".
- `src/render.ts:1435`, `1529` e `1740`: `renderPrivacy`, `renderDocs` e `render404` não recebem `gaId`, então `layout()` nunca injeta o script.
- `src/index.ts:263-279` e `1456`: as rotas dessas páginas não chamam `loadGaId(env)`.
- Home e post seguem a regra (`src/index.ts:253` e `1400`).

## O que fazer
- [ ] Decidir se essas páginas devem ser medidas (404 ajuda a achar links quebrados; privacidade pode ficar de fora de propósito)
- [ ] Se sim, carregar `loadGaId(env)` e repassar ao render, como na home
- [ ] Se não, registrar a exceção no `CLAUDE.md` para a regra não ficar ambígua
