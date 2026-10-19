---
# capitulo-de-hoje-o5hy
title: Remover código, tipos e seeds de Cartões/Empregos descontinuados
status: todo
type: task
priority: low
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:55:41Z
parent: capitulo-de-hoje-h0xf
---

A área de Cartões foi descontinuada (redirect 301 para a home), mas o código, os tipos, as seeds e as tabelas de Cartões, Empregos, cliques de saída e do A/B antigo de título continuam no repositório.

## Evidência
- `src/index.ts:282`: "Cartões descontinuado: /cartoes e redirects de afiliado → home (301)".
- `src/db.ts:506-736`: `listCreditCards`, `getCreditCardById`, `createCreditCard`, `listJobs`, `createJob`, `recordOutboundClick`, `outboundClicksByTarget`, `outboundClicksTotal`, `recordAbEvent`, `abTestResults` e afins, sem nenhum uso fora de `db.ts`.
- `src/types.ts:51-131`: `CreditCard`, `Job`, `OutboundClickKind` e inputs.
- `seeds/cartoes-brasil.sql` e `seeds/cartoes-logos.sql`: seeds de afiliados com links placeholder.
- `src/render.ts:811`: ramo de "promo interno (cartões)"; `src/render.ts:1125` sempre passa `promoHtml = null`.
- Tabelas `credit_cards`, `jobs`, `outbound_clicks` (`migrations/0004-cartoes-empregos.sql`) e `ab_events` (`migrations/0005-ab-test-cartoes-titulo.sql`).

## O que fazer
- [ ] Remover funções, tipos, seeds e o ramo de promo sem uso
- [ ] Decidir se as tabelas ficam como histórico ou saem por migration (sem DROP automático em produção sem confirmação)
- [ ] Manter os redirects 301 de `/cartoes`, `/ir/cartao/` e `/ir/promo/`
- [ ] `npm run check:deploy` passando
