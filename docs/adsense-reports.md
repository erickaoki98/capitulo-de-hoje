# Relatórios AdSense no admin

Branch de implementação: `codex/adsense-admin`, baseada em `origin/main` `a9d7716` e conciliada com a proteção D1 `f06ab95` (cherry-pick `9ea8bf9`). Conciliada também com `origin/main` `d516b27` no merge `0e23491`. A pasta principal permanece intacta.

## Comportamento

`/admin/adsense` usa a autenticação administrativa existente. Mostra receita estimada, visualizações, impressões, cliques, RPM e CTR de página, gráfico e tabela por dia. Janela: 30 dias completos terminando ontem **no fuso da conta**. Moeda: aquela retornada pelo Google, sem conversão implícita para BRL. O filtro inclui somente `capitulodehoje.com.br` e `www.capitulodehoje.com.br`.

O cron existente e o botão de atualização usam a mesma reserva global condicional no R2: no máximo uma tentativa por hora, inclusive em falhas. Cada tentativa faz uma renovação OAuth e uma consulta de relatório limitada a 31 linhas (30 datas esperadas; truncamento é rejeitado). Abrir o painel não chama o Google. Não há novas consultas ao histórico D1; apenas a conexão inicial lê o Publisher ID nas configurações existentes.

O último snapshot válido é preservado em falhas. A tela distingue ausência de dados, ausência de conexão, falha de sincronização e dados com mais de duas horas. Nenhum dado demonstrativo é inserido em produção.

## Conexão

Confirmado pelo navegador: `sergiooaokii@gmail.com`, conta `pub-9160979665550731`. A API AdSense Management já está habilitada no projeto Google Cloud `studious-rhythm-502316-s5`. O cliente Web existente preserva o retorno `https://developers.google.com/oauthplayground` e agora inclui `https://capitulodehoje.com.br/admin/adsense/callback`, salvo após autorização explícita do usuário.

1. Após confirmação contextual para a alteração de acesso, adicionar ao cliente Web o retorno exato `https://capitulodehoje.com.br/admin/adsense/callback`, preservando os retornos existentes.
2. Configurar `ADSENSE_CLIENT_ID` e `ADSENSE_CLIENT_SECRET` como secrets no Worker correto `capitulo-de-hoje`. Nunca colocar o segredo no repositório, chat ou logs. Foi criado um cliente exclusivo para este painel após confirmação do usuário. Usar o JSON desse novo cliente, sem reutilizar os secrets do Hoje na Novela.
3. `ADSENSE_GOOGLE_EMAIL` já aponta para a conta solicitada na configuração do Worker. Conferir o Publisher ID existente em Monetização; a conexão verifica o acesso a essa conta e não altera o ID de veiculação.
4. Depois da publicação autorizada, abrir `/admin/adsense`, conectar e conceder `openid`, `email` e `adsense.readonly`. A identidade deve ser verificada e corresponder ao e-mail configurado. Acesso offline permite a atualização automática. A tela de consentimento Google deve permitir esse usuário; em modo de teste os tokens podem expirar em sete dias.
5. Verificar o primeiro relatório, período, moeda e domínio antes de considerar sincronização concluída.

Publicação e configuração dos secrets concluídas na conta correta. Consentimento Google e primeira sincronização real concluídos em 29/09/2026 às 23:03:44 (Brasília). Conta e publisher conferidos no painel; relatório de 30/08 a 28/09/2026, moeda USD, filtro exclusivo do domínio e www, 30 linhas diárias. Não usar a conta Megumi para este Worker.

## Segurança e armazenamento

OAuth usa state criptografado, cookie HttpOnly/Secure/SameSite=Lax de dez minutos vinculado à sessão administrativa, PKCE e validação de Origin nos POSTs. Callback sempre redireciona para uma URL sem código antes de renderizar HTML. Respostas privadas têm `no-store` e `no-referrer`; falhas Google não expõem tokens nem corpos de respostas.

Conexão e relatórios são criptografados com AES-GCM usando chave derivada de `SESSION_SECRET` via HKDF, com propósito autenticado distinto. Objetos: `_internal/adsense-v1/connection`, `report`, `guard` no R2 existente. O guard guarda apenas status, intervalo e erro sanitizado. A rota pública `/img/` rejeita chaves com barras. Rotacionar `SESSION_SECRET` exige reconectar e torna snapshots anteriores indecifráveis. Revogar o consentimento na conta Google interrompe renovação; o último snapshot permanece visível ao admin com alerta.

## Publicação

Requer confirmação contextual conforme `AGENTS.md`. Alvo: Worker `capitulo-de-hoje`, domínio `capitulodehoje.com.br`, bindings D1 `DB` e R2 `IMAGES` existentes. Nenhuma migration de produção é necessária. O escopo contém a integração e a proteção D1 que ainda não estava na main. Antes de publicar: `git fetch origin`, verificar ancestralidade de `origin/main`, `npm run check:deploy`, `npx wrangler deploy --dry-run`, revisar diff e confirmar conta Cloudflare. Não contornar o build guard.

Referências: [AdSense reports.generate](https://developers.google.com/adsense/management/reference/rest/v2/accounts.reports/generate), [métricas e dimensões](https://developers.google.com/adsense/management/metrics-dimensions), [OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server).

## Validação desta implementação

- 83 testes aprovados, incluindo OAuth/PKCE, identidade Google, CSRF, autenticação do Worker real, criptografia, concorrência, preservação de snapshots e proteção D1.
- `npm run check:deploy` e `npx wrangler deploy --dry-run` aprovados.
- Prévia visual inspecionada em desktop e em 390 px; largura do documento e viewport iguais (390 px), sem vazamento horizontal da tabela.
- `origin/main` verificada em `d516b27` e ancestral da branch publicada.
- `ads.txt` de produção confirma `pub-9160979665550731`.
- Publicado o commit `0e23491`, versão Cloudflare `5d70be15-eba8-45d7-aeb0-832c044d02e3`. Home respondeu HTTP 200; `/admin/adsense` sem sessão respondeu 303 para `/admin`, com `private, no-store`.

## Integração anterior localizada

O usuário indicou o projeto Hoje na Novela. A função `supabase/functions/finance-sync/index.ts` desse projeto já usa `GOOGLE_FIN_CLIENT_ID`, `GOOGLE_FIN_CLIENT_SECRET` e `GOOGLE_FIN_REFRESH_TOKEN` para AdSense. A listagem somente leitura de secrets confirmou os três nomes no projeto Supabase `nnptothmnscjpulwqwny`. Não foram encontrados nos `.env` / `.env.local` verificados e seus valores não foram exibidos nem transferidos. Não alterar a integração financeira existente para recuperar segredos.


## Cliente exclusivo criado após confirmação

Nome: `Capítulo de Hoje — Relatórios AdSense`.
Client ID: `787451618907-eqdvdlllqka6alkd20f8tsdg7k2k24tr.apps.googleusercontent.com`.
Projeto Google: `studious-rhythm-502316-s5`.
Retorno exclusivo: `https://capitulodehoje.com.br/admin/adsense/callback`.
O JSON foi baixado para Downloads, validado e protegido com permissão 0600. O segredo não está neste documento nem no Git. O cliente antigo permanece cadastrado; seus secrets e tokens no Supabase não foram alterados. A criação do cliente não equivale à emissão do refresh token: a autorização de leitura será concluída pelo painel após publicação.

Cloudflare confirmada visualmente: conta `d04e2d9ebb41c4e77234cfb98939f36d` (Contatoeaoki@gmail.com), com domínio `capitulodehoje.com.br` e Worker `capitulo-de-hoje`. Wrangler autenticado nessa conta após autorização explícita; ambos os secrets OAuth configurados e deploy concluído. Não usar a conta Megumi.

### Escopo exato proposto para publicação

Branch: `codex/adsense-admin`. Worker: `capitulo-de-hoje`, conta Cloudflare acima. Secrets a configurar: `ADSENSE_CLIENT_ID` e `ADSENSE_CLIENT_SECRET`, provenientes apenas do novo cliente. A confirmação deve abranger esses secrets e a publicação desta branch. Sem migrations no D1 e sem modificar secrets do Supabase.

- `AGENTS.md`
- `docs/adsense-reports.md`
- `docs/d1-cost-protection.md`
- `migrations/0007_d1_cost_guard.sql`
- `package.json`
- `src/adsenseReports.test.mjs`
- `src/adsenseReports.ts`
- `src/adsenseRoutes.test.mjs`
- `src/adsenseRoutes.ts`
- `src/adsenseWorker.test.mjs`
- `src/archive.test.mjs`
- `src/cache.ts`
- `src/index.ts`
- `src/publicRankingCache.test.mjs`
- `src/rankingSnapshot.test.mjs`
- `src/rankingSnapshot.ts`
- `src/render.ts`
- `src/types.ts`
- `src/workerSafety.test.mjs`
- `tsconfig.cost-guard.json`
- `wrangler.jsonc`

## Validação final em produção

Versão `bbf393b0-f9e2-4c1a-b437-7c8936ebb5a1`, commit `b77f5d8`, com `origin/main` `faec0cd` incorporada e 84 testes aprovados. Corrigida a política de referência da página HTML para `same-origin`, preservando o Origin dos formulários; redirects OAuth continuam `no-referrer`. O fluxo real de conexão e atualização manual terminou em `status=ready`. A próxima tentativa foi limitada a uma hora, como previsto. A branch permanece separada da main: futuras publicações devem incorporar esta integração e a proteção D1 para não removê-las novamente.
