# Correção da largura dos anúncios entre cards — 05/10/2026

Autorização do usuário: “Pode corrigir e publicar”. Branch `codex/restaurar-adsense`, Worker `capitulo-de-hoje`, domínio `capitulodehoje.com.br`.

Produção confirmada antes da alteração: versão `fc56ae4f-7d2a-4f06-9c5d-9ae88f0f3320`, 100% do tráfego, correspondente à restauração `232099c`. `origin/main` continua ancestral da branch.

Na home, nove unidades manuais apresentaram largura zero e erro `No slot size for availableWidth=0`, tanto em desktop quanto em viewport 390x844. A restauração de 02/10 havia removido a correção de largura junto com regras de colapso. O card é flex e o `ins` vazio encolhe sem largura explícita.

Correção exclusiva: `.post-card--ad > ins.adsbygoogle { width: 100%; }`. Não restabelece colapso de slots, alturas forçadas ou o runtime nativo. Preserva os artigos, limites, posições, publisher, configurações e proteções D1.

Reprodução local sem anúncios reais, usando o CSS do site: desktop 0 → 302 px; mobile 390 px, 0 → 307,5 px. O teste de baseline exige a regra uma única vez e mantém o hash histórico de todas as demais regras, sem atualizar a referência para ocultar diferenças.

O defeito é comprovado; sua correção não garante preenchimento de todos os slots nem recuperação de toda a receita. O slot entre cards representava aproximadamente 0,77% da receita total no relatório de 30 dias consultado. A perda restante requer análise por formato/período.

Escopo: `public/styles.css`, `src/adsenseLayout.test.mjs` e este documento. Sem migrations ou alterações de configurações de anúncios.

## Publicação

- 110 testes e TypeScript aprovados em `npm run check:deploy`; `wrangler deploy --dry-run` aprovado. Build guard executou novamente durante o deploy.
- Commit `bbad219` enviado à branch `codex/restaurar-adsense`.
- Publicado em 05/10/2026 às 16:08 BRT, versão `38b96474-835d-4e66-ae49-22fa338d3676`; listagem de deployments confirma 100% do tráfego.
- Verificação HTTP pós-publicação: home e categoria com nove slots, artigo com onze, nenhum slot nativo; os três HTMLs referenciam CSS que contém a correção.
- A confirmação da limpeza gradual de cache pelo painel foi interrompida pelo bloqueio do Mac. Resultado da ação não confirmado. Verificação visual final em produção pendente de desbloqueio; não confundir verificação HTTP com preenchimento real pelo Google.
