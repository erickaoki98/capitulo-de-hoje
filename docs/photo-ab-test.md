# Teste de fotos — Capítulo de Hoje

**Alvo:** somente o blog `capitulodehoje.com.br`, Worker `capitulo-de-hoje`.
**Branch:** `codex/photo-ab-retention-revenue`, baseada em `origin/main` atualizado.

Plano de execução e verificação:

- [x] Identificação persistente 50/50 antes do primeiro config do GA; fotos do corpo com recortes fechados, trabalho limitado, sem APIs pagas. Preservar anúncios, hero, conteúdo e recomendações.
- [x] Conector Analytics somente leitura, com OAuth/PKCE e token criptografado no R2. Relatório limitado a 28 dias e 5 mil linhas; reserva global por hora, falha sem repetição rápida; GET só lê snapshot.
- [x] Painel autenticado `/admin/teste-fotos`: receita atribuída, receita por mil visualizações e sessões, tempo de engajamento e páginas por sessão, com filtros por aparelho e grupo dos anúncios.
- [x] Testes de comportamento antes das implementações; repetir `npm run check:deploy` e `wrangler deploy --dry-run` ao integrar. Conferir visualmente fotos e painel em celular e desktop.
- [ ] Revisar diff, registrar limitações da medição e solicitar a confirmação contextual de produção exigida por `AGENTS.md`. Não publicar checkout antigo nem migrar banco de produção.

O identificador de usuário no GA é `photo_ab_v1` (`static` ou `motion`), já registrado como dimensão de usuário na propriedade `450970542`. Foi criado um relatório preparatório no Analytics, mas o painel final fica no blog. Configuração do teste: chave `photo.experiment`, inicialmente desligada. Iniciar preserva a data na pausa/retomada; não reiniciar a população durante o mesmo teste.

Receita ausente é indisponível, não zero: o conector verifica o vínculo do publisher AdSense configurado. Não ratear a receita total pelos acessos e não reconstruir atribuição passada. A receita por mil usa visualizações do GA4, não o denominador próprio do AdSense. O teste existente `ad_arm` (`nativo` ou `adsense`) deve permanecer independente e ser considerado nos filtros.

O tempo de engajamento mede leitura em primeiro plano; animação automática não dispara eventos de engajamento nem eventos principais. A análise ainda não declara significância ou vencedor. Cortes não disponíveis, imagem não quadrada, mapa não aprovado, falha ou preferência por movimento reduzido mantêm a foto estática.

Conectar a conta Google ao leitor do painel e vincular AdSense/Analytics são ampliações de acesso que precisam de aprovação específica. Não conceder acessos nem aceitar novos escopos automaticamente.

Referências: [receita AdSense no GA4](https://support.google.com/analytics/answer/13610380), [Data API](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema), [leitura dos vínculos AdSense](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/properties.adSenseLinks/list).


## Mapeamento visual

A chave `photo.maps` guarda até 100 fotos locais com 2–6 cortes normalizados e data de revisão. O editor permite marcar rosto/reação/interação/detalhe, revisar e salvar. Não há reconhecimento de identidade nem inferência de importância por detector. Nenhuma chamada paga de IA foi adicionada. O exemplo aprovado usa dois planos fechados; ambiente sem ação relevante e testemunha ao fundo ficam fora.

Somente imagens editoriais mapeadas do corpo de um artigo podem inscrever novos navegadores. Links, anúncios, recomendações, comentários e conteúdo inerte ficam fora; máximo de oito fontes por artigo. O mapa é reutilizado, sem detecção em cada acesso. Mapas ficam bloqueados durante o teste; pausar permite revisão sem reiniciar grupos.

## Preparação da receita

O início exige conexão e vínculo do publisher verificados nas últimas duas horas, sem falha recente. A verificação funciona antes do início. Nenhum vínculo foi criado automaticamente: as contas abertas no navegador não tinham os acessos necessários para concluir a integração.

O período monetário começa no primeiro dia completo após a confirmação mais 24 horas de preparação da coleta; visualizações e sessões usam o mesmo período. Perda ou mudança do vínculo esconde a receita antiga. Receita bloqueada por permissão continua indisponível. O teste permanece desligado na publicação até que essas condições sejam atendidas.

## Validação

`npm run check:deploy` e `wrangler deploy --dry-run` passaram na integração; a conferência final deve ser repetida após qualquer reparo. Não é necessária migração D1. Prévia local usa o renderizador real do blog e uma foto pública, sem métricas fictícias. Publicação no Worker `capitulo-de-hoje` depende da confirmação contextual do AGENTS.md deste repositório.

Validação final após incorporar `origin/main` (`6664699`): 185 testes aprovados, TypeScript e dry-run aprovados. Painel conferido a 390 px e desktop; sem transbordamento horizontal após o ajuste. Publicação e consentimentos Google continuam pendentes.
