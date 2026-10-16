# Cinco fotos antigas — detecção no navegador

Teste executado no Chrome em 16/10/2026, sem API paga e sem publicar. Código candidato: `public/photo-auto-focus.js`, reutilizando o detector local de rostos já presente no blog. Não está conectado ao experimento público: esta etapa avalia a qualidade antes da substituição definitiva do fluxo manual.

A amostra foi definida antes da detecção: posições 500, 600, 700, 800 e 900 do sitemap-1, primeira imagem do corpo de cada artigo. As cinco imagens são de 05 a 21/09/2026. URLs, títulos e datas estão em `scripts/photo-focus-samples.json`. Sem escolher fotos conforme o sucesso do detector, sem coordenadas fixas por imagem e sem retoques manuais nos cortes.

## Reprodução

Com Node 22+: `node scripts/photo-focus-lab.mjs`. Abrir `http://127.0.0.1:8766` e executar a detecção. O botão exporta PNG com a foto inteira, caixas de rosto detectado, caixas de corte aceito e cada recorte calculado. As coordenadas brutas ficam visíveis e copiáveis no painel de resultados.

A página usa exatamente `analyzePhotoFocus` / `selectPhotoFocus`, que podem ser usados pelo runtime futuro. Modelos servidos localmente: face-api.js 0.22.2, TinyFaceDetector 512, limiar 0.80 e 68 landmarks. Até oito imagens únicas, fila sequencial e cache de sucessos/falhas durante a página. Não usa câmera, identidade, API OpenAI, upload de fotos, telemetria ou banco.

A regra aceita até três rostos de primeiro plano (área >=45% do maior rosto); tenta margem 1.7, 1.5 e 1.3; descarta cortes que incluam outro rosto detectado ou não consigam preservar o rosto completo em até 60% da largura da fonte. Nenhum objeto ou relação narrativa é inferido. Um ponto só não autoriza uma animação repetitiva; zero ponto mantém a imagem inteira.

## Resultado observado

| Foto | Rostos detectados | Recortes aceitos |
|---|---:|---:|
| Lucas / busca por Enzo — 21/09 | 1 | 1 |
| Vanessa / Peixe e Gabriel — 17/09 | 2 | 2 |
| Iara expulsa Juarez — 14/09 | 0 | 0 |
| Adriana / joalheria — 10/09 | 1 | 1 |
| Juarez / desespero — 05/09 | 1 | 1 |

Quatro de cinco fontes tiveram um rosto localizado; somente uma gerou múltiplos planos. A terceira foto tem pessoas visíveis e o detector falhou. Na quarta, a pessoa do fundo não foi detectada. Celular (primeira), contato entre os personagens (segunda) e gestos (quinta) não viraram focos separados.

Primeira execução: carregamento/inicialização + análise da primeira foto 10.426 ms, demais 57–188 ms. Repetição com recursos/shaders aquecidos: 627 ms, 73 ms, 42 ms, 56 ms e 64 ms. Medidas de um único navegador, não garantia de desempenho em celular.

Conclusão: a abordagem funciona para enquadrar alguns rostos, mas esta amostra ainda não demonstra cobertura para montar a sequência desejada em qualquer imagem. O resultado justifica avaliar o reconhecimento local antes de assumir custo com uma API; não comprova entendimento das partes importantes da ação.

Validação: 188 testes + TypeScript passaram. Sem deploy; alterações ficam na branch `codex/photo-ab-retention-revenue`.
