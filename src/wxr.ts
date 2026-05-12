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
 * Parse principal: lê WXR, retorna posts publicados.
 */
export function parseWxr(xml: string): WxrPost[] {
  const items = extractItems(xml);

  // Primeiro passe: construir mapa de attachments (id → url)
  const attachments = new Map<string, string>();
  for (const itemBody of items) {
    const att = parseAttachment(itemBody);
    if (att) attachments.set(att.id, att.url);
  }

  // Segundo passe: processar posts
  const posts: WxrPost[] = [];
  for (const itemBody of items) {
    const postType = extractTag(itemBody, 'wp:post_type');
    if (postType !== 'post') continue; // só posts (não pages, attachments)

    const title = (extractTag(itemBody, 'title') ?? '').trim();
    const slug = (extractTag(itemBody, 'wp:post_name') ?? '').trim();
    const link = extractTag(itemBody, 'link') ?? '';
    const author = (extractTag(itemBody, 'dc:creator') ?? 'Erick Aoki').trim();
    const content = extractTag(itemBody, 'content:encoded') ?? '';
    const excerpt = (extractTag(itemBody, 'excerpt:encoded') ?? '').trim();
    const status = extractTag(itemBody, 'wp:status') ?? 'publish';

    // Data: wp:post_date é o mais confiável, formato: 2023-04-12 14:30:00
    const wpDate = extractTag(itemBody, 'wp:post_date_gmt') ?? extractTag(itemBody, 'wp:post_date');
    const pubDate = wpDate
      ? new Date(wpDate.replace(' ', 'T') + (wpDate.includes('T') ? '' : 'Z')).getTime()
      : Date.now();

    // Categories e tags
    const categoryTags = extractAllTags(itemBody, 'category');
    let category: string | null = null;
    const tags: string[] = [];
    for (const c of categoryTags) {
      if (c.attrs.domain === 'category' && !category) {
        category = c.content.trim();
      } else if (c.attrs.domain === 'post_tag') {
        tags.push(c.content.trim());
      }
    }

    // Featured image
    const thumbnailId = extractThumbnailId(itemBody);
    const heroImage = thumbnailId ? attachments.get(thumbnailId) ?? null : null;

    if (!title || !slug) continue; // skip items sem título ou slug

    posts.push({
      title,
      slug,
      link,
      pubDate: Number.isFinite(pubDate) ? pubDate : Date.now(),
      author,
      content,
      description: excerpt,
      status,
      postType,
      category,
      tags,
      heroImage,
      thumbnailId,
    });
  }

  return posts;
}
