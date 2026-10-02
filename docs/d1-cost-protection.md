# Proteção contra repetição do custo de rankings no D1

Implementada em 12/09/2026 na branch `codex/protecao-custo-d1`, em worktree isolado baseado em `origin/main` (`0a6321b010466338bd7443d6287566b9535099ab`). A pasta principal permanece com as mudanças anteriores do usuário e ganhou uma trava local que recusa publicação do checkout antigo.

## Comportamento

- Artigos públicos leem rankings pré-calculados no R2. Nenhum cache miss, parâmetro de URL, cache purge ou indisponibilidade do R2 dispara agregações de pageviews por visitante.
- O cron existente tenta atualizar o snapshot. Uma reserva condicional no R2 permite no máximo uma tentativa a cada 30 minutos, inclusive entre instâncias e após falhas.
- Cada tentativa consulta, no máximo, 100.001 registros de acessos, 20.001 artigos e 101 categorias arquivadas (o registro adicional detecta estouro). O limite é aplicado antes de filtrar/agregar. A consulta de acessos exige o índice de cobertura existente; ausência do índice bloqueia o ranking em vez de varrer todo o histórico.
- Excesso ou erro preserva o último snapshot por até 48 horas. Depois disso, ou sem snapshot inicial, a página continua usando o fallback existente de artigos recentes. Não há retry rápido após erro.
- Categorias arquivadas e rascunhos são excluídos do snapshot. A renderização continua revalidando os posts públicos.
- URLs de rastreamento continuam compartilhando cache; contagem de pageviews é preservada.

A entrada do produtor é limitada a menos de 180 milhões de registros em 31 dias, independente do número de visitantes. Isso é um limite do produtor de rankings, **não um teto financeiro de toda a conta**: consultas administrativas/autenticadas, leituras de posts, gravações, R2 e Workers têm custos próprios. Não foram alterados contratos de APIs autenticadas como `/api/posts/top?hours=...`.

## Prevenção de regressão

`npm run check:deploy` executa todos os testes e verifica os tipos dos módulos da proteção. O custom build do Wrangler exige essa checagem mesmo no `npx wrangler deploy`. O GitHub Actions existente já usa esse comando, portanto a trava também é executada antes dos deploys de main. O workflow foi preservado porque a credencial GitHub atual não permite editar arquivos de workflow; não houve ampliação de permissões. O desenvolvimento usa Node 24+ por causa dos testes SQLite/TypeScript.

Os testes exercitam o `fetch` real do Worker com cache e R2 indisponíveis e detectam qualquer leitura do histórico de pageviews por visitante. Também verificam concorrência, falhas, orçamento de entrada, fallback, filtros e plano SQLite usando índice de cobertura. Uma mutação temporária reintroduzindo a consulta cara foi rejeitada pelo teste.

O guard é uma proteção dos caminhos de publicação deste repositório. Não impede um proprietário da conta de publicar deliberadamente outra versão/configuração pela API ou painel. Não contornar com `--no-build`, remoção do hook ou deploy de outro checkout.

## Validação realizada

- 36 testes aprovados.
- Verificação TypeScript dos módulos novos aprovada (`tsconfig.cost-guard.json`). A verificação global do projeto possui erros anteriores em tipos/imports de `render.ts`; eles não foram ocultados com stubs nem alterados nesta tarefa.
- Bundle completo do Worker gerado com sucesso por `wrangler deploy --dry-run`.
- Mutação que restabeleceu agregação por visitante falhou como esperado; código correto restaurado e novamente validado.
- Consulta limitada, somente leitura, ao D1 de produção: 39.755 registros nas últimas 48 horas e 13.088 artigos, abaixo dos limites de 100 mil e 20 mil.
- Índice `idx_ph_bucket_path_count` já confirmado em produção. A migration 0007 registra esse índice e o de visitantes para novos ambientes; não é necessário alterar o D1 atual para ativar o Worker.

## Publicação proposta — requer confirmação contextual

Alvo: Worker `capitulo-de-hoje`, domínio `capitulodehoje.com.br`, usando os bindings existentes `DB` e `IMAGES` (`capitulo-de-hoje-images`). O novo estado interno usa `_internal/d1-ranking-guard-v1.json` no R2.

Branch: `codex/protecao-custo-d1`. Escopo exclusivo de commit/publicação (13 arquivos; workflow existente preservado):

- `AGENTS.md`
- `package.json`
- `wrangler.jsonc`
- `tsconfig.cost-guard.json`
- `src/index.ts`
- `src/cache.ts`
- `src/rankingSnapshot.ts`
- `src/rankingSnapshot.test.mjs`
- `src/workerSafety.test.mjs`
- `src/archive.test.mjs`
- `src/publicRankingCache.test.mjs`
- `migrations/0007_d1_cost_guard.sql`
- `docs/d1-cost-protection.md`

Após confirmação: atualizar/verificar a base remota, repetir checagem se houver mudanças, commitar e enviar somente esta branch e publicar o Worker deste worktree. Sem merge automático de outras tarefas e sem executar migrations no D1 atual. Verificar o primeiro snapshot após o cron e a resposta de um artigo; o início pode usar artigos recentes até o primeiro snapshot.

## Verificação operacional

O JSON interno no R2 informa `status` (`ready`, `refreshing` ou `blocked`), `nextAttemptAt` e `snapshot.generatedAt`. Logs de falhas usam `[d1-ranking-guard]`. Não apagar o objeto de controle para forçar atualizações repetidas: a reserva é a proteção contra recorrência.

A rotina não cria alertas de cobrança na conta nem automações de mensagens. Para desfazer uma mudança funcional, preservar o produtor limitado e a proibição de consultas de ranking por visitante; rollback para uma versão anterior ao guard remove esta proteção.

## Auditoria e otimizações de custo — 01/10/2026

Preparadas na branch `codex/otimizar-custos`, em checkout isolado de `origin/main`
(`7af39db61cad7783b87ff9927f2aeafbe78a5938`). Ainda não publicadas.

### Evidência operacional

Painel da conta, verificado nesta conversa:

- Fatura de 11/09: US$ 220,66; ciclo de consumo 11/08–10/09 com US$ 194,91 de leituras D1 excedentes (219,91 bilhões de linhas).
- Ciclo 11/09–10/10: US$ 12,95 de consumo observado; projeção do painel de US$ 17,66. Valores de consumo, não a fatura final com mensalidades e ajustes.
- D1 no ciclo atual: 1,98 bilhão de leituras e 21,61 milhões de gravações, sem excedente. Últimas 24 horas: aproximadamente 5,14 milhões de linhas lidas.
- Consumo pago atual: requisições Workers US$ 6,60; operações R2 classe B US$ 3,60; armazenamento R2 US$ 2,25; CPU Workers US$ 0,50.
- Os custos são da conta inteira, que também possui buckets da Megumi; não atribuir todo o R2 ao blog.
- A consulta protegida de ranking, com `INDEXED BY idx_ph_bucket_path_count` e `LIMIT` na entrada, aparece em execução. O antigo excedente não está se repetindo nos dados observados.
- `CREATE TABLE IF NOT EXISTS active_visitors` apareceu aproximadamente 304 mil vezes em 24 horas. Isso é DDL redundante, não evidência de erro "table does not exist". O custo D1 é medido por linhas, não simplesmente pelo número de chamadas; remover DDL reduz trabalho e latência, sem promessa de economia de US$ 194,91.

Versão de produção confirmada pela API somente leitura: `217890af-be45-4cf1-963d-3e6a1fdfd382`, publicada em 30/09/2026 às 02:51 UTC (29/09 às 23:51 BRT). O JavaScript dessa versão foi comparado ao bundle da base `7af39db`: conteúdo idêntico após normalizar apenas comentários de caminhos de arquivos e referência de sourcemap. O WASM tem o mesmo nome com hash. Metadados dos bindings conferidos. A proposta acrescenta somente as alterações de custo abaixo.

### Alterações preparadas

1. **Contador ao vivo:** escrita e leitura usam diretamente a tabela. Bootstrap acontece somente após erro específico de ausência de `active_visitors`, compartilhado entre chamadas concorrentes. Recuperação cria também o índice `last_seen`; erro de bootstrap recebe espera de 60 segundos por isolate. Outros erros não disparam criação nem retry. Preservados frequência do heartbeat, janela de visitantes, contagem e limpeza existentes. Não exige migration no banco atual.
2. **Imagens:** `/img/` usa Cache API por ponto de presença antes de consultar R2. Originais e imagens negociadas para WebP têm chaves distintas; `orig=1` mantém original. URLs de campanha compartilham cache. HEAD conserva metadados do original; Range não é armazenado; 304, erros e respostas parciais não contaminam cache. Falha de cache continua servindo pelo caminho existente. Cache de borda dura até um dia; cache do navegador mantém o contrato anterior de nomes imutáveis. Se uma imagem precisar mudar, usar novo nome, como já exige o cache existente de um ano.
3. **API autenticada:** `/api/posts?views=1` agrupa as visualizações dos artigos em uma consulta por até 100 paths, mantendo a janela e os totais. Lista vazia não consulta contadores; listas maiores são divididas em lotes. Contratos de `/api/posts/top?hours=...` preservados.

### Economia e desempenho

- Caminho normal do heartbeat: uma escrita, eliminando a ida adicional para DDL. Teste com 1.000 heartbeats preservou todas as contagens e executou zero DDL.
- Imagens repetidas: teste com 100 pedidos realizou um carregamento da origem. A economia real depende da taxa de acerto por PoP, tamanho máximo cacheável, tráfego e disponibilidade de cache. A Cache API evita leituras R2 e processamento repetido; **não elimina a cobrança da invocação do Worker**. Não interpretar os US$ 3,60 do R2 da conta como economia garantida do blog.
- Listagem com visualizações: até 100 consultas de contadores passam a uma. Teste SQLite confirmou uso do índice por path/janela, ausência de varredura completa, totais e zeros preservados.
- Nenhum snapshot de ranking é calculado por visitante. Reservas, limites e testes da proteção anterior permanecem ativos.

### Outros pontos avaliados

- Rankings e sincronização AdSense já possuem reservas globais de frequência; não ampliar crons/retries.
- Migração de imagens já dispensa varreduras de progresso a cada minuto. Reduzir o cron pode atrasar imagens novas; manter a frequência atual neste escopo.
- Configuração HTML possui cache de 30 segundos; aumentá-lo atrasaria mudanças administrativas. Mantido.
- APIs/admin autenticados ainda agregam históricos e podem ter custo se usados intensamente. Consolidar relatórios com snapshots é uma possível etapa posterior, exigindo definir a tolerância a dados atrasados. A listagem de visualizações foi otimizada sem alterar sua atualização.
- Arquivos R2 derivados antigos (`_opt2`) podem ocupar espaço; não apagar sem inventário de referências e identificação do bucket. O armazenamento de toda a conta é pequeno em dinheiro comparado ao incidente D1.
- Limites de CPU, alteração de telemetria, redução de heartbeat, expiração de histórico e bloqueio de bots não foram adotados sem evidência específica: podem afetar imagens, diagnóstico, precisão ou leitores legítimos. As alterações deste escopo removem trabalho duplicado.
- Proteção de aplicação e alertas não equivalem a teto financeiro da conta. Uso malicioso, APIs autenticadas e outros produtos ainda podem gerar cobrança.

### Verificação e escopo para publicar

108 testes aprovados; `npm run check:deploy` (incluindo os novos módulos e `db.ts` na verificação TypeScript) e `wrangler deploy --dry-run` aprovados. Testes incluem fetch real do Worker, concorrência de recuperação de tabela, backoff, Cache API indisponível, variantes de imagem, 304, HEAD, Range, consultas SQLite e preservação das proteções de ranking.

Alvo de publicação: Worker `capitulo-de-hoje`, domínio `capitulodehoje.com.br`, DB `e8eae0e1-be0a-4fc6-8429-4ab9f072a544`, bucket `capitulo-de-hoje-images`. Branch `codex/otimizar-custos`. Sem execução de migration, exclusão de arquivos R2 ou alteração de assinatura.

Escopo de nove arquivos: `src/db.ts`, `src/index.ts`, `src/imageCache.ts`, `src/activeVisitors.test.mjs`, `src/imageCache.test.mjs`, `src/viewsBatch.test.mjs`, `src/workerSafety.test.mjs`, `tsconfig.cost-guard.json`, `docs/d1-cost-protection.md`.

Antes de publicar, atualizar `origin/main` novamente, confirmar ancestralidade e verificar que a versão ativa ainda é a revisada (ou reconciliar mudanças posteriores), além da confirmação contextual do usuário. Depois da publicação, verificar heartbeat, GET de imagem, cache HIT, HEAD, artigo e estado do ranking. A economia financeira só pode ser medida após tráfego real; a fatura histórica permanece devida até eventual ajuste da Cloudflare.
