---
# capitulo-de-hoje-3rjo
title: Remover protótipos de foto sem uso (photo-auto-focus.js e photo-map-editor.js)
status: todo
type: task
priority: low
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:55:41Z
parent: capitulo-de-hoje-h0xf
---

Dois módulos de fotos ficaram para trás depois que o enquadramento passou a ser feito pelo modelo no Worker. Eles são servidos como assets públicos e mantidos por testes, mas nenhuma página os carrega.

## Evidência
- `public/photo-auto-focus.js`: só é referenciado por `src/photoAutoFocus.test.mjs` e `scripts/photo-focus-lab.*`. `docs/photo-focus-five-images.md:3` diz que "não está conectado ao experimento público".
- `public/photo-map-editor.js`: só é referenciado por `src/photoMapEditor.test.mjs`. O plano `docs/project-notes/plans/2026-10-16-photo-ai-ab-launch.md` (seção 3) mandou "retirar editor manual do fluxo do painel" e `src/photoRoutes.test.mjs:91` garante que o editor não aparece mais.
- O fluxo em produção é o descrito em `docs/photo-ab-test.md` (seção "Enquadramento automático").

## O que fazer
- [ ] Decidir se o laboratório local (`scripts/photo-focus-lab.*`, `scripts/photo-focus-samples.json`) ainda tem valor
- [ ] Se não tiver, remover os dois módulos, os testes correspondentes e o laboratório
- [ ] Não mexer em `public/related-faces.js`, `public/related-face-policy.js` nem em `public/vendor/related-faces-v1/`, que estão em uso
