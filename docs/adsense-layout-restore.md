# Restauração do layout AdSense — 02/10/2026

## Resultado da investigação

A queda começou em 30/09, conforme o usuário e o relatório privado do AdSense, sincronizado em 02/10 às 20:32 BRT. Valores estimados em USD:

| Dia | Receita | Páginas AdSense | Impressões | RPM de página | Impressões / página |
| --- | ---: | ---: | ---: | ---: | ---: |
| 28/09 | 119,45 | 63.842 | 323.973 | 1,87 | 5,07 |
| 29/09 | 170,41 | 80.184 | 471.063 | 2,13 | 5,87 |
| 30/09 | 62,25 | 33.991 | 218.235 | 1,83 | 6,42 |
| 01/10 | 50,24 | 35.635 | 193.155 | 1,41 | 5,42 |

A receita caiu junto com as páginas monetizadas e o RPM. As impressões por página não mostram redução generalizada da quantidade de anúncios em 30/09. Esses dados, isoladamente, não estabelecem a causa inteira da perda.

## Commits relevantes de 29/09

- `69cceea`: acrescentou colapso de slots vazios, largura explícita no anúncio da home e largura de tela no celular.
- `b6fba57`: passou a sobrescrever a altura de unidades `unfill-optimized` e limitar o host `.google-aiuf`.
- `fe61ca1`: introduziu substituição de unidades por banners nativos e templates.
- `900452e`: corrigiu a gravação dos slots extras no painel. O formulário anterior ignorava esses campos e poderia apagar extras existentes ao salvar.
- `d516b27`: o sorteio passou a ser por leitor. O grupo nativo deixou de carregar o Google por completo, incluindo anúncios automáticos, âncora e vinheta.
- `faec0cd`, `4fea76c`, `7af39db`: variação dos banners, relatórios e identificação de cliques; não mudaram o algoritmo de posições do AdSense.

O painel atual informa teste desligado, percentual configurado de 30%. O acumulado desde 29/09 tem 54.136 páginas nativas e 72.625 páginas AdSense (43% nativas). Trata-se de acumulado de um teste cuja configuração pode ter mudado; não interpretar como prova de defeito no sorteio. Âncora e vinheta representam juntas 50,8% da receita AdSense do relatório de 30 dias.

## Estado atual confirmado, somente leitura

Painel AdSense: Auto Ads ligado; antes do título, topo do conteúdo, meio do texto, final do conteúdo e entre cards ligados; rodapé e sticky manual desligados. Intervalo no texto: 2 parágrafos; home: 6 cards; nenhum extra configurado.

| Posição | Slot |
| --- | --- |
| Antes do título | 8856159215 |
| Topo do conteúdo | 2290750862 |
| Meio do texto | 4047668207 |
| Final do conteúdo | 5688052933 |
| Entre cards | 9567588198 |

No artigo público `otoniel-flagra-elisa-beijando-eneas-e-fica-destruido-com-descoberta-quem`, foram encontradas 11 unidades manuais (1 antes do título, 1 no topo do conteúdo, 8 no texto, 1 ao final), além de unidades automáticas. O script Google está no head e não há `.cdh-mix`. O formato no texto é `fluid` / `in-article`, imposto pelo código desde antes dos testes, mesmo com `auto` salvo no painel.

Não foram feitas gravações no painel, no D1 ou na conta Google. As configurações históricas de `adsense.placements` não estão no Git: não foi recuperada uma cópia anterior ao dia 29. Portanto a equivalência verificada é do código **para as mesmas configurações**, não prova de identidade das configurações históricas. Se extras ou intervalos foram alterados pelo painel, recuperar esse estado continua necessário para uma restauração literal de todo o estado anterior.

## Alteração preparada

Branch `codex/restaurar-adsense`, baseada em `6217683` (versão publicada de otimização de custos, com `origin/main` como ancestral). A versão ativa foi confirmada como `0d3b3097-c217-47b7-8338-6885e95f84bb`, 100% do tráfego, publicada em 01/10 às 21:18 BRT.

`public/styles.css`: remoção das 54 linhas acrescentadas por `69cceea` e `b6fba57`. A seção pública inteira de AdSense passa a ser idêntica à de `38882a7`, anterior aos testes. A reversão inclui o comportamento antigo da home: retira a largura explícita que havia sido adicionada para corrigir slots com largura zero. Isso pode trazer de volta essa limitação anterior na home; o objetivo aqui é recuperar o CSS original, sem atribuir a essa regra a queda de receita.

O algoritmo de posição já é equivalente ao anterior quando o teste está desligado, portanto não precisou de alteração. Integração dos relatórios, proteção D1 e otimizações publicadas em 01/10 foram preservadas.

## Validação

- `src/adsenseLayout.baseline.json`: referência gerada pelo renderer e módulo AdSense históricos de `38882a7`, não pelo renderer atual.
- `src/adsenseLayout.test.mjs`: compara ordem dos parágrafos, títulos, hero, compartilhamento, tags completas das unidades, pushes e biblioteca Google em artigos curtos/longos, subtítulos, citações, extras, sticky e home. Confere hash do CSS original.
- 110 testes aprovados e TypeScript da proteção aprovado em `npm run check:deploy`.
- `wrangler deploy --dry-run` aprovado, incluindo nova execução obrigatória dos testes pelo build guard.

Reversão autorizada pelo usuário e publicada em 02/10/2026 às 21:07 BRT. Não há promessa de recuperar um valor de receita: isso precisa ser observado após a restauração com tráfego real.

## Escopo para confirmação de produção

Alvo: Worker `capitulo-de-hoje`, domínio `capitulodehoje.com.br`, ambiente produção, conta Cloudflare `contatoeaoki@gmail.com`. Branch `codex/restaurar-adsense`. Arquivos exclusivos:

- `public/styles.css`
- `src/adsenseLayout.test.mjs`
- `src/adsenseLayout.baseline.json`
- `docs/adsense-layout-restore.md`

Após confirmação: verificar novamente main e versão ativa, commitar e enviar somente esses arquivos nesta branch, publicar do worktree protegido e verificar artigo/home. Sem merge automático na main e sem alterações de configurações de produção ou migrations. Se a versão ativa mudar, reconciliar antes do deploy. A confirmação contextual é obrigatória pelo AGENTS.md.

## Publicação concluída

- Commit `232099c` enviado na branch `codex/restaurar-adsense`. Main permaneceu em `7af39db`, ancestral confirmado.
- Publicado no Worker `capitulo-de-hoje` às 21:07 BRT de 02/10; versão `fc56ae4f-7d2a-4f06-9c5d-9ae88f0f3320`, 100% do tráfego confirmado pela API de deployments.
- 110 testes, TypeScript e dry-run aprovados novamente; o build guard repetiu os testes durante a publicação.
- A primeira conferência encontrou HTML antigo em cache com URL imutável do CSS anterior. A limpeza gradual pelo painel `/admin/cache` foi concluída às 21:08:57 BRT, incrementando somente `cache.version` para `1781471533` e o registro da limpeza. Nenhuma configuração de anúncios foi alterada.
- Depois da limpeza, artigo e home carregaram `/styles.css?v=1790986071142`. As regras removidas não aparecem no CSS carregado. Artigo com 11 unidades manuais; home com 9; ambos sem `.cdh-mix`.
- Sem migrations, alterações em campanhas Google ou rollback das proteções D1 e otimizações de custo. Receita após a restauração ainda não foi medida.
