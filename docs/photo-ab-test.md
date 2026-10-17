# Teste de fotos — Capítulo de Hoje

**Alvo:** `capitulodehoje.com.br`, Worker `capitulo-de-hoje`.
**Branch:** `codex/photo-ab-retention-revenue`, com `origin/main` incorporada.
**Painel:** `/admin/teste-fotos`, na navegação administrativa do blog.

## Experimento

Sorteio 50/50 persistido por navegador em `cdh_photo_ab:photo-v1`. Só uma foto editorial com mapa aprovado pode inscrever novos navegadores; depois, o grupo acompanha a navegação. O bootstrap define `photo_ab_v1` (`static` ou `motion`) antes da primeira configuração do GA. Essa dimensão de usuário já foi registrada na propriedade `450970542`.

O controle recebe a foto original; o tratamento recebe os recortes aprovados, com alternância a cada 2,4 segundos e a transição C (tremor + glitch) de 230 ms. Conforme ajuste solicitado em 16/10/2026, não há botão nem gesto de pausa na foto pública; alternância fora da tela ou com a aba oculta é suspensa automaticamente. Movimento reduzido, falha, formato não quadrado ou menos de dois recortes seguros preservam a imagem original. No celular (até 620 px), fotos estáticas e animadas do corpo ocupam a largura da tela; legendas continuam na coluna de leitura, com piso de 16 px. Hero, recomendações e anúncios conservam seu comportamento.

A análise segue a variante sorteada, inclusive quando uma preferência de acessibilidade ou uma foto sem mapa impede a animação. A divisão observada no painel usa sessões, não pessoas únicas. Engajamento e permanência são indicadores indiretos; o relatório não mede retorno de visitantes. Trocas automáticas não enviam eventos de engajamento. Não há declaração automática de vencedor ou significância estatística.

## Enquadramento automático

O Worker reutiliza sua `OPENAI_API_KEY` existente. As fotos editoriais locais do corpo são extraídas do HTML; anúncios, links e recomendações são excluídos. Não há editor manual no fluxo nem detecção paga em cada visita.

O GPT-6 Luna identifica até três assuntos com os prompts aprovados no estudo v2: expressões, ações, mãos e objetos relevantes; fundo sem função e recortes repetidos são evitados. Photon renderiza os quadrados propostos, e uma segunda chamada ao mesmo modelo revisa a foto original e os cortes efetivamente renderizados. A seleção valida os limites e restringe sobreposição entre quadros consecutivos, inclusive o último e o primeiro, a 25% da área do menor. Sem dois recortes aprovados, conserva-se a foto estática.

Fila, reserva e resultado são persistidos em R2 antes do gasto. O cache por fonte impede repetição paga mesmo quando a imagem aparece em vários artigos. São no máximo duas chamadas por fonte e quatro fotos simultâneas, com claims globais condicionais. Falhas e execuções incertas não são repetidas automaticamente. O teto é de 250 novas fontes por dia UTC, com reserva conservadora de até US$ 5/dia; valores do painel são estimativas calculadas a partir do uso confirmado. Interrupções podem ter custo adicional ainda não confirmado. Falhas de acesso, modelo ou limite da API pausam a fila.

`_internal/photo-ai-v3/state` contém somente o resumo administrativo; `articles/<id>.json` contém status e mapas por artigo, e `images/<composição>/<fonte>.json` contém a análise reutilizável por revisão. Os objetos legados sem composição continuam guardados para histórico. Nenhum desses caminhos privados é servido pela rota pública de imagens. O leitor público acessa somente o mapa do artigo em um miss de cache.

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

### Lançamento realizado em 16/10/2026

O PR [#5](https://github.com/erickaoki98/capitulo-de-hoje/pull/5) foi integrado em `main` e publicado pelo workflow oficial do Worker (execução `38964144740`). O A/B `photo-v1` iniciou pelo painel às **17:49:20, horário de São Paulo**, com divisão 50/50. Foram aprovados 224 testes, TypeScript e dry-run do Wrangler. A conferência na URL canônica de um artigo mostrou oito mapas e os dois comportamentos em navegadores distintos, incluindo a foto animada e seu controle de pausa.

Os 30 artigos e suas 240 fotos terminaram o processamento: **182 animáveis, 57 estáticas e uma falha de análise**, que conserva a imagem original sem repetir cobrança. Nenhuma foto ficou na fila ou em processamento. A estimativa acumulada do uso confirmado foi de **US$ 0,1780436**, sujeita à ressalva de chamadas interrompidas indicada no painel. O executor temporário foi removido e sua ausência foi confirmada; o processamento futuro permanece automático no Worker.

A conexão de leitura do Analytics foi autorizada. Depois da confirmação de identidade e consentimento, Google Analytics Admin API e Google Analytics Data API foram ativadas no projeto existente `studious-rhythm-502316-s5` (`787451618907`), com aprovação específica do usuário. Nenhuma chave, recurso pago ou conta de faturamento foi criada.

A reconexão inicialmente confirmou `oauth_access_denied`: a conta Sérgio não constava entre os usuários da propriedade `450970542`. Após autorização específica, foi concedido o papel **Leitor somente dessa propriedade**, sem notificação por e-mail. A reconexão OAuth com os escopos Analytics somente leitura, e-mail e OpenID foi concluída; o painel confirmou **Conectado** e a ação **Verificar conexão e atualizar** retornou **Métricas atualizadas**. A primeira coleta de resultados aguarda dias encerrados do experimento. Os números de análise das fotos acima não são resultados de engajamento ou receita.

A administração do Analytics confirmou que a propriedade ainda não tem vínculo com o AdSense. Para criá-lo, o Google exige edição na propriedade e administração do publisher. O usuário autorizou tornar Sérgio temporariamente Editor, vincular somente `pub-9160979665550731` e devolvê-lo a Leitor. Também autorizou e foi concluído “Desmarcar tudo e salvar” no aviso obrigatório de comunicados opcionais do Google. A sessão do administrador passou a carregar apenas a navegação, sem abrir o gerenciamento de acesso, inclusive após recarga, nova aba e uso da mesma conta na outra sessão do Chrome. Nenhuma ampliação para Editor ou vínculo foi salva; Sérgio permanece Leitor. A comparação monetária aguarda a recuperação dessa tela, conclusão do vínculo já autorizado e janela inicial de coleta. Os erros de consentimento distinguem APIs desativadas, acesso negado e autorização expirada, sem expor respostas Google ou credenciais.

### Ajuste mobile e retirada do controle de pausa

Solicitado e publicado em 16/10/2026: as fotos do corpo, tanto estáticas quanto animadas, ocupam a largura útil do celular; o botão de pausa e o gesto de clique para parar foram removidos do artigo. Permanecem suspensões automáticas para aba oculta, foto fora da tela, falhas e preferência do sistema por movimento reduzido. A conferência local em 320, 390, 768 e 1440 px confirmou dimensões iguais nas duas variantes, sem rolagem horizontal; texto a 200% preserva a largura e leitura. Na URL pública canônica mostrada pelo usuário, a foto mediu 375 px de largura útil, começando em x=0, com viewport de 390 px e sem botão. Verificação: 225 testes e TypeScript aprovados, dry-run e workflow oficial `38969486192` concluídos com sucesso (`8faf655`).

### Composição do ombro para cima aprovada em 16/10/2026

O usuário aprovou a prévia das dez fotos com retratos do ombro para cima. A composição `luna-shoulders-v1` usa a mesma regra testada: lado máximo de 1,65 vezes a altura da cabeça ou 1,6 vezes sua largura, margem superior de 8% e centro horizontal entre 34% e 66% do quadro. Sem espaço para centralizar, o candidato é descartado; menos de dois assuntos distintos mantém a original. A revisão visual do Luna exige pescoço e ombros, queixo com margem e ausência de fragmentos de outras cabeças. A ordenação cíclica continua limitando a sobreposição a 25%.

Os mapas legados não possuem as caixas semânticas da cabeça e não podem ser ampliados com precisão sem nova análise. A descoberta existente recoloca somente fotos anteriormente animáveis/em processamento na fila, uma vez por composição; fotos estáticas e falhas anteriores não geram novas tentativas por essa revisão. Além dos 30 artigos mais recentes, cada descoberta revisa no máximo oito artigos antigos que já eram acompanhados, sem nova varredura histórica e sem trocar os trinta ids originais. Os mapas antigos ficam fora do leitor público e o cache é invalidado uma vez ao iniciar a revisão. O custo anterior permanece no histórico e o custo da nova revisão é contabilizado separadamente, com o mesmo teto diário de 250 reservas, máximo de quatro análises simultâneas e oito fotos por cron.

O A/B conserva seu identificador, divisão e histórico. O período de troca da composição inclui fotos estáticas temporárias e deve ser tratado como transição ao interpretar resultados; a mudança de enquadramento não prova melhora de engajamento ou receita.

Publicação inicial confirmada pelo workflow oficial `38988534467` (`7398049`). O artigo `30816` passou a servir um mapa `luna-shoulders-v1` com três quadros; o artigo canônico mostrado pelo usuário deixou de servir mapas legados enquanto aguarda revisão. Verificação final: 230 testes e TypeScript, dry-run e paridade geométrica com todos os 19 candidatos da prévia aprovada. A conferência também corrigiu o aviso de orçamento do dia anterior: uma nova reserva diária válida remove somente esse aviso antigo, preservando outros erros e os limites de gasto.

### Diagnóstico do painel em 16/10/2026, 22:53 (São Paulo)

O A/B estava habilitado e a página pública do artigo 30816 confirmou troca real entre os quadros aprovados. A cobertura após a revisão era parcial: 22 fotos animáveis, 250 na fila, 151 estáticas e uma falha, entre 424 fotos de 53 artigos. A reserva de 250 análises do dia UTC 2026-10-17 já estava consumida; a próxima janela abre em 17/10 às 21h de São Paulo. O limite foi preservado, sem disparar novas chamadas de diagnóstico ou reiniciar o teste.

A tabela vazia ainda não era uma medição de zero acessos: não havia dia encerrado desde o início do experimento no fuso da propriedade. O painel agora separa teste ativo, cobertura das fotos, disponibilidade dos relatórios e vínculo de receita. Explica o primeiro dia e mostra a última verificação da conexão, sem chamá-la de métricas atualizadas quando não há relatório. O AdSense continua sem vínculo confirmado. Verificação da alteração: 231 testes, TypeScript e dry-run aprovados.

### Correção do primeiro relatório real em 17/10/2026

A primeira consulta de dias encerrados chegou ao Analytics, mas o parser rejeitou todo o relatório. A mensagem original juntava quatro condições distintas. A instrumentação limitada publicada em `030f056` confirmou a causa real: grupo de anúncios vazio, com variante de fotos válida. `ad_arm` só é definido pelo runtime do experimento de anúncios quando ele está ativo; ausência de atribuição desse experimento independente não invalida o A/B de fotos.

O parser agora conserva essas linhas como `(not set)` (“Sem grupo de anúncios”), inclusive strings vazias omitidas no protobuf. Não infere `adsense` ou `nativo`. As linhas entram na comparação geral de fotos e no filtro sem grupo, ficando fora de “Somente AdSense”. O relatório avisa essa condição. Continuam bloqueados variantes de foto desconhecidas/sem atribuição, linhas `(other)`, amostragem, truncamento, duplicatas brutas, datas e métricas inválidas. Teste de regressão de sincronização cobre persistência do relatório, totais preservados, filtros e receita nula sem vínculo. Verificação: 233 testes, TypeScript e dry-run aprovados.
