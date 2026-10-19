---
# capitulo-de-hoje-87fp
title: Login do admin sem limite de tentativas e sessão sem revogação
status: todo
type: bug
priority: high
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:55:41Z
---

O login do painel não tem nenhuma proteção contra tentativa e erro, e a sessão não pode ser revogada sem efeitos colaterais.

## Evidência
- `src/index.ts:540-555`: `POST /admin/login` compara usuário e senha com `!==` direto contra `ADMIN_USERNAME`/`ADMIN_PASSWORD`, sem limite de tentativas, atraso ou registro de falhas.
- `src/auth.ts:34`: assinatura da sessão comparada com `!==` (comparação que não é de tempo constante).
- `src/auth.ts:22-27`: o token é só `expiração.HMAC`, válido por 7 dias. O logout apenas apaga o cookie; um token copiado continua válido.
- A única forma de invalidar todas as sessões é trocar `SESSION_SECRET`, mas `docs/adsense-reports.md` (seção "Segurança e armazenamento") diz que a mesma chave deriva a criptografia das conexões AdSense/Analytics: "Rotacionar `SESSION_SECRET` exige reconectar e torna snapshots anteriores indecifráveis".

## O que fazer
- [ ] Limitar tentativas de login (por exemplo, contador simples no R2 ou Rate Limiting do Cloudflare), sem consultas novas ao D1 por visita
- [ ] Comparar credenciais e assinatura em tempo constante
- [ ] Separar a chave de sessão da chave de criptografia (ou adicionar uma versão de sessão) para poder derrubar sessões sem perder as conexões Google
