---
# capitulo-de-hoje-quwf
title: Página de erro 500 expõe a mensagem interna do erro ao visitante
status: todo
type: bug
priority: high
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:55:41Z
---

Qualquer exceção não tratada no `fetch` devolve uma página pública com a mensagem interna do erro, sem escapar HTML.

## Evidência
- `src/index.ts:1457-1462`:
  ```ts
  console.error('Worker error:', err);
  return new Response(`<h1>Erro interno</h1><pre>${String(err)}</pre>`, ...)
  ```
- Erros do D1, do R2 ou de parsing podem levar trechos de SQL, nomes de tabelas, caminhos internos ou parte da entrada da requisição para a página que o visitante vê. Como o texto entra cru no HTML, uma mensagem com `<` vira marcação.
- O resto do código já evita expor detalhes (por exemplo, `docs/adsense-reports.md`: "falhas Google não expõem tokens nem corpos de respostas").

## O que fazer
- [ ] Responder 500 com uma página genérica (de preferência no layout público), sem o texto do erro
- [ ] Manter o `console.error` para os logs do Worker, sem registrar credenciais
- [ ] Teste do Worker que force uma exceção e confira que a resposta não contém a mensagem
