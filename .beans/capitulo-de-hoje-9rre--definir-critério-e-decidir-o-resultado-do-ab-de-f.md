---
# capitulo-de-hoje-9rre
title: Definir critério e decidir o resultado do A/B de fotos photo-v1
status: todo
type: task
priority: normal
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:56:00Z
blocked_by:
    - capitulo-de-hoje-gp3x
---

O A/B `photo-v1` (foto estática x recortes animados) está rodando desde 16/10/2026, mas não existe um passo definido para ler o resultado e encerrar ou adotar uma variante.

## Evidência
- `docs/photo-ab-test.md:13`: "Não há declaração automática de vencedor ou significância estatística."
- `docs/photo-ab-test.md:67`: a troca para a composição `luna-shoulders-v1` em 16/10 criou um período de transição que "deve ser tratado como transição ao interpretar resultados".
- `docs/project-notes/plans/2026-10-17-photo-traffic-batch.md:41`: relatórios de engajamento já disponíveis, receita por versão ainda não.
- O plano `docs/project-notes/plans/2026-10-16-photo-ai-ab-launch.md` cobre implementação e lançamento; nenhum item cobre a decisão.

## O que fazer
- [ ] Definir antes da leitura: métrica principal (receita por mil sessões ou engajamento), período a partir do fim da transição e amostra mínima
- [ ] Ler o painel `/admin/teste-fotos` por aparelho e dentro do grupo AdSense
- [ ] Decidir: adotar recortes para todos, voltar à foto estática ou seguir coletando
- [ ] Se encerrar, desligar o sorteio sem reiniciar o identificador e registrar o resultado em `docs/photo-ab-test.md`

Bloqueado por capitulo-de-hoje-gp3x se a métrica principal for receita; engajamento já pode ser lido.
