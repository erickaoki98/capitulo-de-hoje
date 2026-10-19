---
# capitulo-de-hoje-376v
title: 'Workflow de deploy: Node 24, npm ci, concurrency e ignorar mudanças só de docs'
status: todo
type: task
priority: normal
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:55:41Z
---

O workflow de deploy não segue o que a documentação do projeto pede e já causou deploys duplicados.

## Evidência
- `.github/workflows/deploy.yml`: usa `node-version: '22'` e `npm install`. `docs/d1-cost-protection.md:18` diz que "o desenvolvimento usa Node 24+ por causa dos testes SQLite/TypeScript", e o build do Wrangler roda esses testes (`wrangler.jsonc` → `npm run check:deploy`).
- Sem `concurrency`: dois pushes seguidos disparam dois deploys em paralelo. `docs/d1-overload-protection.md:30` registra que execuções ficaram na fila e foram canceladas à mão "para evitar deploy duplicado". No GitHub Actions, a execução 39280343028 foi cancelada e a 39280504015 levou 22 min.
- Sem `paths-ignore`: commits que só mexem em `docs/` ou `.beans/` publicam o Worker de novo (o commit `e7bda42`, que só adicionou o Beans, gerou um deploy). Hoje isso é evitado à mão com `[skip ci]`.
- `docs/d1-cost-protection.md:18` explica que o workflow não foi alterado antes porque a credencial usada não tinha permissão de editar workflows.

## O que fazer
- [ ] Node 24 e `npm ci` no workflow
- [ ] `concurrency` com cancelamento do deploy anterior em andamento
- [ ] `paths-ignore` para `docs/**`, `.beans/**` e arquivos `.md`
- [ ] Editar com uma credencial que tenha permissão de workflow, sem ampliar acessos do token de deploy
