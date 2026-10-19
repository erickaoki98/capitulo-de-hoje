---
# capitulo-de-hoje-gp3x
title: Vincular Google Analytics ao AdSense para medir receita do teste de fotos
status: todo
type: task
priority: normal
created_at: 2026-10-19T23:55:41Z
updated_at: 2026-10-19T23:55:41Z
---

A receita por versão no teste de fotos continua indisponível porque a propriedade do Google Analytics ainda não está vinculada ao AdSense.

## Evidência
- `docs/photo-ab-test.md:55`: "A administração do Analytics confirmou que a propriedade ainda não tem vínculo com o AdSense." A tentativa autorizada de vincular parou porque a tela de gerenciamento de acesso não carregava; nenhuma permissão foi alterada.
- `docs/photo-ab-test.md:75`: "O AdSense continua sem vínculo confirmado."
- `docs/project-notes/plans/2026-10-17-photo-traffic-batch.md:41`: "A receita por versão continua indisponível enquanto o vínculo AdSense/Analytics não estiver confirmado."
- O painel `/admin/teste-fotos` já trata receita ausente como nula (`src/photoReports.ts`), então nada no código precisa mudar para o vínculo funcionar.

## O que fazer
- [ ] Com confirmação de quem administra a conta, criar o vínculo entre a propriedade e o publisher já usado no site
- [ ] Devolver qualquer permissão temporária ao nível anterior
- [ ] Confirmar no painel que a receita aparece para dias completos depois do vínculo
