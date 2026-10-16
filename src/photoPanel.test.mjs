import test from 'node:test';
import assert from 'node:assert/strict';
import {photoPanelBody} from './photoPanel.ts';
const base=()=>({config:{enabled:false,id:'photo-v1',startedAt:0,share:50},maps:{},reports:{configured:false,connected:false,snapshot:null,guard:null,readiness:null},adArm:'',device:''});
test('automatic panel removes manual crop workflow and enables start without monetization',()=>{
  const html=photoPanelBody(base());
  assert.match(html,/Enquadramento automático/);assert.doesNotMatch(html,/photo-map|photo-admin-preview|9e5335709590212c|Aprovar e salvar mapa|liberar o início/);
  assert.match(html,/<button type="submit">Iniciar teste 50% \/ 50%<\/button>/);
  assert.match(html,/href="\/admin\/teste-fotos"/);assert.match(html,/não mede.*retorno|não.*retenção de retorno/);
});
test('automatic panel displays persisted processing, coverage and bounded estimated cost with escaped errors',()=>{
  const data=base();data.ai={enabled:true,totalArticles:30,totalImages:81,queued:8,processing:1,ready:70,static:1,failed:1,estimatedCostUsd:.032,lastUpdated:Date.now(),error:'<script>bad</script>'};
  const html=photoPanelBody(data);assert.match(html,/30 artigos/);assert.match(html,/81 fotos/);assert.match(html,/70/);assert.match(html,/fila/);assert.match(html,/US\$|USD/);assert.match(html,/futuros/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>bad/);
});
test('distribution uses sessions and revenue uses only matched safe dates independently of engagement',()=>{
  const data=base();data.config.startedAt=1;data.reports.snapshot={generatedAt:Date.now(),start:'2026-10-02',end:'2026-10-15',currency:'USD',warnings:[],rows:[
    {date:'2026-10-02',variant:'static',adArm:'adsense',device:'mobile',views:100,sessions:10,engagedSessions:5,engagementSeconds:50,revenue:null},
    {date:'2026-10-15',variant:'static',adArm:'adsense',device:'mobile',views:50,sessions:5,engagedSessions:3,engagementSeconds:25,revenue:2},
    {date:'2026-10-15',variant:'motion',adArm:'adsense',device:'mobile',views:50,sessions:5,engagedSessions:3,engagementSeconds:25,revenue:1}
  ]};
  const html=photoPanelBody(data);assert.match(html,/Distribuição por sessões/);assert.match(html,/75%/);assert.match(html,/25%/);assert.match(html,/2026-10-15/);assert.match(html,/150/);assert.match(html,/US\$\s*2,00/);assert.doesNotMatch(html,/visitantes únicos|retenção comprovada/);
});

test('AI cost is unavailable before any analysis and preserves real zero after completed analysis',()=>{
  const data=base();data.ai={enabled:false,totalArticles:0,totalImages:0,queued:0,processing:0,ready:0,static:0,failed:0,estimatedCostUsd:0,lastUpdated:0};
  assert.match(photoPanelBody(data),/Custo estimado acumulado de análise \(uso confirmado\): —/);
  Object.assign(data.ai,{enabled:true,totalArticles:1,totalImages:2,queued:2,lastUpdated:Date.now()});
  assert.match(photoPanelBody(data),/Custo estimado acumulado de análise \(uso confirmado\): —/);
  Object.assign(data.ai,{queued:1,static:1});
  assert.match(photoPanelBody(data),/Custo estimado acumulado de análise \(uso confirmado\): US\$\s*0,0000/);
});
