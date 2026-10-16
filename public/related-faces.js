import { approvedFaces, faceCrop, faceSources } from './related-face-policy.js';

const MODEL_BASE = '/vendor/related-faces-v1';
let modelPromise;

function loadModels() {
  // A rejected promise is deliberately cached: a failed model never starts retries.
  return modelPromise ||= (async () => {
    await new Promise((resolve,reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); reject(Error('Face library timeout')); },8000);
      script.src = `${MODEL_BASE}/face-api.min.js`;
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); reject(Error('Face library unavailable')); };
      document.head.append(script);
    });
    const api = window.faceapi;
    // Fetch only the two local quantized models, with a real network abort.
    await Promise.all([
      ['tiny_face_detector_model',api.nets.tinyFaceDetector],
      ['face_landmark_68_tiny_model',api.nets.faceLandmark68TinyNet],
    ].map(async ([name,net]) => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(),8000);
      try {
        const manifestResponse = await fetch(`${MODEL_BASE}/${name}-weights_manifest.json`,{signal:controller.signal});
        if (!manifestResponse.ok) throw Error('Face manifest unavailable');
        const [manifest] = await manifestResponse.json();
        const response = await fetch(`${MODEL_BASE}/${name}-shard1`,{signal:controller.signal});
        if (!response.ok) throw Error('Face weights unavailable');
        net.loadFromWeightMap(api.tf.io.decodeWeights(await response.arrayBuffer(),manifest.weights));
      } finally { clearTimeout(timer); }
    }));
    return api;
  })();
}

export async function detectImage(src) {
  const api = await loadModels();
  const image = await new Promise((resolve,reject) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; reject(Error('Face image timeout')); },8000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(Error('Face image unavailable')); };
    img.src = src;
  });
  const results = await api.detectAllFaces(image,new api.TinyFaceDetectorOptions({inputSize:512,scoreThreshold:.8})).withFaceLandmarks(true);
  return {width:image.naturalWidth,height:image.naturalHeight,faces:results.map(result => ({
    score:result.detection.score,
    box:{x:result.detection.box.x,y:result.detection.box.y,width:result.detection.box.width,height:result.detection.box.height},
    landmarks:result.landmarks.positions.map(p => ({x:p.x,y:p.y})),
  }))};
}

// Display legacy HTTPS photos normally; inference remains restricted to managed /img URLs.
function displaySources(primary,alternatives,origin) {
  let extra = [];
  try { const parsed = JSON.parse(alternatives || '[]'); if (Array.isArray(parsed)) extra = parsed.slice(0,1); } catch {}
  return [...new Set([primary,...extra].flatMap(value => {
    if (typeof value !== 'string') return [];
    try {
      const url = new URL(value,origin);
      return !url.username && !url.password && (url.protocol === 'https:' || (url.origin === origin && /^\/img\/[a-zA-Z0-9/_.-]+$/.test(url.pathname))) ? [url.href] : [];
    } catch { return []; }
  }))].slice(0,2);
}

export function enhanceRelatedCards({doc=document,view=window,detect=detectImage} = {}) {
  const cards = [...doc.querySelectorAll('[data-related-card]')];
  if (!cards.length) return;
  const states = [], cache = new Map(), media = view.matchMedia('(prefers-reduced-motion: reduce)');
  let queue = Promise.resolve();
  const hide = card => { card.dataset.faceStatus = 'unavailable'; card.classList.add('section-rec--text-only'); };
  const sync = state => {
    if (state.timer) { view.clearInterval(state.timer); state.timer = null; }
    state.layers?.forEach(layer => { layer.style.transition = media.matches ? 'none' : 'opacity 240ms ease'; });
    if (!state.layers || state.layers.length < 2 || !state.visible || doc.hidden || media.matches || state.paused) return;
    state.timer = view.setInterval(() => {
      state.layers[state.index].style.opacity = '0';
      state.index = (state.index+1)%state.layers.length;
      state.layers[state.index].style.opacity = '1';
    },3500);
  };
  const fallback = state => {
    const {card,image,displaySources:sources,failed} = state;
    const src = sources.includes(image.src) && !failed.has(image.src) ? image.src : sources.find(url => !failed.has(url));
    if (state.layers) {
      state.layers.slice(1).forEach(layer => layer.remove());
      state.layers = null;
      Object.assign(image.style,{width:'',height:'',maxWidth:'',left:'',top:''});
    }
    state.pause?.remove(); state.pause = null;
    sync(state);
    if (!src) { hide(card); return; }
    card.classList.remove('section-rec--text-only');
    image.style.display = ''; image.style.opacity = '1'; delete image.dataset.broken;
    // Native image fallback is independent of the optional detector and never retries a failed URL.
    if (image.src !== src) image.src = src;
    card.dataset.faceStatus = 'fallback';
  };
  const layout = state => {
    if (!state.layers) return;
    const size = state.photo.getBoundingClientRect();
    if (!size.width || !size.height) return;
    state.layers.forEach((layer,i) => {
      const crop = faceCrop(state.faces[i],state.width,state.height,size.width,size.height);
      const scale = size.width/crop.width;
      Object.assign(layer.style,{width:`${state.width*scale}px`,height:`${state.height*scale}px`,maxWidth:'none',left:`${-crop.x*scale}px`,top:`${-crop.y*scale}px`});
    });
  };
  const resize = view.ResizeObserver ? new view.ResizeObserver(entries => entries.forEach(entry => { const state=states.find(s=>s.photo===entry.target); if(state)layout(state); })) : null;
  const process = async state => {
    const {card,photo,image} = state;
    try {
      for (const src of state.sources) {
        if (state.failed.has(src)) continue;
        if (!cache.has(src)) cache.set(src,detect(src).then(data => ({...data,faces:approvedFaces(data.faces,data.width,data.height)})).catch(() => null));
        const data = await cache.get(src);
        if (!data?.faces.length || state.failed.has(src)) continue;
        Object.assign(state,data,{index:0,layers:[]});
        data.faces.forEach((face,i) => {
          const layer = i === 0 ? image : image.cloneNode(false);
          layer.src = src; layer.alt = ''; layer.style.display = ''; delete layer.dataset.broken; layer.setAttribute('aria-hidden','true');
          layer.style.opacity = i === 0 ? '1' : '0';
          if (i) photo.append(layer);
          state.layers.push(layer);
        });
        layout(state); resize?.observe(photo);
        card.dataset.faceStatus = 'ready';
        if (data.faces.length > 1) {
          const pause = doc.createElement('button');
          pause.type = 'button'; pause.className = 'section-rec__pause';
          pause.textContent = 'Pausar alternância de rostos'; pause.setAttribute('aria-pressed','false');
          pause.addEventListener('click',() => {
            state.paused = !state.paused;
            pause.setAttribute('aria-pressed',String(state.paused));
            pause.textContent = state.paused ? 'Retomar alternância de rostos' : 'Pausar alternância de rostos';
            sync(state);
          });
          card.append(pause); state.pause = pause;
        }
        sync(state); return;
      }
    } catch {}
    fallback(state);
  };
  const near = view.IntersectionObserver ? new view.IntersectionObserver(entries => entries.forEach(entry => {
    const state = states.find(s => s.card === entry.target);
    if (!entry.isIntersecting || !state || state.requested) return;
    state.requested = true; state.card.dataset.faceStatus = 'loading'; near.unobserve(state.card);
    queue = queue.then(() => process(state));
  }),{rootMargin:'240px 0px'}) : null;
  const visible = view.IntersectionObserver ? new view.IntersectionObserver(entries => entries.forEach(entry => {
    const state = states.find(s => s.card === entry.target);
    if (state) { state.visible = entry.isIntersecting; sync(state); }
  }),{threshold:0}) : null;
  cards.forEach((card,i) => {
    const photo = card.querySelector('[data-face-photo]'), image = card.querySelector('.section-rec__image');
    if (!photo || !image) { hide(card); return; }
    const display = displaySources(image.src,photo.dataset.faceAlternatives,view.location.origin);
    const state = {card,photo,image,displaySources:display,sources:display.flatMap(src => faceSources(src,'[]',view.location.origin)),failed:new Set(),requested:false,visible:false,paused:false};
    image.addEventListener('error',() => { state.failed.add(image.src); fallback(state); });
    if (image.complete && image.naturalWidth === 0) state.failed.add(image.src);
    fallback(state);
    if (i >= 12 || !near || !state.sources.includes(image.src) || !state.sources.some(src => !state.failed.has(src))) return;
    states.push(state); card.dataset.faceStatus = 'pending'; near.observe(card); visible.observe(card);
  });
  doc.addEventListener('visibilitychange',() => states.forEach(sync));
  media.addEventListener('change',() => states.forEach(sync));
  if (!resize) view.addEventListener('resize',() => states.forEach(layout));
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') enhanceRelatedCards();
