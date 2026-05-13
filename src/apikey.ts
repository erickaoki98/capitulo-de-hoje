/**
 * Geração + hash de API keys.
 * Formato do token visível: `cdh_<base64url-32-bytes>`
 * Armazenamos no DB: prefix (8 chars) + sha-256 hex do token completo.
 */

export async function generateApiKey(): Promise<{ token: string; prefix: string; hash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const token = `cdh_${b64}`;
  const prefix = token.slice(0, 12); // 'cdh_xxxxxxxx'
  const hash = await sha256(token);
  return { token, prefix, hash };
}

export async function sha256(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
