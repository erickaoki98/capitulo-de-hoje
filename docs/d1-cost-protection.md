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
