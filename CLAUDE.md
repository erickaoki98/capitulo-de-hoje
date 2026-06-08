# Projeto: Capítulo de Hoje

Blog em Cloudflare Workers + D1 + R2. Server-rendered HTML via TypeScript template literals.

## Regras obrigatórias

- **Sempre usar Superpowers skills** em qualquer tarefa — invocar o skill relevante ANTES de agir.
- **Sempre usar o skill `ui-ux-pro-max`** para qualquer trabalho de design, UX, UI, CSS ou estilização.
- Comunicar em português brasileiro.
- **Anúncios (AdSense) — NUNCA alterar o consent para `denied`.** Este é um site brasileiro: a LGPD não exige opt-in prévio de cookies como a UE/GDPR. O Consent Mode em `src/adsense.ts` deve permanecer SEMPRE `granted` por padrão. Usar `denied` derruba o RPM (anúncios não-personalizados). Só faria sentido um CMP/consent restritivo se houvesse tráfego relevante da União Europeia.
- **Google Analytics — proteger a injeção do gaId.** O Measurement ID fica em `settings.google_analytics_id` e é carregado por `loadGaId(env)` (`src/index.ts`). INVARIANTE: toda página pública (home, post e qualquer rota pública nova) DEVE carregar o `gaId` e repassá-lo ao render (`renderHome`/`renderPost` → `layout`). Esquecer = GA para de medir SEM erro. Já quebrou uma vez (rotas não passavam o gaId). Ao criar página pública nova, inclua `loadGaId(env)` e passe o resultado. Teste: `curl -s https://capitulodehoje.com.br/ | grep googletagmanager` deve achar o script.

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

## Uso na nuvem (claude.ai/code) e verificação

Este projeto também é usado pelo Claude na web. Pontos de atenção:

- **Segredos:** este projeto usa o padrão Cloudflare `.dev.vars` (NÃO `.env`), que é
  ignorado pelo Git. Os nomes das variáveis estão em `.dev.vars.example`. Na nuvem, configure
  esses valores no ambiente antes de esperar que o admin/login funcione. Em produção, os
  segredos ficam em **Wrangler secrets** (`wrangler secret put NOME`), não no código.
- **Rodar:** `npm run dev` (= `wrangler dev`, porta 8787).
- **Verificar (sem o "Claude no Chrome"):** use as ferramentas de **Preview** do ambiente —
  `preview_start` (sobe o `wrangler dev`), `preview_snapshot` (conteúdo), `preview_console_logs`
  / `preview_network` (erros) e `preview_screenshot` (prova visual). Sempre verifique de fato e
  mostre a prova; não peça ao usuário para checar à mão.
- **D1 local:** ver `package.json` (`db:migrate:local`, `db:console:local`). A tabela `posts`
  local pode estar vazia; conteúdo real vem de `wrangler d1 export ... --remote`.
