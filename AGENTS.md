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
