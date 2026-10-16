# Fotos automáticas com Luna e lançamento A/B

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Publicar no Capítulo de Hoje o A/B 50/50, usar o enquadramento automático revisado nas fotos dos últimos 30 artigos e nos novos, e disponibilizar acompanhamento no painel.

**Architecture:** O Worker já possui OPENAI_API_KEY. Uma fila privada em R2 reserva cada análise antes de chamar GPT-6 Luna, identifica assuntos, calcula quadrados, renderiza com Photon e envia os cortes à revisão visual. Mapas finais ficam em um objeto por artigo, lido somente em misses do cache público. Sorteio persistente no navegador antecede GA; controle estático e tratamento com cortes distintos e efeito C. Cron e execução administrativa compartilham reservas, teto diário, idempotência e processamento limitado. Não alterar credenciais, permissões Google, rankings ou dados editoriais.

**Tech Stack:** Cloudflare Workers, D1 existente, R2, Photon já instalado, JavaScript/TypeScript, Responses API e GA4 Data API.

## 1. Base e contratos
- [x] Reutilizar `/private/tmp/cdh-photo-ab-20261016`, integrar `origin/main` e executar `npm run check:deploy` (194 testes).
- [x] Confirmar somente o nome do secret OPENAI_API_KEY já existente no Worker.
- [x] Arquivos novos: `src/photoAI.ts` (fila/reservas/mapas), `src/photoAIModel.ts` (prompts/geometria/API), `src/photoAI.test.mjs`, `src/photoAIModel.test.mjs`; `public/photo-motion.js` (efeito C, sem novo módulo).
- [x] Expor `photoAIView(env)`, `startPhotoBackfill(env)`, `discoverPhotoPosts(env)`, `runPhotoAI(env)`, `loadAutomaticPhotoMaps(env,postId)` e rotas autenticadas `/api/photo-ai/{status,backfill,run}`. Estado de backfill persistido antes de qualquer gasto; duplicatas retornam estado existente.

## 2. Identificação e custo
- [x] Testar primeiro geometria dentro da foto, contenção do assunto, sequência cíclica sem sobreposição maior que 25%, recusas e validação da revisão.
- [x] Reutilizar prompts aprovados do estudo v2, modelo exato `gpt-6-luna`, `reasoning.effort=none`, até três assuntos e uma revisão dos recortes renderizados. No máximo duas chamadas por fonte; falha/estado incerto não repete automaticamente.
- [x] Reservar no R2 antes do gasto. Guardar uso/custo/status por imagem, cache persistente por fonte, orçamento diário e execução de um trabalho por chamada e no máximo quatro simultâneos. Sem botões de gasto não persistentes.
- [x] A fila inicial captura os 30 artigos públicos mais recentes uma só vez; processa todas as fotos editoriais locais do corpo. Cron descobre novas fontes e artigos; fotos sem dois cortes aprovados conservam original.

## 3. Artigo e transição
- [x] Testar primeiro pausa, visibilidade, movimento reduzido, tratamento sem efeito nos estáticos e restauração da original.
- [x] Modificar `src/photoMaps.ts`, `src/index.ts`, `src/types.ts`, `public/photo-motion.js`, `src/photoExperiment.ts` para mapas por artigo e efeito C de 230 ms. Retirar editor manual do fluxo do painel. Não limitar a oito fotos nem ao mapa global de 100 fontes.
- [x] Grupo 50/50 estável por navegador, independente de anúncios. Registre variante antes de GA. Não emitir engajamento por troca automática. Preservar hero, recomendações e tipografia pública.

## 4. Painel e métricas
- [x] Modificar `src/photoReports.ts`, `src/photoRoutes.ts`, `src/photoPanel.ts` e respectivos testes: aba autenticada, atualizar métricas, distribuição por variante, receita indisponível explicitamente nula, período de engajamento independente da preparação monetária.
- [x] `PhotoPanelData.ai` usa resumo do R2: enabled, totalArticles, totalImages, queued, processing, ready, static, failed, estimatedCostUsd, lastUpdated, error opcional. Sem consultas públicas de histórico. Root integra esse dado após o trabalho do painel.
- [x] Mostrar indicadores de permanência/engajamento sem confundi-los com retorno de visitantes; não declarar vencedor sem amostra e análise apropriadas. OAuth novo exige ação consciente do usuário; não conceder acessos automaticamente.

## 5. Revisar, publicar e executar
- [x] Revisão de escopo e qualidade por agentes, correções e `npm run check:deploy`, `wrangler deploy --dry-run`.
- [x] Atualizar main e conferir ancestralidade/diff. Publicar somente arquivos da branch `codex/photo-ab-retention-revenue` no Worker `capitulo-de-hoje`, domínio `capitulodehoje.com.br`, conforme pedido atual de implementar e iniciar o teste.
- [ ] Iniciar fila idempotente e processar os últimos 30 artigos; verificar contagens, erros e custo reais. Ativar 50/50 e confirmar bootstrap/mapas/JS na produção, painel e movimento reduzido. Não inventar métricas ainda não coletadas.
