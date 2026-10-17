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


test('active first-day test distinguishes unavailable reports from zero traffic and partial animation coverage',()=>{
  const data=base();data.config={enabled:true,id:'photo-v1',startedAt:Date.parse('2026-10-16T20:49:20Z'),share:50};
  data.reports={...data.reports,configured:true,connected:true,timeZone:'America/Sao_Paulo',guard:{status:'ready',startedAt:Date.parse('2026-10-17T01:00:00Z')}};
  data.ai={enabled:true,totalArticles:53,totalImages:424,queued:250,processing:0,ready:22,static:151,failed:1,estimatedCostUsd:.3748,lastUpdated:Date.now(),error:'Teto diário de 250 fotos atingido; a fila continua no próximo dia, sem gasto extra.'};
  const html=photoPanelBody(data,undefined,Date.parse('2026-10-17T01:53:00Z'));
  assert.match(html,/Teste ativo com cobertura parcial/);assert.match(html,/22 de 424 fotos/);assert.match(html,/250 fotos aguardam/);
  assert.match(html,/Primeiro dia do teste ainda em andamento/);assert.match(html,/America\/Sao_Paulo/);assert.match(html,/ausência de relatório não significa ausência de acessos/);
  assert.doesNotMatch(html,/Ainda não há amostra|Métricas atualizadas/);
  const tomorrow=photoPanelBody(data,undefined,Date.parse('2026-10-17T04:00:00Z'));
  assert.doesNotMatch(tomorrow,/Primeiro dia do teste ainda em andamento/);assert.match(tomorrow,/Aguardando o relatório de dias encerrados/);
  data.config.enabled=false;assert.doesNotMatch(photoPanelBody(data),/Teste ativo com cobertura parcial/);
});

test('authorized traffic batch shows its own progress without pretending the daily queue is unlocked',()=>{
 const data=base();data.config.enabled=true;data.ai={enabled:true,totalArticles:177,totalImages:1397,queued:1000,processing:2,ready:200,static:194,failed:1,estimatedCostUsd:.5,lastUpdated:Date.now(),error:'Teto diário de 250 fotos atingido; a fila continua no próximo dia, sem gasto extra.'};
 data.trafficBatch={id:'traffic-test',day:'2026-10-17',status:'active',articles:177,images:1397,prepared:177,reserved:30,ready:200,static:194,failed:1,queued:1000,processing:2,expiresAt:Date.now()+3600000};
 const html=photoPanelBody(data);assert.match(html,/Lote dos artigos com visualizações/);assert.match(html,/177 artigos/);assert.match(html,/1.397 fotos/);assert.match(html,/lote adicional autorizado continua/);
 assert.doesNotMatch(html,/a fila continua no próximo dia, sem gasto extra/);
});
