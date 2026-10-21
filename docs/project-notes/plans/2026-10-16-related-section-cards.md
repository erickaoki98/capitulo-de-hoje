# Cards relacionados por seção — histórico de implementação

> Em 21/10/2026, a decisão de voltar às fotos estáticas removeu os recortes, a detecção local e a alternância descritos abaixo. Seleção, posição, tipografia e fallback de imagens dos cards foram preservados. Veja [encerramento](../../photo-ab-test.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Substituir o Em Alta interno por um Leia também ao final de cada seção H2, com matérias diferentes do ranking de 24 horas e rostos legíveis.

**Architecture:** O Worker continua lendo apenas o snapshot protegido de rankings; amplia a seleção para 12 candidatos, mantém ordem e exclui atual, duplicatas e notícias com mais de 72 horas. A inserção respeita elementos HTML de nível superior e não coloca recomendações em citações ou figuras. O recorte de rostos é um aprimoramento local no navegador, sem APIs pagas, processamento no D1 ou chamadas por visitante ao backend. Um rosto aprovado fica fixo; dois ou mais alternam sem indicadores e com pausa acessível. Rostos de costas/perfil ou com baixa confiança são rejeitados.

**Tech Stack:** Cloudflare Workers, TypeScript, HTML/CSS, JavaScript local e testes node:test/esbuild; modelos pequenos de detecção e landmarks hospedados como assets estáticos.

## Task 1 — seleção e posição

- [x] Testes primeiro em `src/sectionRecommendations.test.mjs`: um card após cada H2 com conteúdo, incluindo última seção; sem card no primeiro subtítulo nem dentro de blockquote/figure; sem repetir artigos; escapamento e URLs seguras; pool finito não repete para preencher.
- [x] Implementar `src/sectionRecommendations.ts` com seleção simples e injeção em uma passagem; não alterar produtor/cron do ranking.
- [x] Integrar `src/render.ts`, `src/index.ts`, `src/rankingSnapshot.ts` e `public/styles.css`: ranking 24 horas até 12, estilo lateral aprovado, imagem na altura do texto, sem Teoria ou indicadores; excluir cards usados do rodapé.
- [x] Executar `node --test src/sectionRecommendations.test.mjs src/rankingSnapshot.test.mjs`.

## Task 2 — rostos

- [x] Testes primeiro para aceitação de faces e crop em módulo JS puro; rejeitar baixo score, perfis, faces pequenas ou cortadas. O processamento é limitado e sequencial, só perto da viewport e reutiliza resultados por imagem.
- [x] Implementar `public/related-faces.js`, módulo puro e assets locais versionados de detecção/landmarks com licença. Usar somente detecção e landmarks, sem reconhecimento de identidade, estimativa demográfica ou emoção.
- [x] Não mostrar recorte aleatório se não houver rosto aprovado; a recomendação em texto continua disponível. Um rosto fica estático, dois ou mais alternam no mesmo nível de zoom. Pausar em aba oculta, fora da viewport e com movimento reduzido. Sem pontos/contador/controles visuais permanentes.
- [x] Testar no navegador com a foto real da prévia; conferir que o único rosto frontal aparece e os rostos de costas não entram.

## Task 3 — integração e entrega

- [x] Teste integrado de renderização real com esbuild e persistência das proteções de custo; revisão de especificação e qualidade.
- [x] Executar `npm run check:deploy` e `npx wrangler deploy --dry-run`; verificar página real renderizada em 375, 390, 768 e 1440 px.
- [x] Atualizar/verificar `origin/main`, commitar somente arquivos desta tarefa, enviar branch e publicar Worker `capitulo-de-hoje` em `capitulodehoje.com.br`, conforme pré-autorização global do usuário; sem migrations de produção, mudanças de credenciais ou remoção de guardas. Mostrar escopo antes da publicação e conferir resposta pública após deploy.

Baseline: branch `codex/relacionados-artigo` de `origin/main` (`7af39db`), 95 testes e `check:deploy` aprovados em 16/10/2026. Checkout principal e worktrees de outras tarefas preservados.

Validação de implementação: 115 testes aprovados, check:deploy e wrangler deploy --dry-run concluídos. QA Chrome no render real: 8 seções/8 cards distintos; 375/390/768/1440 px sem overflow; foto alinhada ao texto; somente rosto frontal aprovado; hero quebrada recuperada pela imagem alternativa. Revisão final sem problemas materiais. O runtime usa assets locais (~382 KB gzip) carregados perto da viewport, limitado a 12 cards e duas fontes por card, sem API paga nem agregações no backend. Seleção conservadora: 12 candidatos de 24h são carregados; filtro de validade pode deixar menos de 12 cards e não abre consultas adicionais para preencher.
