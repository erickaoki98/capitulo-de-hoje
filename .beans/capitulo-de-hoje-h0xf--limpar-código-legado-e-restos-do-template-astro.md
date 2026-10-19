---
# capitulo-de-hoje-h0xf
title: Limpar código legado e restos do template Astro
status: todo
type: epic
priority: normal
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:55:41Z
---

Agrupa a remoção de código e arquivos que sobraram de funcionalidades descontinuadas (Shopee, Usuários, Cartões/Empregos, protótipos de fotos) e do template Astro original. Nada disso roda em produção, mas atrapalha manutenção, esconde erros de tipo e confunde quem chega ao repositório.

## Evidência
- `src/render.ts` importa tipos que não existem mais (linhas 5-7) e mantém telas de admin sem rota.
- `src/db.ts:506-736` tem funções de Cartões/Empregos/A-B antigos sem nenhum uso; `src/index.ts:282` marca Cartões como descontinuado.
- `docs/d1-cost-protection.md:27` registra que o `tsc` do projeto inteiro falha por causa de `render.ts`, por isso `tsconfig.cost-guard.json` verifica só um subconjunto.
- `README.md` e `.vscode/` ainda são do Astro Starter Kit.

Trabalho nos beans filhos. Remover sempre com `npm run check:deploy` passando e sem tocar nas proteções de custo do D1 (`AGENTS.md`).
