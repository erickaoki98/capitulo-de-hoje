/**
 * Sistema de AdSense — config + placement.
 * Settings (em D1 settings table):
 *   adsense.publisher_id: 'ca-pub-XXX'  (sem o ca-pub- prefix opcional)
 *   adsense.auto_ads:     '1' ou '0'    (script de Auto Ads do Google)
 *   adsense.placements:   JSON          (regras de posicionamento manual)
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
 * Inclui Auto Ads se ativado.
 */
export function renderAdSenseScript(publisherId: string, autoAds: boolean): string {
  const id = publisherId.startsWith('ca-pub-') ? publisherId : `ca-pub-${publisherId}`;
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${escapeAttr(id)}" crossorigin="anonymous"></script>
${autoAds ? `<script>
(adsbygoogle = window.adsbygoogle || []).push({
  google_ad_client: "${escapeAttr(id)}",
  enable_page_level_ads: true
});
</script>` : ''}`;
}

/** Renderiza uma unidade de anúncio individual (display ad). */
export function renderAdUnit(
  publisherId: string,
  slotId: string,
  format: AdPlacementConfig['format'] = 'auto',
  layout?: string,
): string {
  const id = publisherId.startsWith('ca-pub-') ? publisherId : `ca-pub-${publisherId}`;
  const isInArticle = format === 'in-article';
  return `<ins class="adsbygoogle"
  style="display:block${isInArticle ? '; text-align:center' : ''}"
  data-ad-client="${escapeAttr(id)}"
  data-ad-slot="${escapeAttr(slotId)}"
  ${isInArticle ? 'data-ad-layout="in-article" data-ad-format="fluid"' : `data-ad-format="${escapeAttr(format ?? 'auto')}"`}
  ${layout ? `data-ad-layout="${escapeAttr(layout)}"` : ''}
  data-full-width-responsive="true"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`;
}

function escapeAttr(s: string): string {
  return String(s).replace(/[<>"'&]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;',
  }[c]!));
}

/**
 * Injeta unidades de anúncio "in-content" a cada N parágrafos no HTML do post.
 * Encontra `</p>` no top-level e injeta o ad depois.
 */
export function injectInContentAds(
  html: string,
  publisherId: string,
  slotId: string,
  format: AdPlacementConfig['format'],
  everyN: number,
): string {
  let count = 0;
  return html.replace(/<\/p>/gi, (match) => {
    count++;
    if (count % everyN === 0) {
      return match + `\n<div class="ad-inarticle">${renderAdUnit(publisherId, slotId, format)}</div>\n`;
    }
    return match;
  });
}
