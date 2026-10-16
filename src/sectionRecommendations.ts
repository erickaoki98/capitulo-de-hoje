import { cleanTitle } from './articleTitle.ts';
import type { Post, PostCard } from './types';

type Candidate = Post | PostCard;
export const MAX_SECTION_CARDS = 12;
export const MAX_NEWS_AGE_MS = 72 * 3600_000;

/** Order is already the shared 24h ranking: never rerank by novela or query history here. */
export function selectSectionCandidates<T extends Candidate>(posts: T[], currentSlug: string, now = Date.now()): T[] {
  const seen = new Set([currentSlug]);
  return posts.filter(post => {
    if (!/^[a-z0-9-]+$/.test(post.slug) || seen.has(post.slug) || !post.title.trim()
      || ('draft' in post && post.draft) || !Number.isFinite(post.pub_date)
      || post.pub_date > now || now - post.pub_date > MAX_NEWS_AGE_MS) return false;
    seen.add(post.slug);
    return true;
  }).slice(0, MAX_SECTION_CARDS);
}

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]!);

function safeImage(value: string | null): string {
  if (!value) return '';
  if (/^\/img\/[a-zA-Z0-9/_.-]+(?:\?[^\s<>]*)?$/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function renderSectionCard(post: Candidate, position: number): string {
  const contentImages = 'content' in post
    ? [...post.content.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
      .map(match => safeImage(match[1])).filter(Boolean)
    : [];
  const image = safeImage(post.hero_image) || contentImages[0] || '';
  const novela = post.category?.trim();
  const caption = novela && novela !== 'Sem categoria' ? `<span class="section-rec__novela">${escape(novela)}</span>` : '';
  const alternate = contentImages.find(src => src !== image);
  const alternatives = alternate ? ` data-face-alternatives="${escape(JSON.stringify([alternate]))}"` : '';
  return `<aside class="section-rec${image ? '' : ' section-rec--text-only'}" data-related-card data-rec-position="${position}" aria-label="Notícias quentes do momento">
<a class="section-rec__link" href="/${escape(post.slug)}">
${image ? `<span class="section-rec__photo" data-face-photo${alternatives}><img class="section-rec__image" src="${escape(image)}" alt="" loading="lazy" decoding="async" width="1024" height="1024"></span>` : ''}
<span class="section-rec__copy"><span class="section-rec__eyebrow">Notícias quentes do momento</span><strong class="section-rec__title">${escape(cleanTitle(post.title, post.category))}</strong>${caption}</span>
</a></aside>`;
}

const TOKEN = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
function hasContent(html: string): boolean {
  const visible = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  return /<img\b/i.test(visible) || !!visible.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim();
}

/** Only top-level H2 ends are eligible. Raw text, nested quotes and figures stay intact. */
export function injectSectionRecommendations(html: string, posts: Candidate[], currentSlug: string, now = Date.now()) {
  const candidates = selectSectionCandidates(posts, currentSlug, now);
  const usedSlugs = new Set<string>();
  if (!candidates.length || !html.trim()) return { html, usedSlugs };
  const ends: number[] = [];
  const stack: string[] = [];
  let contentStart = -1;
  let hasSections = false;
  for (const token of html.matchAll(TOKEN)) {
    if (!token[1]) continue;
    const tag = token[1].toLowerCase();
    const closing = token[0][1] === '/';
    if (!closing && tag === 'h2' && stack.length === 0) {
      if (contentStart >= 0 && hasContent(html.slice(contentStart, token.index))) ends.push(token.index);
      hasSections = true;
    }
    if (closing) {
      const index = stack.lastIndexOf(tag);
      if (index >= 0) stack.length = index;
      if (tag === 'h2' && stack.length === 0) contentStart = token.index + token[0].length;
    } else if (!VOID.test(tag) && !token[0].endsWith('/>')) {
      stack.push(tag);
    }
  }
  if (hasSections ? contentStart >= 0 && hasContent(html.slice(contentStart)) : hasContent(html)) ends.push(html.length);
  let cursor = 0;
  let result = '';
  for (let i = 0; i < ends.length && i < candidates.length; i++) {
    const end = ends[i];
    result += html.slice(cursor, end) + '\n' + renderSectionCard(candidates[i], i + 1) + '\n';
    usedSlugs.add(candidates[i].slug);
    cursor = end;
  }
  return { html: result + html.slice(cursor), usedSlugs };
}
