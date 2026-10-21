# Encerramento do teste de fotos — 21/10/2026

O usuário decidiu encerrar o experimento porque o desempenho não justificou sua continuidade. Fotos estáticas voltam a ser o comportamento único. Essa é uma decisão de produto informada pelo usuário; não implica significância estatística ou medição de receita confirmada.

Removidos do código: sorteio e dimensão do A/B de fotos, recortes/alternância no artigo e nos cards, modelos locais de detecção, análise e revisão por IA, fila/backfill/lote agendado, relatórios e OAuth exclusivos do experimento, APIs operacionais, aba `/admin/teste-fotos`, editor e laboratório sem uso. Analytics geral, teste independente de anúncios, painel AdSense e migração de imagens continuam funcionando.

Os cards preservam a imagem original, a alternativa do conteúdo em caso de falha e a apresentação em texto se nenhuma imagem carregar. A versão de formato da chave do cache público muda para impedir que o Worker reutilize HTML do experimento. URLs de rastreamento continuam normalizadas, sem agregações de pageviews por visitante.

Não há migration, exclusão de objetos R2, alteração de conteúdo editorial, credenciais ou permissões Google. O estado histórico armazenado fica inerte: não é consultado nem retomado pelo Worker novo. O histórico de implementação permanece no Git. Páginas já abertas precisam ser recarregadas para receber o código novo; caches de navegador existentes podem cumprir seu TTL.

Implementação na branch `codex/remover-experimento-fotos`, baseada em `origin/main` (`568d351`), com as proteções de custo e sobrecarga D1 preservadas. Publicação no Worker `capitulo-de-hoje` / `capitulodehoje.com.br` autorizada pelo usuário em 21/10/2026, com a condição de preservar a `main` atualizada. Integração por PR e publicação pelo workflow de `main`, após reconferir a base e as validações. Este registro precede a confirmação do deploy.

## Verificação local

- `npm run check:deploy`: 125 testes aprovados e TypeScript dos módulos protegidos aprovado.
- `npx wrangler deploy --dry-run`: build obrigatório aprovado e bundle completo gerado; nenhuma publicação realizada.
- `git diff --check` aprovado; `origin/main` atualizado e confirmado como ancestral da branch.
- Prévia local no navegador em 320, 390, 768 e 1440 px: sem overflow horizontal, uma imagem original por card e nenhum script de recorte/detecção. Corpo e título do card mantêm 22,3125 px no celular e 24,9375 px nas larguras maiores na configuração `t-body-lg`.
- Menu administrativo sem a aba de fotos, preservando relatório AdSense e teste independente de anúncios.
- Testes executam o Worker real para verificar ausência de rotas operacionais, leituras do experimento e processamento agendado. Também verificam o fallback de imagem, a rejeição de grants OAuth antigos e a separação do cache sem quebrar a invalidação concorrente.

## Escopo exclusivo para commit, envio e publicação

Branch: `codex/remover-experimento-fotos`. Alvo de produção: Worker `capitulo-de-hoje`, domínio `capitulodehoje.com.br`, bindings D1/R2 existentes. Sem migrations ou alterações de credenciais. O checkout principal e as alterações de outras tarefas ficam preservados.

A autorização de produção abrange somente estes 63 arquivos (incluindo remoções):

- `.beans/capitulo-de-hoje-3rjo--remover-protótipos-de-foto-sem-uso-photo-auto-foc.md`
- `.beans/capitulo-de-hoje-9rre--definir-critério-e-decidir-o-resultado-do-ab-de-f.md`
- `.beans/capitulo-de-hoje-gp3x--vincular-google-analytics-ao-adsense-para-medir-re.md`
- `docs/photo-ab-test.md`
- `docs/photo-focus-five-images.md`
- `docs/project-notes/plans/2026-10-16-photo-ai-ab-launch.md`
- `docs/project-notes/plans/2026-10-16-related-section-cards.md`
- `docs/project-notes/plans/2026-10-17-photo-traffic-batch.md`
- `public/photo-auto-focus.js`
- `public/photo-map-editor.js`
- `public/photo-motion-policy.js`
- `public/photo-motion.js`
- `public/related-face-policy.js`
- `public/related-faces.js`
- `public/styles.css`
- `public/vendor/related-faces-v1/LICENSE`
- `public/vendor/related-faces-v1/README.md`
- `public/vendor/related-faces-v1/face-api.min.js`
- `public/vendor/related-faces-v1/face_landmark_68_tiny_model-shard1`
- `public/vendor/related-faces-v1/face_landmark_68_tiny_model-weights_manifest.json`
- `public/vendor/related-faces-v1/tiny_face_detector_model-shard1`
- `public/vendor/related-faces-v1/tiny_face_detector_model-weights_manifest.json`
- `scripts/photo-focus-lab.html`
- `scripts/photo-focus-lab.mjs`
- `scripts/photo-focus-samples.json`
- `src/adsenseRoutes.test.mjs`
- `src/adsenseRoutes.ts`
- `src/adsenseWorker.test.mjs`
- `src/cache.test.mjs`
- `src/d1Overload.test.mjs`
- `src/fixtures/related-face-review.json`
- `src/index.ts`
- `src/photoAI.test.mjs`
- `src/photoAI.ts`
- `src/photoAIImages.ts`
- `src/photoAIModel.test.mjs`
- `src/photoAIModel.ts`
- `src/photoAIPrompts.ts`
- `src/photoAITraffic.test.mjs`
- `src/photoAITraffic.ts`
- `src/photoAutoFocus.test.mjs`
- `src/photoCache.test.mjs`
- `src/photoExperiment.test.mjs`
- `src/photoExperiment.ts`
- `src/photoMapEditor.test.mjs`
- `src/photoMaps.test.mjs`
- `src/photoMaps.ts`
- `src/photoMotion.test.mjs`
- `src/photoPanel.test.mjs`
- `src/photoPanel.ts`
- `src/photoReports.test.mjs`
- `src/photoReports.ts`
- `src/photoRoutes.test.mjs`
- `src/photoRoutes.ts`
- `src/publicCacheKey.test.mjs`
- `src/publicCacheKey.ts`
- `src/relatedFaces.test.mjs`
- `src/render.ts`
- `src/sectionRecommendations.test.mjs`
- `src/sectionRecommendations.ts`
- `src/types.ts`
- `src/workerSafety.test.mjs`
- `tsconfig.cost-guard.json`
