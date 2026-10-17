# Lote autorizado de fotos dos artigos com tráfego

**Objetivo:** preparar as fotos dos 177 artigos públicos de 07/10 a 17/10 que receberam visualizações em 17/10/2026, priorizados pelo contador do blog (48.772 views no instante da seleção).

**Escopo:** 1.397 fontes únicas, Luna e composição luna-shoulders-v1 existentes, resultados concluídos reaproveitados. Manifesto privado fixo antes do gasto, expiração em seis horas e até uma reserva adicional por fonte selecionada (reserva conservadora máxima US$ 27,94; não é custo previsto). O teto diário normal de 250 permanece. Sem alterar credenciais, anúncios, conteúdo editorial, sorteio A/B ou identificador do experimento.

- [x] Testar escopo opcional em `runPhotoAI`: apenas ids e fontes autorizados, reserva específica antes da chamada, cache/erro persistente continua impedindo repetição.
- [x] Adicionar `src/photoAITraffic.ts` e testes: manifesto R2 validado, preparação idempotente em blocos de oito, reserva CAS por fonte e limite/expiração, conclusão persistida.
- [x] Expor somente rotas autenticadas `/api/photo-ai/traffic-{prepare,run,status}`; nenhuma criação de lote ou chamada de modelo em GET público/administrativo.
- [x] Verificar testes, TypeScript, dry-run, diff e ancestralidade; publicar no Worker capitulo-de-hoje pela branch codex/photo-ab-retention-revenue.
- [x] Concluir o manifesto privado único por meio do cron já existente do Worker, em até 24 chamadas por rodada, com quatro simultâneas por execução e no máximo uma nova rodada por minuto. O helper temporário foi removido; não há credencial nova nem dependência do chat para o lote continuar.
- [x] Confirmar resultado por artigo, fotos prontas/estáticas/falhas, custo confirmado e mapas servidos nas páginas públicas prioritárias; entregar lista para conferência.

A coleta foi administrativa e pontual: índice cobrindo bucket/path/count, intervalo de hoje no fuso de São Paulo, 14.144 linhas lidas e zero escritas; conteúdo dos ids selecionados exigiu 354 leituras e zero escritas. Não há nova agregação nos leitores públicos nem cron de descoberta por tráfego.

## Ajuste do executor durante a execução

A reserva global original serializava a preparação, mantendo somente uma ou duas análises efetivamente simultâneas. O lote adicional usa agora até doze partições fixas de ids, cada uma com lease exclusivo mantido até o fim da análise. A reivindicação CAS da fonte antecede a reserva de gasto nas partições, impedindo duplicidade mesmo em fotos compartilhadas. Só a conclusão de todas as partições encerra o lote. A fila normal mantém seu lease e teto originais. Testes confirmam doze artigos em paralelo, bloqueio de um segundo dono da mesma partição, reserva única de foto compartilhada e conclusão independente. Verificação: 243 testes, TypeScript e dry-run. Antes da publicação foi confirmado processamento zero para não interromper chamadas anteriores.


## Execução nativa final

O intermediário temporário foi removido após recorrência de timeout. O cron existente do blog passa a processar somente o manifesto ativo e não expirado, com uma reserva global por minuto e no máximo 24 chamadas por rodada, em seis ondas de até quatro. Cada partição e cada fonte mantêm seus próprios bloqueios. Sem lote ativo, o cron conserva o processador diário original de oito chamadas por execução e 250 fontes/dia. Não há nova coleta recorrente de tráfego nem nova seleção de artigos. Verificação: 244 testes, TypeScript e dry-run aprovados, incluindo limite de 24 chamadas/tick, bloqueio de tick duplicado e expiração. A ausência do helper é conferida após a publicação.

## Correção de conexões durante o lote

O primeiro executor nativo abriu doze análises em paralelo dentro da mesma invocação, concorrendo também com a migração de imagens. A leitura do corpo R2 ficava adiada até depois das reservas de estado. Isso produziu `Response closed due to connection limit`. O lote foi pausado com processamento zero antes da publicação da correção `f15f72a` (workflow `39060184556`, 248 testes, TypeScript e dry-run aprovados).

O corpo da imagem agora é consumido antes das reservas, ou cancelado quando excede o limite de tamanho. O processador de fotos aguarda ranking, relatórios e migração liberarem suas conexões; cada invocação abre até quatro tarefas de fotos, em seis ondas com relógio atualizado. Os doze leases de partição continuam impedindo donos simultâneos entre invocações. Um teste do cron real comprova que a descoberta de fotos espera as demais tarefas.

A recuperação é explícita e restrita ao erro exato de conexão com custo registrado zero: arquiva o cache anterior, recoloca somente essas fontes na fila e permite no máximo uma nova reserva por fonte, até cem fontes. Reservas originais e de recuperação juntas permanecem abaixo das 1.397 já autorizadas; não há aumento do teto total nem repetição de recusas ou falhas do modelo. Uma chamada interrompida pode ter custo ainda não confirmado. O helper temporário foi removido e sua ausência foi verificada.

## Resultado verificado em 17/10/2026, 16:59 (São Paulo)

O manifesto terminou `complete`, com as doze partições concluídas, zero fotos selecionadas na fila e zero em processamento. Os 177 artigos totalizam 1.397 fontes únicas: **304 animáveis, 1.076 estáticas e 17 falhas**. Há ao menos uma foto animável em 149 artigos; isso não equivale a exposição de todos os leitores, pois o grupo A mantém a original e o movimento também depende da foto visível e da preferência do sistema.

Foram reaproveitados 174 resultados e registradas 1.223 reservas originais novas, mais 49 reservas únicas de recuperação. As 1.272 reservas totais ficaram abaixo do teto original de 1.397. O custo acumulado estimado pelo uso retornado é US$ 1,2926; descontando a base anterior de US$ 0,3748, o adicional estimado do lote é **US$ 0,9178**. Chamadas interrompidas podem ter custo ainda não confirmado; não é conciliação da fatura.

O artigo mais visto (30829) serviu quatro mapas atuais; a primeira foto alternou efetivamente entre dois enquadramentos no Chrome. O artigo 30736, publicado em 11/10 e fora dos trinta ids iniciais, serviu um mapa com três quadros e teve a alternância de opacidade confirmada no navegador. Ambos usam `luna-shoulders-v1`. O A/B `photo-v1`, a divisão 50/50 e seu histórico foram preservados. A fila normal de publicações futuras permanece automática, com teto diário de 250 fontes.

A lista final por artigo e o resumo JSON foram exportados como artefatos locais da tarefa, com as visualizações do contador do blog no instante da seleção. Não há coleta recorrente por tráfego. A receita por versão continua indisponível enquanto o vínculo AdSense/Analytics não estiver confirmado; os relatórios de engajamento estão disponíveis, sem declaração de vencedor.

A conferência final das 17 falhas encontrou dez revisões visuais inválidas, quatro respostas JSON inválidas, duas execuções interrompidas sem repetição e uma recusa HTTP 400. Não restou nenhuma falha de limite de conexão. Todas conservam a foto original.
