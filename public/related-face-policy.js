// Reviewed pose gate: allow closed eyes and downward gaze; reject strong side profiles.
const mean = points => ({ x: points.reduce((n,p) => n+p.x,0)/points.length, y: points.reduce((n,p) => n+p.y,0)/points.length });
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));

export function approvedFaces(faces,width,height) {
  return faces.filter(face => {
    const b = face.box, p = face.landmarks;
    if (!b || !Array.isArray(p) || p.length !== 68 || ![b.x,b.y,b.width,b.height,face.score,width,height,...p.flatMap(v => [v.x,v.y])].every(Number.isFinite)) return false;
    if (face.score < .25 || b.width < 48 || b.height < 56 || b.width*b.height < width*height*.006 || b.x < 2 || b.y < 2 || b.x+b.width > width-2 || b.y+b.height > height-2) return false;
    if (p.some(v => v.x < 0 || v.y < 0 || v.x > width || v.y > height)) return false;
    const left = p.slice(36,42), right = p.slice(42,48), l = mean(left), r = mean(right);
    const gap = r.x-l.x, nose = p[30], mouth = mean([p[48],p[54]]);
    const lw = left[3].x-left[0].x, rw = right[3].x-right[0].x;
    // Looking down compresses eye spacing; closed eyes and a partly hidden mouth are allowed.
    const lookingDown = nose.y-(l.y+r.y)/2 > gap*.8 && Math.abs(nose.x-(l.x+r.x)/2) < gap*.25;
    return gap >= Math.max(18,b.width*(lookingDown ? .18 : .25)) && gap <= b.width*.65 &&
      Math.abs(l.y-r.y) < gap*.55 && lw > gap*.19 && rw > gap*.19 &&
      Math.min(lw,rw)/Math.max(lw,rw) > .5 &&
      Math.abs(nose.x-(l.x+r.x)/2) < gap*.4 && nose.y > Math.max(l.y,r.y)+gap*.05 &&
      nose.y < mouth.y+gap*.15 && mouth.y < b.y+b.height &&
      Math.abs(mouth.x-(l.x+r.x)/2) < gap*.6 && p[54].x-p[48].x > gap*.3;
  }).sort((a,b) => b.box.width*b.box.height-a.box.width*a.box.height).slice(0,4);
}

export function faceCrop(face,width,height,targetWidth,targetHeight) {
  const b = face.box, ratio = targetWidth/targetHeight;
  // All approved faces occupy the same fraction of the frame; edges clamp translation.
  const cropHeight = Math.min(Math.max(b.height*1.65,b.width*1.18/ratio),height,width/ratio);
  const cropWidth = cropHeight*ratio;
  return { x: clamp(b.x+b.width/2-cropWidth/2,0,width-cropWidth), y: clamp(b.y+b.height*.43-cropHeight/2,0,height-cropHeight), width: cropWidth, height: cropHeight };
}

// Use the widest frame that fills the card, anchored on a prominent detected character.
// ponytail: existing face boxes are only a subject hint; no extra body detector or inference.
export function contextCrop(faces,width,height,targetWidth,targetHeight) {
  const ratio = targetWidth/targetHeight;
  const cropHeight = Math.min(height,width/ratio), cropWidth = cropHeight*ratio;
  const prominent = faces.filter(face => {
    const b = face.box;
    return b && [face.score,b.x,b.y,b.width,b.height].every(Number.isFinite) &&
      face.score >= .25 && b.width >= 48 && b.height >= 56 && b.width*b.height >= width*height*.006 &&
      b.x >= 0 && b.y >= 0 && b.x+b.width <= width && b.y+b.height <= height;
  }).sort((a,b) => b.box.width*b.box.height*b.score-a.box.width*a.box.height*a.score)[0]?.box;
  return { x:clamp((prominent ? prominent.x+prominent.width/2 : width/2)-cropWidth/2,0,width-cropWidth),
    y:clamp((prominent ? prominent.y+prominent.height*.5 : height/2)-cropHeight/2,0,height-cropHeight),
    width:cropWidth,height:cropHeight };
}

export function faceSources(primary,alternatives,origin) {
  let extra = [];
  try { const parsed = JSON.parse(alternatives || '[]'); if (Array.isArray(parsed)) extra = parsed.slice(0,3); } catch {}
  return [...new Set([primary,...extra].flatMap(value => {
    if (typeof value !== 'string') return [];
    try { const url = new URL(value,origin); return url.origin === origin && /^\/img\/[^/]+\.(?:jpe?g|png|webp)$/i.test(url.pathname) ? [url.href] : []; } catch { return []; }
  }))].slice(0,2);
}
