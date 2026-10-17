# Lote autorizado de fotos dos artigos com tráfego

**Objetivo:** preparar as fotos dos 177 artigos públicos de 07/10 a 17/10 que receberam visualizações em 17/10/2026, priorizados pelo contador do blog (48.772 views no instante da seleção).

**Escopo:** 1.397 fontes únicas, Luna e composição luna-shoulders-v1 existentes, resultados concluídos reaproveitados. Manifesto privado fixo antes do gasto, expiração em seis horas e até uma reserva adicional por fonte selecionada (reserva conservadora máxima US$ 27,94; não é custo previsto). O teto diário normal de 250 permanece. Sem alterar credenciais, anúncios, conteúdo editorial, sorteio A/B ou identificador do experimento.

- [ ] Testar escopo opcional em `runPhotoAI`: apenas ids e fontes autorizados, reserva específica antes da chamada, cache/erro persistente continua impedindo repetição.
- [ ] Adicionar `src/photoAITraffic.ts` e testes: manifesto R2 validado, preparação idempotente em blocos de oito, reserva CAS por fonte e limite/expiração, conclusão persistida.
- [ ] Expor somente rotas autenticadas `/api/photo-ai/traffic-{prepare,run,status}`; nenhuma criação de lote ou chamada de modelo em GET público/administrativo.
- [ ] Verificar testes, TypeScript, dry-run, diff e ancestralidade; publicar no Worker capitulo-de-hoje pela branch codex/photo-ab-retention-revenue.
- [ ] Gravar um manifesto privado único para este pedido; executar através de helper temporário restrito e autenticado com a credencial já existente, até doze workers somente neste lote; a fila normal continua limitada a quatro. Remover o helper após o lote, inclusive se houver falhas.
- [ ] Confirmar resultado por artigo, fotos prontas/estáticas/falhas, custo confirmado e mapas servidos nas páginas públicas prioritárias; entregar lista para conferência.

A coleta foi administrativa e pontual: índice cobrindo bucket/path/count, intervalo de hoje no fuso de São Paulo, 14.144 linhas lidas e zero escritas; conteúdo dos ids selecionados exigiu 354 leituras e zero escritas. Não há nova agregação nos leitores públicos nem cron de descoberta por tráfego.

## Ajuste do executor durante a execução

A reserva global original serializava a preparação, mantendo somente uma ou duas análises efetivamente simultâneas. O lote adicional usa agora até doze partições fixas de ids, cada uma com lease exclusivo mantido até o fim da análise. A reivindicação CAS da fonte antecede a reserva de gasto nas partições, impedindo duplicidade mesmo em fotos compartilhadas. Só a conclusão de todas as partições encerra o lote. A fila normal mantém seu lease e teto originais. Testes confirmam doze artigos em paralelo, bloqueio de um segundo dono da mesma partição, reserva única de foto compartilhada e conclusão independente. Verificação: 243 testes, TypeScript e dry-run. Antes da publicação foi confirmado processamento zero para não interromper chamadas anteriores.
