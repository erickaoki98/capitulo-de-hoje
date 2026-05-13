// Parser para arquivo de export do WordPress (WXR format)
// Sem dependências externas, focado nos campos que importam.

export interface WxrPost {
  title: string;
  slug: string;
  link: string;
  pubDate: number;
  author: string;
  content: string;          // HTML
  description: string;      // excerpt
  status: string;           // 'publish', 'draft', etc.
  postType: string;         // 'post', 'page', 'attachment'
  category: string | null;  // primeira categoria (não tag)
  tags: string[];
  heroImage: string | null;
  thumbnailId: string | null;
}

/**
 * Decodifica entidades HTML/XML básicas.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&'); // amp DEVE ser por último
}

/**
 * Extrai o conteúdo de uma tag, removendo CDATA se houver.
 */
function extractTag(body: string, tag: string): string | null {
  // escapa nome de tag para regex (especialmente o ':')
  const escapedTag = tag.replace(/[:.]/g, '\\$&');
  const regex = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, 'i');
  const match = body.match(regex);
  if (!match) return null;
  let value = match[1];
  // remove CDATA wrapper se existir
  const cdataMatch = value.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdataMatch) value = cdataMatch[1];
  return decodeEntities(value);
}

/**
 * Extrai todas as ocorrências de uma tag (ex.: várias <category>).
 * Retorna pares { attrs, content }.
 */
function extractAllTags(
  body: string,
  tag: string,
): Array<{ attrs: Record<string, string>; content: string }> {
  const escapedTag = tag.replace(/[:.]/g, '\\$&');
  const regex = new RegExp(`<${escapedTag}((?:\\s[^>]*)?)>([\\s\\S]*?)<\\/${escapedTag}>`, 'gi');
  const results: Array<{ attrs: Record<string, string>; content: string }> = [];
  let match;
  while ((match = regex.exec(body)) !== null) {
    const attrs: Record<string, string> = {};
    const attrPart = match[1];
    if (attrPart) {
      const attrRegex = /(\w+)="([^"]*)"/g;
      let am;
      while ((am = attrRegex.exec(attrPart)) !== null) {
        attrs[am[1]] = am[2];
      }
    }
    let content = match[2];
    const cdataMatch = content.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
    if (cdataMatch) content = cdataMatch[1];
    results.push({ attrs, content: decodeEntities(content) });
  }
  return results;
}

/**
 * Quebra o XML em strings de `<item>...</item>`.
 */
function extractItems(xml: string): string[] {
  const items: string[] = [];
  const regex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    items.push(match[1]);
  }
  return items;
}

/**
 * Parse um item de attachment para extrair attachment_url.
 */
function parseAttachment(itemBody: string): { id: string; url: string } | null {
  const postType = extractTag(itemBody, 'wp:post_type');
  if (postType !== 'attachment') return null;
  const id = extractTag(itemBody, 'wp:post_id');
  const url = extractTag(itemBody, 'wp:attachment_url');
  if (!id || !url) return null;
  return { id, url };
}

/**
 * Extrai o _thumbnail_id dos postmeta.
 */
function extractThumbnailId(itemBody: string): string | null {
  const postmetas = extractAllTags(itemBody, 'wp:postmeta');
  for (const meta of postmetas) {
    const key = extractTag(meta.content, 'wp:meta_key');
    if (key === '_thumbnail_id') {
      return extractTag(meta.content, 'wp:meta_value');
    }
  }
  return null;
}

/**
 * Parse de um único item já isolado (uma string `<item>...</item>` sem as tags externas).
 * Resolve o thumbnail usando um mapa externo de attachments (id → url).
 */
function parseItem(itemBody: string, attachments: Map<string, string>): WxrPost | null {
  const postType = extractTag(itemBody, 'wp:post_type');
  if (postType !== 'post') return null;

  const title = (extractTag(itemBody, 'title') ?? '').trim();
  const slug = (extractTag(itemBody, 'wp:post_name') ?? '').trim();
  if (!title || !slug) return null;

  const link = extractTag(itemBody, 'link') ?? '';
  const author = (extractTag(itemBody, 'dc:creator') ?? 'Erick Aoki').trim();
  const content = extractTag(itemBody, 'content:encoded') ?? '';
  const excerpt = (extractTag(itemBody, 'excerpt:encoded') ?? '').trim();
  const status = extractTag(itemBody, 'wp:status') ?? 'publish';

  const wpDate = extractTag(itemBody, 'wp:post_date_gmt') ?? extractTag(itemBody, 'wp:post_date');
  const pubDateNum = wpDate
    ? new Date(wpDate.replace(' ', 'T') + (wpDate.includes('T') ? '' : 'Z')).getTime()
    : Date.now();
  const pubDate = Number.isFinite(pubDateNum) ? pubDateNum : Date.now();

  const categoryTags = extractAllTags(itemBody, 'category');
  let category: string | null = null;
  const tags: string[] = [];
  for (const c of categoryTags) {
    if (c.attrs.domain === 'category' && !category) category = c.content.trim();
    else if (c.attrs.domain === 'post_tag') tags.push(c.content.trim());
  }

  const thumbnailId = extractThumbnailId(itemBody);
  const heroImage = thumbnailId ? attachments.get(thumbnailId) ?? null : null;

  return {
    title, slug, link, pubDate, author, content,
    description: excerpt, status, postType, category, tags, heroImage, thumbnailId,
  };
}

/**
 * Parse não-streaming: lê WXR inteiro de uma string, retorna posts publicados.
 * Útil pra arquivos pequenos. Pra arquivos grandes, use streamWxr.
 */
export function parseWxr(xml: string): WxrPost[] {
  const items = extractItems(xml);

  const attachments = new Map<string, string>();
  for (const itemBody of items) {
    const att = parseAttachment(itemBody);
    if (att) attachments.set(att.id, att.url);
  }

  const posts: WxrPost[] = [];
  for (const itemBody of items) {
    const p = parseItem(itemBody, attachments);
    if (p) posts.push(p);
  }
  return posts;
}

/**
 * Parse incremental: extrai itens de um buffer de texto.
 * Retorna { items: corpos extraídos, remaining: texto que não terminou ainda }.
 */
function extractItemsFromBuffer(buffer: string): { items: string[]; remaining: string } {
  const items: string[] = [];
  let cursor = 0;
  while (true) {
    const start = buffer.indexOf('<item>', cursor);
    if (start === -1) break;
    const end = buffer.indexOf('</item>', start);
    if (end === -1) break; // item incompleto — guarda pro próximo chunk
    items.push(buffer.slice(start + 6, end));
    cursor = end + 7;
  }
  return { items, remaining: buffer.slice(cursor) };
}

/**
 * Parser streaming SINGLE-PASS. Lê o stream uma única vez:
 *   - Para cada <item>: se for attachment, salva no mapa.
 *     Se for post, parseia parcialmente (sem resolver thumbnail).
 *   - No final, resolve heroImage de cada post usando o mapa.
 *
 * Single-pass economiza CPU e subrequests (R2 lido 1x).
 */
export async function streamWxrCollect(
  stream: ReadableStream<Uint8Array>,
): Promise<WxrPost[]> {
  const attachments = new Map<string, string>();
  const posts: WxrPost[] = [];

  await processStream(stream, (itemBody) => {
    // Fast path: olha o post_type sem parsear o item inteiro
    const typeMatch = itemBody.match(/<wp:post_type(?:\s[^>]*)?>(?:<!\[CDATA\[)?([^<\]]+)(?:\]\]>)?<\/wp:post_type>/);
    const postType = typeMatch ? typeMatch[1].trim() : null;

    if (postType === 'attachment') {
      const att = parseAttachment(itemBody);
      if (att) attachments.set(att.id, att.url);
    } else if (postType === 'post') {
      const p = parseItem(itemBody, attachments);
      if (p) posts.push(p);
    }
    // outros tipos (page, nav_menu_item, revision, etc.) são ignorados
  });

  // Pós-processamento: para posts cujo thumbnail_id veio depois do attachment,
  // o heroImage já foi resolvido em parseItem. Para posts cujo attachment veio
  // depois, precisamos re-resolver agora.
  for (const p of posts) {
    if (!p.heroImage && p.thumbnailId) {
      const url = attachments.get(p.thumbnailId);
      if (url) p.heroImage = url;
    }
  }

  return posts;
}

/**
 * Lê um ReadableStream completo, mantém buffer e chama callback pra cada
 * `<item>...</item>` encontrado. Não acumula itens — economia de memória.
 */
async function processStream(
  stream: ReadableStream<Uint8Array>,
  onItem: (itemBody: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // flush último decode
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const { items, remaining } = extractItemsFromBuffer(buffer);
      for (const it of items) onItem(it);
      buffer = remaining;
      // sanity check: se buffer crescer absurdamente sem fechar item, aborta
      if (buffer.length > 100 * 1024 * 1024) {
        throw new Error('Item XML maior que 100MB — arquivo possivelmente corrompido');
      }
    }
    // último flush
    const final = extractItemsFromBuffer(buffer);
    for (const it of final.items) onItem(it);
  } finally {
    reader.releaseLock();
  }
}
