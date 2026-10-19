# Proteções D1 — 19/10/2026

## Problema e escopo
O erro `D1 DB is overloaded. Requests queued for too long` é fila saturada, não franquia financeira. As métricas anteriores à alteração mostravam cerca de 435 mil CREATE TABLE de visitantes por dia e a consulta de metadados do ranking levava em média 1,35 s com SCAN posts.

## Mudanças
- Nenhum CREATE TABLE no fluxo de heartbeat/admin. A migration 0007 já cria a tabela e o índice de visitantes.
- Heartbeat mantém cadência de 60 s para abas visíveis; localStorage coordena abas e SQL impede regravar o mesmo visitante/local nos 55 s anteriores. Mudanças de local e a renovação normal continuam gravadas. Falha de storage não quebra o script. Pageviews permanecem contados por acesso.
- Índice pequeno de cobertura `(id,slug,category,draft)` elimina leitura das páginas grandes de conteúdo no produtor do ranking. A reserva global de 30 minutos, limites e fallback existentes permanecem.
- Cards comuns leem metadados. Cards entre seções continuam lendo conteúdo quando necessário para preservar a foto alternativa. APIs de artigo completo permanecem completas.
- `withD1Telemetry` mede consultas, linhas lidas/escritas, duração e erros em fetch/scheduled, inclusive tarefas em waitUntil. Avisos `[d1-pressure]` por execução: >100 mil leituras, >mil escritas, >100 consultas ou consulta >250 ms. Logs não contêm SQL bruto, parâmetros, URLs nem credenciais. No máximo quatro motivos por execução. Sem retries, consultas adicionais de monitoramento ou bloqueio de operações essenciais.
- Testes SQLite, de Worker e de navegador simulado verificam planos, filtros, fotos alternativas, pageviews, limite de consultas públicas, ausência de DDL por heartbeat, deduplicação, storage indisponível e compatibilidade do proxy. O custom build já exige `npm run check:deploy` antes de publicar.

## Limites honestos
Os limites financeiros agregados da conta não são controlados por este código. Telemetria detecta excesso após a operação e não impede uma consulta isolada cara. O guard de deploy protege os caminhos testados; novas consultas precisam de testes de orçamento/plano. Não há promessa de impedir todo overload. Um teto duro para toda a conta implicaria interromper recursos, contrariando o requisito de manter o site funcionando.

## Publicação e operação
Alvo: Worker `capitulo-de-hoje`, domínio `capitulodehoje.com.br`, D1 `e8eae0e1-be0a-4fc6-8429-4ab9f072a544`. Migration 0008 é aditiva e idempotente; não altera dados editoriais. Verificar o índice com EXPLAIN antes do deploy. Preservar o estado de reserva no R2 e as migrations anteriores. Em rollback do Worker, o índice extra pode permanecer.

Filtrar logs por `[d1-pressure]`, motivos `budget`, `slow`, `overload`, `error`; cruzar `queryKey` (FNV-1a hexadecimal do SQL do código, sem parâmetros) com o trecho correspondente. Usar D1 Insights para atribuir custo/latência e identificar picos. O monitoramento não cria notificações externas ou automações.

## Validação desta entrega
- 259 testes aprovados, checagem TypeScript dos módulos protegidos e dry-run completos aprovados.
- Revisão independente encontrou o fallback de fotos e a correção foi testada antes da publicação.
- Migration 0008 aplicada: 13.880 escritas de índice, sem alteração editorial.
- Produção: EXPLAIN confirmou `SCAN posts USING COVERING INDEX idx_posts_ranking_metadata`; consulta limitada retornou 13.879 registros em 37,24 ms. Comparação indicativa com média histórica de 1.346 ms; não é garantia para toda carga futura.
