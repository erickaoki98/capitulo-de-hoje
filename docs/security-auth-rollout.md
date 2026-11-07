# Ativação da autenticação revogável e das permissões de integração

Alvo: Worker `capitulo-de-hoje`, domínio `capitulodehoje.com.br`, D1 `capitulo-de-hoje` (binding `DB`). Este documento não autoriza alterações em produção.

## Pacotes separados

- O pacote de conteúdo seguro e chaves fora de URLs funciona com o banco atual. Seu namespace de cache HTML impede reutilizar páginas anteriores à sanitização; imagens mantêm o cache existente.
- O pacote de sessões, permissões, validade e limite de login depende exclusivamente de `migrations/0009_security_auth.sql`. Não publicar esse pacote antes da migration.

## Efeito para quem usa

- O primeiro deploy das sessões v2 exige que o administrador faça login novamente uma vez. Cookies antigos não são aceitos, pois não possuem registro que permita revogá-los.
- Logout apaga a sessão no servidor. Alterar `ADMIN_PASSWORD` invalida as sessões anteriores na próxima requisição. Nenhuma credencial é alterada pela migration ou pelo código.
- `SESSION_SECRET` permanece intacto: continua protegendo a conexão Google/AdSense já cifrada. Não rotacioná-lo para ativar esta melhoria.
- As chaves de integração existentes mantêm o token, as permissões atuais (`read,write`) e a ausência de expiração. Automações existentes continuam funcionando.
- Novas chaves permitem escolher somente leitura ou leitura e publicação, com validade de 30, 90 (padrão) ou 365 dias. A validade e as permissões aparecem no painel.
- O login admite dez tentativas por janela de quinze minutos por IP. O controle é atômico no D1 e armazena um HMAC do IP, não seu valor em texto. Um login bem-sucedido zera o contador daquele IP. Isso não substitui MFA nem proteção de borda contra ataques distribuídos.
- Conteúdo de artigos continua aceitando imagens, links, tabelas e formatação. Scripts, manipuladores de eventos, formulários, iframes, SVG e CSS arbitrários de artigos são descartados na renderização. Anúncios e scripts gerados pelo aplicativo continuam fora desse filtro.

## Sequência após autorização contextual de produção

1. Atualizar a referência remota e revisar todos os commits que serão publicados. Preservar as proteções de custo D1 e o build obrigatório.
2. Conferir o schema de `api_keys` e a existência das duas tabelas novas; registrar se a migration já foi aplicada. Não executar o `ALTER TABLE` novamente.
3. Aplicar **somente** `0009_security_auth.sql` no D1 indicado. Não executar um comando que aproveite todas as migrations pendentes. A migration adiciona `scopes` e `expires_at` a `api_keys`, cria `admin_sessions`, `admin_login_limits` e seus índices; não remove registros.
4. Publicar o Worker com o pacote de autenticação após a migration bem-sucedida. O Worker anterior ignora as novas colunas e tabelas, permitindo separar essas duas etapas.
5. Verificar login, logout, painel AdSense existente e uma integração existente. Criar uma chave de teste pelo painel, conferir a validade e a recusa de publicação com permissão somente leitura, e revogar essa chave ao terminar. Não criar artigos de teste públicos sem intenção editorial.
6. Não reverter para um Worker anterior às correções como resposta automática a uma falha: isso reabriria os problemas de conteúdo e de revogação. As adições de schema podem permanecer no banco; não removê-las para fazer rollback.

A limpeza de sessões/limites vencidos roda no cron existente com no máximo cem registros por tabela e usa índices. Não há DDL nem novas consultas de autenticação para leitores sem cookie administrativo.

## Validação local

`npm run check:deploy` executa a suíte completa e a verificação de tipos dos módulos protegidos. `wrangler deploy --dry-run` gera o bundle sem publicação. Testes com SQLite em memória cobrem migration aditiva, revogação, mudança de senha, limite concorrente, limpeza indexada/limitada, validade, permissões, segredo fora de URLs, XSS e metadados JSON. Nenhuma migration remota é executada por esses testes.
