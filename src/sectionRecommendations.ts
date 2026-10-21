import { cleanTitle } from './articleTitle.ts';
import { highlightCardTitle } from './titleHighlights.ts';
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
  const fallback = alternate ? ` data-fallback="${escape(alternate)}"` : '';
  return `<aside class="section-rec${image ? '' : ' section-rec--text-only'}" data-related-card data-rec-position="${position}" aria-label="Notícias quentes do momento">
<a class="section-rec__link" href="/${escape(post.slug)}">
${image ? `<span class="section-rec__photo"><img class="section-rec__image" src="${escape(image)}"${fallback} alt="" loading="lazy" decoding="async" width="1024" height="1024"></span>` : ''}
<span class="section-rec__copy"><span class="section-rec__eyebrow"><svg class="section-rec__flame" viewBox="0 0 32 40" width="18" height="24" aria-hidden="true" focusable="false"><path fill="#e54832" d="M18.2 1.4c.8 7.6-4.8 9.9-4.3 15.1-2.4-1.2-3.4-3.4-3-6.3C5.7 14.3 2 20.6 2 26.2 2 34.1 8.1 39 16 39s14-5.4 14-13c0-8.8-5.6-16.6-11.8-24.6Z"/><path fill="#ffad32" d="M18.3 16.8c.5 5.2-4.9 6.7-4.5 11.1-1.7-.7-2.5-2.2-2.2-4.3-2.4 2.5-3.8 5-3.8 7.7 0 4.5 3.7 7.7 8.3 7.7s8.2-3.2 8.2-7.7c0-5.8-3.3-10.8-6-14.5Z"/><path fill="#ffe9a8" d="M16.8 27.3c.2 3-2.8 3.8-2.8 6.2 0 2.4 1.4 4.1 3.5 4.1 2 0 3.5-1.6 3.5-3.8 0-2.7-2-4.9-4.2-6.5Z"/></svg><span>Notícias quentes do momento</span></span><strong class="section-rec__title">${highlightCardTitle(cleanTitle(post.title, post.category))}</strong>${caption}</span>
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
