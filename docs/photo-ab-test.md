# Teste de fotos — Capítulo de Hoje

**Alvo:** `capitulodehoje.com.br`, Worker `capitulo-de-hoje`.
**Branch:** `codex/photo-ab-retention-revenue`, com `origin/main` incorporada.
**Painel:** `/admin/teste-fotos`, na navegação administrativa do blog.

## Experimento

Sorteio 50/50 persistido por navegador em `cdh_photo_ab:photo-v1`. Só uma foto editorial com mapa aprovado pode inscrever novos navegadores; depois, o grupo acompanha a navegação. O bootstrap define `photo_ab_v1` (`static` ou `motion`) antes da primeira configuração do GA. Essa dimensão de usuário já foi registrada na propriedade `450970542`.

O controle recebe a foto original; o tratamento recebe os recortes aprovados, com alternância a cada 2,4 segundos e a transição C (tremor + glitch) de 230 ms. Há pausa por foto; alternância fora da tela ou com a aba oculta é suspensa. Movimento reduzido, falha, formato não quadrado ou menos de dois recortes seguros preservam a imagem original. Hero, recomendações, anúncios e tipografia do artigo conservam seu comportamento.

A análise segue a variante sorteada, inclusive quando uma preferência de acessibilidade ou uma foto sem mapa impede a animação. A divisão observada no painel usa sessões, não pessoas únicas. Engajamento e permanência são indicadores indiretos; o relatório não mede retorno de visitantes. Trocas automáticas não enviam eventos de engajamento. Não há declaração automática de vencedor ou significância estatística.

## Enquadramento automático

O Worker reutiliza sua `OPENAI_API_KEY` existente. As fotos editoriais locais do corpo são extraídas do HTML; anúncios, links e recomendações são excluídos. Não há editor manual no fluxo nem detecção paga em cada visita.

O GPT-6 Luna identifica até três assuntos com os prompts aprovados no estudo v2: expressões, ações, mãos e objetos relevantes; fundo sem função e recortes repetidos são evitados. Photon renderiza os quadrados propostos, e uma segunda chamada ao mesmo modelo revisa a foto original e os cortes efetivamente renderizados. A seleção valida os limites e restringe sobreposição entre quadros consecutivos, inclusive o último e o primeiro, a 25% da área do menor. Sem dois recortes aprovados, conserva-se a foto estática.

Fila, reserva e resultado são persistidos em R2 antes do gasto. O cache por fonte impede repetição paga mesmo quando a imagem aparece em vários artigos. São no máximo duas chamadas por fonte e quatro fotos simultâneas, com claims globais condicionais. Falhas e execuções incertas não são repetidas automaticamente. O teto é de 250 novas fontes por dia UTC, com reserva conservadora de até US$ 5/dia; valores do painel são estimativas calculadas a partir do uso confirmado. Interrupções podem ter custo adicional ainda não confirmado. Falhas de acesso, modelo ou limite da API pausam a fila.

`_internal/photo-ai-v3/state` contém somente o resumo administrativo; `articles/<id>.json` contém status e mapas por artigo, e `images/<fonte>.json` contém a análise reutilizável. Nenhum desses caminhos privados é servido pela rota pública de imagens. O leitor público acessa somente o mapa do artigo em um miss de cache.

O backfill captura uma lista fixa dos 30 artigos públicos mais recentes e inclui todas as fotos editoriais locais encontradas. Publicação/edição via API ou admin, migração de imagens e descoberta limitada pelo cron colocam as novas fotos na fila. O processamento é assíncrono; enquanto aguarda, a foto conserva o formato original. Antes de iniciar uma análise paga, a publicação do artigo é revalidada.

## Painel e receita

A aba mostra visualizações, sessões, distribuição, tempo médio de engajamento, taxa de engajamento, páginas por sessão e receita atribuída pelo Analytics. Filtros por aparelho e pelo experimento independente `ad_arm` ajudam a comparar condições equivalentes. Também mostra artigos/fotos, fila, fotos animáveis/estáticas, falhas e custo confirmado da IA.

O conector Google usa somente leitura, OAuth/PKCE e tokens criptografados no R2. GET administrativo apenas lê snapshots. A coleta automática é por hora, limitada a 28 dias e 5 mil linhas, com reserva global antes da tentativa; falhas preservam o último relatório válido. O botão de atualização verifica conexão e coleta; não refaz cortes.

O A/B pode iniciar antes da conexão monetária. Engajamento usa o período do experimento. Receita indisponível é nula, nunca zero inventado ou rateio proporcional dos acessos. O conector confirma vínculo e publisher AdSense na mesma propriedade; a receita só aparece para dias completos válidos após a preparação. Denominadores de receita por mil usam as mesmas datas da receita. Mudança/perda do vínculo esconde valores monetários incompatíveis, preservando engajamento. Compare receita dentro do grupo AdSense: receitas de outras redes fora do Analytics não são atribuídas por este painel.

Consentimento de leitura e eventual vínculo Google exigem ação autorizada; nenhum acesso Google é concedido automaticamente.

## Operação e verificação

Rotas existentes de API com chave Bearer protegem `/api/photo-ai/{status,backfill,run,start-test,report-status,sync-reports}`. Não há endpoints públicos de gasto. Início, pausa e retomada preservam a população e a data; não reiniciar o identificador durante o mesmo experimento.

Antes de publicar: `npm run check:deploy`, `wrangler deploy --dry-run`, revisão do diff e ancestralidade de `origin/main`. Não há migração D1. Rankings públicos continuam lendo snapshots, sem agregações de `pageviews_hourly` nos leitores. A escrita do cache conserva a versão lida antes do render para não recolocar mapas antigos em uma versão nova.

O pedido de 16/10/2026 autorizou implementar, publicar e iniciar este experimento, incluindo o backfill. O executor temporário de lançamento deve ser removido após a execução; a automação permanente pertence ao próprio Worker.
