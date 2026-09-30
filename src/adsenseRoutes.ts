import type { Env } from './types';
import { getSessionFromRequest } from './auth';
import { getSetting } from './db';
import { ADSENSE_SCOPE, AdSenseError, callbackUrl, digest, exchangeToken, isConfigured, randomToken, reportsView, saveConnection, seal, syncReports, unseal } from './adsenseReports.ts';
import type { ReportsView } from './adsenseReports.ts';

const PATH = '/admin/adsense';
const COOKIE = '__Secure-adsense-oauth';
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' };
const cookie = (value: string, age: number) => `${COOKIE}=${value}; Path=${PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const redirect = (location: string, extra: Record<string, string> = {}) => new Response(null, { status: 303, headers: { ...headers, Location: location, ...extra } });
interface OAuthState { nonce: string; verifier: string; session: string; expires: number }
export async function handleAdSenseRoute(request: Request, env: Env, authed: boolean, render: (view: ReportsView, message?: string) => string): Promise<Response> {
  if (!authed) return redirect('/admin');
  const url = new URL(request.url);
  const show = async (message?: string, status = 200) => new Response(render(await reportsView(env), message), { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  // Strict Origin check complements the admin cookie and protects all mutations.
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) return new Response('Origem inválida.', { status: 403, headers });
  if (url.pathname === PATH && request.method === 'GET') {
    const messages: Record<string, string> = { ready: 'Relatório atualizado.', limited: 'A próxima atualização estará disponível após o intervalo de uma hora.', error: 'Não foi possível atualizar. Confira o estado da conexão abaixo.', oauth_error: 'A conexão Google não foi concluída. Confirme a conta solicitada, a permissão de leitura e o Publisher ID em Monetização; depois tente reconectar.', connected: 'Conta conectada. O relatório será atualizado pelo agendamento automático.' };
    return show(messages[url.searchParams.get('status') ?? '']);
  }
  if (url.pathname === PATH + '/sync' && request.method === 'POST') {
    return redirect(`${PATH}?status=${await syncReports(env)}`);
  }
  if (url.pathname === PATH + '/connect' && request.method === 'POST') {
    if (!isConfigured(env)) return show('O cliente OAuth ainda precisa ser configurado no servidor.', 503);
    if (url.origin !== new URL(env.CANONICAL_URL!).origin) return show('Abra o painel no domínio principal para conectar a conta Google.', 400);
    const nonce = randomToken();
    const verifier = randomToken();
    const state: OAuthState = { nonce, verifier, session: await digest(getSessionFromRequest(request)!), expires: Date.now() + 10 * 60 * 1000 };
    const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    const params = { client_id: env.ADSENSE_CLIENT_ID!, redirect_uri: callbackUrl(env), response_type: 'code', scope: `openid email ${ADSENSE_SCOPE}`, access_type: 'offline', prompt: 'consent', login_hint: env.ADSENSE_GOOGLE_EMAIL!, state: nonce, code_challenge: await digest(verifier), code_challenge_method: 'S256' };
    Object.entries(params).forEach(([k, v]) => google.searchParams.set(k, v));
    return redirect(google.href, { 'Set-Cookie': cookie(await seal(env, 'oauth-state', state), 600) });
  }
  if (url.pathname === PATH + '/callback' && request.method === 'GET') {
    let response: Response;
    try {
      if (!isConfigured(env) || url.origin !== new URL(env.CANONICAL_URL!).origin) throw new AdSenseError('Abra o painel no domínio principal.');
      const raw = request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
      if (!raw) throw new AdSenseError('A conexão expirou. Inicie novamente pelo painel.');
      let state: OAuthState;
      try { state = await unseal<OAuthState>(env, 'oauth-state', raw); } catch { throw new AdSenseError('A conexão expirou. Inicie novamente pelo painel.'); }
      if (state.expires < Date.now() || state.nonce !== url.searchParams.get('state') || state.session !== await digest(getSessionFromRequest(request)!)) throw new AdSenseError('A conexão não corresponde à sessão administrativa atual.');
      if (url.searchParams.has('error')) throw new AdSenseError('A autorização Google não foi concluída. Você pode tentar novamente.');
      const code = url.searchParams.get('code');
      if (!code) throw new AdSenseError('O Google não retornou o código de autorização.');
      const token = await exchangeToken(env, { grant_type: 'authorization_code', code, redirect_uri: callbackUrl(env), code_verifier: state.verifier });
      if (!token.scope?.split(' ').includes(ADSENSE_SCOPE)) throw new AdSenseError('A permissão de leitura do AdSense não foi concedida.');
      await saveConnection(env, token, await getSetting(env.DB, 'adsense.publisher_id') ?? '');
      response = redirect(`${PATH}?status=connected`);
    } catch { response = redirect(`${PATH}?status=oauth_error`); }
    response.headers.set('Set-Cookie', cookie('', 0));
    return response;
  }
  return new Response('Not found', { status: 404, headers });
}
