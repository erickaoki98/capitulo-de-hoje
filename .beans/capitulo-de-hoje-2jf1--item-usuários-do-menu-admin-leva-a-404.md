---
# capitulo-de-hoje-2jf1
title: Item Usuários do menu admin leva a 404
status: todo
type: bug
priority: normal
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:56:00Z
---

O menu lateral do admin mostra "Usuários", mas a rota não existe e o clique cai na página 404.

## Evidência
- `src/render.ts:2021`: item de navegação `['users', '/admin/users', 'Usuários']`, visível para o papel admin.
- `src/render.ts:4328-4341`: formulários postam para `/admin/users/<id>/role`, `/delete` e `/profile`.
- `src/index.ts`: nenhuma rota `/admin/users`; a requisição cai no 404 padrão (`src/index.ts:1456`).
- A própria tela diz que o login principal vem das variáveis de ambiente (`src/render.ts:4385`), e não há tabela de usuários em `schema.sql` nem nas migrations.

## O que fazer
- [ ] Decidir: remover o item do menu (caminho mais simples, já que o login é único por env vars) ou reimplementar usuários
- [ ] Se remover, apagar também a tela `renderAdminUsers` (ver capitulo-de-hoje-mzfk)
- [ ] Conferir que todos os itens do menu admin (desktop e mobile) abrem uma rota existente
