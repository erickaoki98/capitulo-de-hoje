---
# capitulo-de-hoje-uks2
title: Trocar README do Astro e corrigir .vscode e .dev.vars.example
status: todo
type: task
priority: normal
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:55:41Z
parent: capitulo-de-hoje-h0xf
---

Os arquivos de entrada do repositório descrevem outro projeto ou estão incompletos.

## Evidência
- `README.md`: é o texto do "Astro Starter Kit: Blog" (comandos `npm run build`, `localhost:4321`, pastas `src/pages/`), nada disso existe aqui. O projeto é Cloudflare Workers + D1 + R2 (`CLAUDE.md`).
- `.vscode/extensions.json`: recomenda extensões Astro/MDX.
- `.vscode/launch.json`: roda `./node_modules/.bin/astro dev`, que não existe. O correto está em `.claude/launch.json` (`wrangler dev`, porta 8787).
- `.dev.vars.example`: lista só `ADMIN_USERNAME`, `ADMIN_PASSWORD` e `SESSION_SECRET`, mas `src/types.ts:11-13` também usa `OPENAI_API_KEY`, `ADSENSE_CLIENT_ID` e `ADSENSE_CLIENT_SECRET`. `CLAUDE.md` afirma que "os nomes das variáveis estão em `.dev.vars.example`".

## O que fazer
- [ ] Trocar o README por um resumo curto do projeto real (stack, `npm run dev`, `npm run check:deploy`, links para `CLAUDE.md`, `AGENTS.md` e `docs/`)
- [ ] Corrigir ou remover `.vscode/extensions.json` e `.vscode/launch.json`
- [ ] Acrescentar os nomes faltantes ao `.dev.vars.example` (somente nomes, nunca valores)
