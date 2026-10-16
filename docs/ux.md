# UX do site público: leitura grande e confortável

O público do Capítulo de Hoje inclui senhoras e pessoas mais velhas. Priorize leitura sem esforço; não diminua letras para fazer um componente caber. Estas são regras do produto, incluindo os cards de notícias relacionadas.

## Tamanhos mínimos

| Papel do texto | Regra obrigatória |
| --- | --- |
| Texto principal de leitura e novos componentes editoriais | Mínimo de **22 px** computados, no celular e no computador. |
| Título de recomendação dentro do artigo | Pelo menos o tamanho do corpo do artigo, com piso de **22 px**. Deve acompanhar aumentos na tipografia do artigo. |
| Textos auxiliares, selos e nome da novela | Mínimo de **16 px** computados em qualquer largura. |
| Grifos no título | Herdam tamanho, peso e entrelinha do próprio título. Nunca diminuem a letra. |

A referência aprovada do artigo em `t-body-lg` é aproximadamente **22,3 px no celular e 24,9 px no computador**, com o CSS raiz atual. O card deve acompanhar essa escala, e não voltar para 16/18 px no título. As opções antigas de tamanho do artigo não são alteradas por esta correção: em qualquer opção, o título do card mantém seu piso de 22 px.

## Layout e interação

- Entrelinha de pelo menos **1,5** nos títulos de recomendação e nos textos auxiliares. Para o corpo do artigo, manter a entrelinha confortável já configurada.
- Usar unidades relativas para acompanhar a escala do artigo e a preferência de tamanho de texto; o piso em px é uma proteção, não um teto.
- No celular, adaptar espaçamentos e permitir maior altura. Nunca resolver falta de espaço diminuindo a fonte, cortando o título ou limitando suas linhas.
- Preservar a foto à esquerda e o texto à direita nos cards relacionados, com foto acompanhando a altura do texto.
- Permitir quebra de palavras longas sem rolagem horizontal. Não fixar altura que corte texto.
- Permitir zoom e aumento de texto a 200%, sem perda de conteúdo ou de acesso ao link. Não desabilitar o zoom.
- Manter foco visível, o card inteiro clicável e contraste legível, inclusive nos dois grifos.

## Verificação antes de publicar

Medir com `getComputedStyle` o parágrafo do artigo, o título do card, o selo, o nome da novela e os grifos. Conferir pelo menos 320, 390, 768 e 1440 px, uma configuração menor e uma maior de tipografia, além de aumento de texto a 200%. O título precisa continuar inteiro, sem sobrepor a foto ou provocar rolagem horizontal.

Escopo: leitura editorial pública. As tabelas e os controles do painel administrativo têm regras próprias; não aplicar a escala compacta do admin aos artigos ou aos cards públicos.
