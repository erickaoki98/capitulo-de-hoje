/**
 * Sistema de AdSense — config + placement.
 * Settings (em D1 settings table):
 *   adsense.publisher_id: 'ca-pub-XXX'  (sem o ca-pub- prefix opcional)
 *   adsense.auto_ads:     '1' ou '0'    (script de Auto Ads do Google)
 *   adsense.placements:   JSON          (regras de posicionamento manual)
 *
 * Ref: https://support.google.com/adsense/answer/9274019
 *      https://support.google.com/adsense/answer/9261306
 */

export interface AdPlacementConfig {
  /** Slot ID do AdSense pra esse placement */
  slotId?: string;
  /** Habilitado */
  enabled: boolean;
  /** Formato de unidade: 'auto' (responsive) | 'fluid' | 'banner' | 'rectangle' | 'in-article' */
  format?: 'auto' | 'fluid' | 'banner' | 'rectangle' | 'in-article';
}

export interface AdConfig {
  /** Antes do título do post */
  beforePost: AdPlacementConfig;
  /** Logo após o título, antes do conteúdo */
  topOfContent: AdPlacementConfig;
  /** A cada N parágrafos do post */
  inContent: AdPlacementConfig & { everyNParagraphs?: number };
  /** Depois do conteúdo, antes dos related */
  afterContent: AdPlacementConfig;
  /** No final da página, depois dos related */
  bottomOfPage: AdPlacementConfig;
  /** Entre cards da home, a cada N */
  betweenCards: AdPlacementConfig & { everyNCards?: number };
  /** Sticky no rodapé mobile */
  stickyFooter: AdPlacementConfig;
}

export const DEFAULT_AD_CONFIG: AdConfig = {
  beforePost:    { enabled: false, format: 'auto' },
  topOfContent:  { enabled: true,  format: 'auto' },
  inContent:     { enabled: true,  format: 'in-article', everyNParagraphs: 4 },
  afterContent:  { enabled: true,  format: 'auto' },
  bottomOfPage:  { enabled: false, format: 'auto' },
  betweenCards:  { enabled: true,  format: 'auto', everyNCards: 6 },
  stickyFooter:  { enabled: false, format: 'fluid' },
};

export function parseAdConfig(raw: string | null): AdConfig {
  if (!raw) return DEFAULT_AD_CONFIG;
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_AD_CONFIG, ...parsed };
  } catch {
    return DEFAULT_AD_CONFIG;
  }
}

/**
 * Renderiza a tag <script async> do AdSense (header).
 * Conforme documentação atual do Google, o Auto Ads é ativado
 * apenas pelo parâmetro ?client= na URL do script — o antigo
 * `enable_page_level_ads` foi descontinuado.
 *
 * Consent Mode v2 com consentimento concedido por padrão. No Brasil (LGPD)
 * não há exigência de opt-in prévio para cookies de anúncio como na UE/GDPR,
 * então os anúncios já carregam PERSONALIZADOS (RPM cheio) no primeiro acesso,
 * sem depender do usuário interagir com o aviso de cookies.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ ⚠️  NÃO ALTERAR o consent abaixo para 'denied' — vale p/ humanos e IAs. │
 * │ Este é um site BRASILEIRO: a LGPD não exige opt-in prévio de cookies.   │
 * │ 'denied' faz o Google servir anúncios NÃO-PERSONALIZADOS e derruba o    │
 * │ RPM. Manter SEMPRE 'granted'. (Se um dia houver tráfego relevante da    │
 * │ União Europeia, aí sim seria preciso um CMP certificado — não é o caso.)│
 * └───────────────────────────────────────────────────────────────────────┘
 */
export function renderAdSenseScript(publisherId: string, autoAds: boolean): string {
  const id = publisherId.startsWith('ca-pub-') ? publisherId : `ca-pub-${publisherId}`;
  // ⚠️ Consent SEMPRE 'granted' (site BR / LGPD). NUNCA mudar para 'denied'.
  return `<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  'ad_storage': 'granted',
  'ad_user_data': 'granted',
  'ad_personalization': 'granted',
  'analytics_storage': 'granted'
});
</script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${escapeAttr(id)}" crossorigin="anonymous"></script>`;
}

/**
 * Renderiza uma unidade de anúncio individual (display ad).
 * Usa lazy loading nativo para ads abaixo do fold (melhor Core Web Vitals).
 */
export function renderAdUnit(
  publisherId: string,
  slotId: string,
  format: AdPlacementConfig['format'] = 'auto',
  layout?: string,
  lazy = true,
): string {
  const id = publisherId.startsWith('ca-pub-') ? publisherId : `ca-pub-${publisherId}`;
  const isInArticle = format === 'in-article';
  return `<ins class="adsbygoogle"
  style="display:block${isInArticle ? '; text-align:center' : ''}"
  data-ad-client="${escapeAttr(id)}"
  data-ad-slot="${escapeAttr(slotId)}"
  ${isInArticle ? 'data-ad-layout="in-article" data-ad-format="fluid"' : `data-ad-format="${escapeAttr(format ?? 'auto')}"`}
  ${layout ? `data-ad-layout="${escapeAttr(layout)}"` : ''}
  data-full-width-responsive="true"${lazy ? '\n  loading="lazy"' : ''}></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`;
}

function escapeAttr(s: string): string {
  return String(s).replace(/[<>"'&]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;',
  }[c]!));
}

/**
 * Injeta unidades de anúncio "in-content" a cada N parágrafos no HTML do post.
 * Conta apenas `</p>` top-level (ignora parágrafos dentro de blockquote, figure, etc.)
 * para não posicionar ads em locais estranhos.
 * Nunca injeta se o conteúdo total tiver menos de everyN*2 parágrafos
 * (evita excesso de ads em conteúdos curtos — política Google).
 */
export function injectInContentAds(
  html: string,
  publisherId: string,
  slotId: string,
  format: AdPlacementConfig['format'],
  everyN: number,
): string {
  // Separa o HTML em tokens: tags de abertura/fechamento de blocos + conteúdo
  // para rastrear profundidade e contar apenas </p> de nível 0.
  const BLOCK_TAGS = /^(blockquote|figure|table|ul|ol|details|aside|div|nav|section|header|footer)$/i;
  let depth = 0;
  let topLevelPCount = 0;

  // Primeira passagem: conta parágrafos top-level pra decidir se vale injetar
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let m: RegExpExecArray | null;
  const tempHtml = html;
  while ((m = tagRe.exec(tempHtml)) !== null) {
    const [full, tag] = m;
    if (BLOCK_TAGS.test(tag)) {
      if (full[1] === '/') depth = Math.max(0, depth - 1);
      else if (!full.endsWith('/>')) depth++;
    }
    if (depth === 0 && full.toLowerCase() === '</p>') topLevelPCount++;
  }

  // Muito pouco conteúdo — não injeta (evita ad density excessivo)
  if (topLevelPCount < everyN * 2) return html;

  // Segunda passagem: injeta ads nos pontos certos
  depth = 0;
  let count = 0;
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (full, tag) => {
    if (BLOCK_TAGS.test(tag)) {
      if (full[1] === '/') depth = Math.max(0, depth - 1);
      else if (!full.endsWith('/>')) depth++;
    }
    if (depth === 0 && full.toLowerCase() === '</p>') {
      count++;
      if (count % everyN === 0 && count < topLevelPCount) {
        return full + `\n<div class="ad-inarticle">${renderAdUnit(publisherId, slotId, format)}</div>\n`;
      }
    }
    return full;
  });
}

/**
 * Gera a linha ads.txt necessária para o publisher.
 * Formato IAB Tech Lab: google.com, pub-XXXX, DIRECT, f08c47fec0942fa0
 */
export function renderAdsTxt(publisherId: string): string {
  const pubNum = publisherId.replace('ca-pub-', '').replace('pub-', '');
  return `google.com, pub-${pubNum}, DIRECT, f08c47fec0942fa0\n`;
}
