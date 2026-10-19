---
# capitulo-de-hoje-zm41
title: Proteger /api/heartbeat contra escrita aberta e mover limpeza para o cron
status: todo
type: bug
priority: normal
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:55:41Z
---

O heartbeat do contador ao vivo é o único endpoint público que grava no D1 sem nenhuma checagem de origem, e a limpeza da tabela depende de alguém abrir o painel.

## Evidência
- `src/index.ts:1130-1140`: `POST /api/heartbeat` aceita qualquer origem (`Access-Control-Allow-Origin: *`) e qualquer `vid` de até 64 caracteres. Cada `vid` novo é um INSERT em `active_visitors`, então um script pode gerar escritas ilimitadas.
- Para comparação, `POST /api/ev` (`src/index.ts:1145-1147`) já recusa requisições que não sejam `Sec-Fetch-Site: same-origin`.
- `src/index.ts:1168`: `cleanupStaleVisitors` só roda quando o admin consulta `/api/active-visitors`. Sem o painel aberto, a tabela acumula uma linha por visitante e o próximo DELETE apaga tudo de uma vez.
- `docs/d1-overload-protection.md:4`: o fluxo de visitantes já chegou a gerar "cerca de 435 mil CREATE TABLE de visitantes por dia" e contribuiu para o erro de D1 sobrecarregado. `AGENTS.md` pede para preservar a deduplicação e a atualização de visitantes ativos.

## O que fazer
- [ ] Aplicar ao heartbeat a mesma checagem de origem do `/api/ev`, sem quebrar o envio por `sendBeacon`
- [ ] Mover a limpeza de `active_visitors` para o `scheduled` (com limite de linhas por execução)
- [ ] Manter a cadência de 60 s, a deduplicação SQL e os testes de `src/workerSafety.test.mjs`
