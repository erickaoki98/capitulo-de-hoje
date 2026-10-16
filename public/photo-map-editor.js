const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const round=value=>Math.round(value*100000)/100000;
export function normalizeCrop({x,y,size}) {
  size=round(clamp(finite(size,.3),.1,1));
  return {x:round(clamp(finite(x,0),0,1-size)),y:round(clamp(finite(y,0),0,1-size)),size};
}
const validShot=shot=>shot&&[shot.x,shot.y,shot.size].every(Number.isFinite)&&shot.x>=0&&shot.y>=0&&shot.size>=.1&&shot.size<=1&&shot.x+shot.size<=1.000001&&shot.y+shot.size<=1.000001&&typeof shot.label==='string'&&shot.label.trim().length>0&&shot.label.length<=80;
const sourcePath=value=>/^\/img\/[a-zA-Z0-9_-]{1,120}\.(?:jpg|jpeg|png|webp)$/.test(value)?value:'';

export function initMapEditor(doc=document) {
  const form=doc.getElementById('photo-map-form');if(!form)return;
  const field=name=>form.querySelector(`[name=${name}]`);
  const source=field('source'),hidden=field('shots'),x=field('x'),y=field('y'),size=field('size');
  const image=doc.getElementById('photo-map-image'),stage=doc.getElementById('photo-map-stage'),box=doc.getElementById('photo-map-box'),label=doc.getElementById('photo-map-label'),list=doc.getElementById('photo-map-list'),add=doc.getElementById('photo-map-add');
  if(![source,hidden,x,y,size,image,stage,box,label,list,add].every(Boolean))return;
  let maps={};try{const text=doc.getElementById('photo-map-data')?.textContent||'{}';if(text.length<=262144)maps=JSON.parse(text)||{};}catch{}
  let shots=[],loaded='',ready=false;
  const crop=()=>normalizeCrop({x:x.value,y:y.value,size:size.value});
  const overlay=()=>{
    const next=crop();x.value=String(next.x);y.value=String(next.y);size.value=String(next.size);
    Object.assign(box.style,{left:`${next.x*100}%`,top:`${next.y*100}%`,width:`${next.size*100}%`,height:`${next.size*100}%`,display:ready?'block':'none',pointerEvents:'none'});
  };
  const render=()=>{
    hidden.value=JSON.stringify(shots);list.replaceChildren();add.disabled=shots.length>=6;
    shots.forEach((shot,index)=>{
      const item=doc.createElement('li'),text=doc.createElement('span'),remove=doc.createElement('button');text.textContent=`${index+1}. ${shot.label}`;remove.type='button';remove.textContent='Remover';remove.setAttribute('aria-label',`Remover recorte: ${shot.label}`);Object.assign(remove.style,{minWidth:'44px',minHeight:'44px',marginLeft:'8px'});remove.addEventListener('click',()=>{shots.splice(index,1);render();});item.append(text,remove);list.append(item);
    });
  };
  const invalid=(input,message)=>{input.setCustomValidity(message);input.reportValidity();};
  const load=()=>{
    const path=sourcePath(source.value.trim());source.setCustomValidity('');
    if(!path){invalid(source,'Use o caminho de uma imagem local, como /img/foto.jpg.');return;}
    source.value=path;loaded=path;ready=false;
    const saved=maps[path]?.shots;shots=Array.isArray(saved)&&saved.length>=2&&saved.length<=6&&saved.every(validShot)?saved.map(shot=>({...shot})):[];
    const initial=shots[0]||{x:.1,y:.1,size:.3};x.value=String(initial.x);y.value=String(initial.y);size.value=String(initial.size);label.value='';render();overlay();image.src=path;
  };
  image.addEventListener('load',()=>{ready=image.naturalWidth>0&&image.naturalWidth===image.naturalHeight;source.setCustomValidity(ready?'':'O mapa precisa de uma imagem quadrada carregada.');overlay();});
  image.addEventListener('error',()=>{ready=false;invalid(source,'Não foi possível carregar essa imagem.');overlay();});
  image.addEventListener('click',event=>{
    if(!ready)return;const bounds=image.getBoundingClientRect();if(!bounds.width||!bounds.height)return;const current=crop();x.value=String((event.clientX-bounds.left)/bounds.width-current.size/2);y.value=String((event.clientY-bounds.top)/bounds.height-current.size/2);overlay();
  });
  [x,y,size].forEach(input=>input.addEventListener('input',overlay));label.addEventListener('input',()=>label.setCustomValidity(''));
  source.addEventListener('input',()=>{ready=false;loaded='';shots=[];source.setCustomValidity('');render();overlay();});
  doc.getElementById('photo-map-load')?.addEventListener('click',load);
  add.addEventListener('click',()=>{
    if(!ready||loaded!==sourcePath(source.value.trim())){invalid(source,'Carregue uma imagem quadrada antes de adicionar recortes.');return;}
    const text=label.value.trim();if(!text||text.length>80){invalid(label,'Descreva o rosto, reação ou detalhe importante em até 80 caracteres.');return;}
    if(shots.length>=6)return;
    const next=crop();if(shots.some(shot=>shot.x===next.x&&shot.y===next.y&&shot.size===next.size)){invalid(label,'Esse enquadramento já foi adicionado. Mova o corte ou ajuste seu tamanho.');return;}
    source.setCustomValidity('');label.setCustomValidity('');shots.push({...next,label:text});label.value='';render();
  });
  form.addEventListener('submit',event=>{
    if(!ready||loaded!==sourcePath(source.value.trim())||shots.length<2||shots.length>6||!shots.every(validShot)){event.preventDefault();invalid(source,'Carregue a imagem e adicione de 2 a 6 recortes identificados antes de salvar.');return;}
    source.setCustomValidity('');hidden.value=JSON.stringify(shots);
  });
  load();
}
if(typeof document!=='undefined')initMapEditor();
