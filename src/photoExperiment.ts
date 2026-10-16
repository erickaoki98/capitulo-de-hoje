export interface PhotoExperimentConfig {
  enabled: boolean;
  id: string;
  startedAt: number;
  share: number;
}

export function parsePhotoConfig(raw: string | null): PhotoExperimentConfig {
  let value: Record<string, unknown> = {};
  try { const parsed = JSON.parse(raw || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed; } catch {}
  const number = (v: unknown, fallback: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback;
  return {
    enabled: value.enabled === true,
    id: typeof value.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value.id) ? value.id : 'photo-v1',
    startedAt: Math.floor(number(value.startedAt, 0, 8.64e15)),
    share: Math.round(number(value.share, 50, 100)),
  };
}

/** Runs before the initial GA config, including on cached public HTML. */
export function renderPhotoBootstrap(config: PhotoExperimentConfig, eligible = true): string {
  const safe = parsePhotoConfig(JSON.stringify(config));
  return `<script>(function(){
var C=${JSON.stringify(safe)},eligible=${eligible === true},W=window,v='static',enrolled=false;
if(C.enabled)try{
  var key='cdh_photo_ab:'+C.id,u=localStorage.getItem(key);
  if(u===null||u===''||!isFinite(Number(u))||Number(u)<0||Number(u)>=1){
    if(!eligible)throw Error('Article enrollment only');
    var a=new Uint32Array(1);crypto.getRandomValues(a);u=String(a[0]/4294967296);
    localStorage.setItem(key,u);
  }
  if(localStorage.getItem(key)!==u)throw Error('Photo assignment unavailable');
  v=Number(u)*100<C.share?'motion':'static';enrolled=true;
}catch(e){}
W.cdhPhotoVariant=v;W.cdhPhotoExperiment={id:C.id,variant:v,enrolled:enrolled,startedAt:C.startedAt,share:C.share};
try{W.dataLayer=W.dataLayer||[];(function(){W.dataLayer.push(arguments);})('set','user_properties',{photo_ab_v1:enrolled?v:null});}catch(e){}
})();</script>`;
}

export function renderPhotoScript(config: PhotoExperimentConfig): string {
  if (!config.enabled) return '';
  return `<style>
.cdh-photo-motion{display:block;position:relative;overflow:hidden;aspect-ratio:1;width:100%;border-radius:8px;isolation:isolate}
.cdh-photo-motion>img.cdh-photo-original{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;opacity:0!important;pointer-events:none;animation:none!important;transform:none!important}
.cdh-photo-motion>img.cdh-photo-layer{position:absolute!important;max-width:none!important;max-height:none!important;min-height:0!important;margin:0!important;object-fit:fill!important;border-radius:0!important;animation:none!important;transform:none!important;pointer-events:none;transition:opacity 180ms ease}
.cdh-photo-pause{position:absolute;right:8px;bottom:8px;z-index:2;min-width:44px;min-height:44px;padding:8px 12px;border:1px solid #fff8;border-radius:8px;background:#151515e8;color:#fff;font:600 13px/1.3 system-ui;cursor:pointer}
.cdh-photo-pause:focus-visible{outline:3px solid #fff;outline-offset:-5px}
@media(prefers-reduced-motion:reduce){.cdh-photo-motion>img.cdh-photo-layer{transition:none}}
</style><script>if(window.cdhPhotoVariant==='motion'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){var s=document.createElement('script');s.type='module';s.src='/photo-motion.js?v=20261016-1';document.body.appendChild(s);}</script>`;
}
