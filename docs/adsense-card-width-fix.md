# Correção da largura dos anúncios entre cards — 05/10/2026

Autorização do usuário: “Pode corrigir e publicar”. Branch `codex/restaurar-adsense`, Worker `capitulo-de-hoje`, domínio `capitulodehoje.com.br`.

Produção confirmada antes da alteração: versão `fc56ae4f-7d2a-4f06-9c5d-9ae88f0f3320`, 100% do tráfego, correspondente à restauração `232099c`. `origin/main` continua ancestral da branch.

Na home, nove unidades manuais apresentaram largura zero e erro `No slot size for availableWidth=0`, tanto em desktop quanto em viewport 390x844. A restauração de 02/10 havia removido a correção de largura junto com regras de colapso. O card é flex e o `ins` vazio encolhe sem largura explícita.

Correção exclusiva: `.post-card--ad > ins.adsbygoogle { width: 100%; }`. Não restabelece colapso de slots, alturas forçadas ou o runtime nativo. Preserva os artigos, limites, posições, publisher, configurações e proteções D1.

Reprodução local sem anúncios reais, usando o CSS do site: desktop 0 → 302 px; mobile 390 px, 0 → 307,5 px. O teste de baseline exige a regra uma única vez e mantém o hash histórico de todas as demais regras, sem atualizar a referência para ocultar diferenças.

O defeito é comprovado; sua correção não garante preenchimento de todos os slots nem recuperação de toda a receita. O slot entre cards representava aproximadamente 0,77% da receita total no relatório de 30 dias consultado. A perda restante requer análise por formato/período.

Escopo: `public/styles.css`, `src/adsenseLayout.test.mjs` e este documento. Sem migrations ou alterações de configurações de anúncios.
