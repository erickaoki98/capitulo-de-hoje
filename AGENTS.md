# Proteção de custo D1

Incidente confirmado em 12/09/2026: rankings públicos causaram 99,74% das leituras do ciclo, com US$ 194,91 de excedente. Preservar estas invariantes em toda alteração:

- Requisições públicas de artigos apenas leem o snapshot. Nunca executar agregações de `pageviews_hourly` como fallback de cache, R2, erro ou ranking vazio.
- O produtor de rankings roda somente no `scheduled`, exige reserva condicional global no R2 e respeita os limites fixos de frequência e entrada em `src/rankingSnapshot.ts`.
- Falhas consomem a reserva. Não criar retries rápidos nem remover `INDEXED BY` da consulta limitada para contornar índice ausente.
- Preservar a normalização de URLs de rastreamento, a exclusão de categorias arquivadas e a contagem de pageviews.
- Executar `npm run check:deploy` e `wrangler deploy --dry-run` antes de propor publicação. Não remover o custom build nem os testes para fazer um deploy passar.
- Antes de publicar, atualizar `origin/main` e confirmar que é ancestral da branch de trabalho. Não publicar um checkout antigo com mudanças locais de outras tarefas. Revisar o diff em relação à versão publicada.
- A autorização para implementar não substitui a confirmação contextual de produção exigida pelo usuário. Mostrar branch, arquivos e alvo; não publicar sem a confirmação.

Limite da proteção: protege o produtor dos rankings públicos. Não é um teto financeiro da conta Cloudflare; consultas administrativas/autenticadas e demais recursos continuam tendo consumo próprio. Um deploy que deliberadamente remova estas proteções pode contorná-las.

# UX obrigatória: público de senhoras

- Antes de alterar layout, CSS ou componentes públicos, ler [docs/ux.md](docs/ux.md).
- Texto principal e título de recomendação: **mínimo de 22 px**; o título do card nunca pode ser menor que o corpo do artigo.
- Textos auxiliares e nome da novela: **mínimo de 16 px**. Não reduzir esses pisos no celular.
- O card cresce em altura para acomodar a leitura; não diminuir fonte, truncar títulos ou limitar linhas para fazê-lo caber.
- Medir os tamanhos computados no navegador e verificar aumento de texto a 200% antes de publicar alterações de tipografia.

# D1: custo e sobrecarga (19/10/2026)

- Preservar `withD1Telemetry` nas entradas fetch e scheduled, sem mutar o binding compartilhado, sem retries novos e sem registrar SQL, parâmetros ou credenciais. Os avisos são limitados por execução; não são um teto financeiro da conta.
- Não executar DDL por visita/heartbeat. Tabelas e índices devem existir por migrations, verificadas antes do deploy. Preservar a deduplicação SQL e a atualização de visitantes ativos.
- O produtor do ranking exige também `idx_posts_ranking_metadata`. Aplicar `0008_d1_overload.sql` antes do Worker que o usa. Não retirar `INDEXED BY` para esconder falta do índice.
- Cards de rodapé e API de ranking usam metadados; cards inseridos nas seções precisam das imagens do conteúdo para fallback. Preservar essa diferença e os testes consulta→render.
- Novas consultas públicas/rotinas devem ter teste proporcional de quantidade, entrada limitada e plano de índice. `check:deploy` continua obrigatório para qualquer implementação ou otimização.
- Nunca cortar pageviews, gravações essenciais ou funcionamento do site para simular um teto de custos. Um limite financeiro rígido exige uma decisão de produto sobre o que pode ser interrompido.
