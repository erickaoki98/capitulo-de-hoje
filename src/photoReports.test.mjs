import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal } from './adsenseReports.ts';
import * as api from './photoReports.ts';
const root = '_internal/photo-analytics-v1/';
const property = '450970542';
const scope = 'https://www.googleapis.com/auth/analytics.readonly';
const now = Date.parse('2026-10-16T12:00:00Z');
const config = {enabled:true,id:'photo-v1',startedAt:Date.parse('2026-10-02T14:00:00Z'),share:50};
function bucket() {
  let sequence=0; const objects=new Map();
  return {objects,async get(key){const item=objects.get(key);return item?{etag:item.etag,text:async()=>item.value,json:async()=>JSON.parse(item.value)}:null;},
    async put(key,value,opts){const old=objects.get(key);if(opts?.onlyIf?.etagMatches&&old?.etag!==opts.onlyIf.etagMatches)return null;if(opts?.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const item={etag:String(++sequence),value};objects.set(key,item);return {etag:item.etag};}};
}
function env(settings={}) {
  const values={'photo.experiment':JSON.stringify(config),'adsense.publisher_id':'ca-pub-9160979665550731',...settings};
  return {IMAGES:bucket(),SESSION_SECRET:'test-only-secret',ADSENSE_CLIENT_ID:'client',ADSENSE_CLIENT_SECRET:'secret',CANONICAL_URL:'https://capitulodehoje.com.br',DB:{prepare(sql){assert.match(sql,/SELECT key, value FROM settings WHERE key IN/);assert.ok(!sql.includes('pageviews'));return {bind(...keys){assert.ok(JSON.stringify(keys)===JSON.stringify(['photo.experiment','adsense.publisher_id'])||JSON.stringify(keys)===JSON.stringify(['adsense.publisher_id']));return {async all(){return {results:keys.filter(key=>values[key]!=null).map(key=>({key,value:values[key]}))};}};}};}}};
}
async function connected(e,ready=true){await e.IMAGES.put(root+'connection',await seal(e,root+'connection',{id:'conn-1',email:'private@example.com',refreshToken:'private-refresh',timeZone:'America/Sao_Paulo'}));if(ready)await e.IMAGES.put(root+'readiness',await seal(e,root+'readiness',{connectionId:'conn-1',checkedAt:now-3600000,revenueLinked:true,validFrom:config.startedAt-3*86400000,publisherId:'ca-pub-9160979665550731',revenueStatus:'verified'}));}
function rawReport(rows=[['20261015','static','adsense','mobile',100,10,6,120,1.5],['20261015','motion','nativo','desktop',50,5,4,100,0]]){
  return {dimensionHeaders:['date','customUser:photo_ab_v1','customUser:ad_arm','deviceCategory'].map(name=>({name})),metricHeaders:['screenPageViews','sessions','engagedSessions','userEngagementDuration','totalAdRevenue'].map(name=>({name})),rows:rows.map(r=>({dimensionValues:r.slice(0,4).map(value=>({value})),metricValues:r.slice(4).map(value=>({value:String(value)}))})),rowCount:rows.length,metadata:{currencyCode:'USD',timeZone:'America/Sao_Paulo'}};
}
function google({link=true,report=rawReport(),linkFail=false}={}) {
  return async(url,init)=>{
    const u=String(url);
    if(u.includes('/token')){assert.equal(new URLSearchParams(init.body).get('refresh_token'),'private-refresh');return Response.json({access_token:'access'});}
    if(u.includes('/adSenseLinks'))return linkFail?new Response('private error',{status:403}):Response.json({adsenseLinks:link?[{adClientCode:'ca-pub-9160979665550731'}]:[]});
    assert.match(u,/analyticsdata.googleapis.com\/v1beta\/properties\/450970542:runReport$/);assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'Bearer access');
    return Response.json(report);
  };
}
async function withFetch(fn,run){const previous=globalThis.fetch;globalThis.fetch=fn;try{return await run();}finally{globalThis.fetch=previous;}}

test('read-only Analytics module is available',()=>assert.equal(typeof api.syncPhotoReports,'function'));
test('period uses Analytics calendar, experiment start and 28-day ceiling',()=>{
  assert.deepEqual(api.photoReportPeriod('America/Sao_Paulo',config.startedAt,now),{start:'2026-10-02',end:'2026-10-15'});
  assert.deepEqual(api.photoReportPeriod('America/Sao_Paulo',Date.parse('2026-01-01'),now),{start:'2026-09-18',end:'2026-10-15'});
  assert.equal(api.photoReportPeriod('America/Sao_Paulo',now,now),null);
  assert.equal(api.photoReportPeriod('UTC',NaN,now),null);
});
test('query is bounded and uses only exact assigned variants and canonical hostname',()=>{
  const body=api.photoReportQuery('capitulodehoje.com.br',{start:'2026-10-02',end:'2026-10-15'});
  assert.equal(body.limit,5000);assert.equal(body.keepEmptyRows,false);
  assert.deepEqual(body.dateRanges,[{startDate:'2026-10-02',endDate:'2026-10-15'}]);
  assert.deepEqual(body.dimensions.map(v=>v.name),['date','customUser:photo_ab_v1','customUser:ad_arm','deviceCategory']);
  assert.deepEqual(body.metrics.map(v=>v.name),['screenPageViews','sessions','engagedSessions','userEngagementDuration','totalAdRevenue']);
  assert.deepEqual(body.dimensionFilter.andGroup.expressions,[{filter:{fieldName:'customUser:photo_ab_v1',inListFilter:{values:['static','motion'],caseSensitive:true}}},{filter:{fieldName:'hostName',stringFilter:{matchType:'EXACT',value:'capitulodehoje.com.br',caseSensitive:false}}}]);
  assert.equal('currencyCode' in body,false);assert.throws(()=>api.photoReportQuery('bad;host',{start:'x',end:'y'}));
});
test('missing link keeps revenue unavailable while verified true zero remains numeric',()=>{
  const period={start:'2026-10-02',end:'2026-10-15'};
  const absent=api.parsePhotoReport(rawReport(),period,false);assert.equal(absent.currency,'USD');assert.equal(absent.rows[0].revenue,null);assert.equal(absent.rows[0].views,100);
  const verified=api.parsePhotoReport(rawReport(),period,true);assert.equal(verified.rows[1].revenue,0);assert.equal(verified.rows[0].revenue,1.5);
  const noCurrency=rawReport();delete noCurrency.metadata.currencyCode;
  assert.throws(()=>api.parsePhotoReport(noCurrency,period,true),/moeda/);
});
test('reject partial, sampled, thresholded, other-row, invalid and out-of-window reports',()=>{
  const p={start:'2026-10-02',end:'2026-10-15'};
  for(const change of [{rowCount:3},{metadata:{currencyCode:'USD',samplingMetadatas:[{samplesReadCount:'1',samplingSpaceSize:'10'}]}},{metadata:{currencyCode:'USD',subjectToThresholding:true}},{metadata:{currencyCode:'USD',dataLossFromOtherRow:true}}])assert.throws(()=>api.parsePhotoReport({...rawReport(),...change},p,true),/parcial|amostr|limiar|outras|truncad/);
  for(const r of [['20261016','static','adsense','mobile',1,1,1,1,0],['20261015','unknown','adsense','mobile',1,1,1,1,0],['20261015','static','adsense','mobile',1,-1,1,1,0],['20261015','static','adsense','mobile','NaN',1,1,1,0]])assert.throws(()=>api.parsePhotoReport(rawReport([r]),p,true));
  assert.throws(()=>api.parsePhotoReport({...rawReport(),metricHeaders:[]},p,true),/formato/);
});
test('aggregate computes ratios from sums with optional ad arm and device filter',()=>{
  const rows=api.parsePhotoReport(rawReport([['20261014','static','adsense','mobile',10,2,1,20,1],['20261015','static','nativo','desktop',90,18,9,80,9],['20261015','motion','adsense','mobile',20,4,3,60,0]]),{start:'2026-10-02',end:'2026-10-15'},true).rows;
  const [s,m]=api.aggregatePhotoRows(rows);assert.equal(s.views,100);assert.equal(s.engagementRate,.5);assert.equal(s.engagementSecondsPerSession,5);assert.equal(s.rpmPer1000Views,100);assert.equal(s.revenuePer1000Sessions,500);assert.equal(m.revenue,0);
  const filtered=api.aggregatePhotoRows(rows,{adArm:'nativo',device:'desktop'});assert.equal(filtered[0].views,90);assert.equal(filtered[1].revenue,null);assert.equal(filtered[1].engagementRate,null);
  assert.equal(api.aggregatePhotoRows(rows.map(r=>({...r,revenue:null})))[0].revenue,null);
});
test('GET is storage-only, disconnected/unconfigured never calls Google and hides tokens',async()=>{
  await withFetch(()=>{throw Error('GET cannot call Google');},async()=>{
    const e=env();assert.equal((await api.photoReportsView(e)).connected,false);assert.equal(await api.syncPhotoReports(e,now),'not_connected');
    await connected(e);const view=await api.photoReportsView(e);assert.equal(view.email,'private@example.com');assert.equal(view.connected,true);assert.equal(view.timeZone,'America/Sao_Paulo');assert.ok(!JSON.stringify(view).includes('private-refresh'));
    const disabled={...e,ADSENSE_CLIENT_ID:undefined,IMAGES:{get(){throw Error('unconfigured must not read R2');}}};assert.equal((await api.photoReportsView(disabled)).configured,false);assert.equal(await api.syncPhotoReports(disabled,now),'not_connected');
  });
});
test('parallel sync reserves globally; failed sync keeps old snapshot and consumes manual+cron gaps',async()=>{
  const e=env();await connected(e);let calls=0;let failed=false;
  await withFetch(async(url,init)=>{calls++;if(failed&&String(url).includes(':runReport'))return new Response('secret data',{status:503});return google()(url,init);},async()=>{
    const results=await Promise.all(Array.from({length:30},()=>api.syncPhotoReports(e,now)));assert.equal(results.filter(v=>v==='ready').length,1);assert.equal(calls,3);
    const view=await api.photoReportsView(e);assert.equal(view.snapshot.rows[0].revenue,1.5);assert.equal(view.snapshot.testId,'photo-v1');assert.equal(view.snapshot.revenueLinked,true);assert.equal(calls,3);
    const previous=e.IMAGES.objects.get(root+'report').value;assert.ok(!previous.includes('1.5'));
    assert.equal(await api.syncPhotoReports(e,now+api.PHOTO_MANUAL_GAP-1,{manual:true}),'limited');
    failed=true;assert.equal(await api.syncPhotoReports(e,now+api.PHOTO_MANUAL_GAP,{manual:true}),'error');assert.equal(e.IMAGES.objects.get(root+'report').value,previous);
    assert.equal(await api.syncPhotoReports(e,now+api.PHOTO_MANUAL_GAP+1),'limited');assert.equal(await api.syncPhotoReports(e,now+api.PHOTO_MANUAL_GAP+1,{manual:true}),'limited');
    const stale=await api.photoReportsView(e);assert.equal(stale.guard.status,'error');assert.ok(stale.guard.error);assert.equal(stale.snapshot.generatedAt,now);assert.ok(!JSON.stringify(stale).includes('secret data'));
  });
});
test('missing, wrong-publisher, failed, or unconfigured revenue links yield null engagement report',async()=>{
  for(const [settings,opts,status] of [[{}, {link:false},'missing_link'],[{}, {linkFail:true},'link_unverified'],[{'adsense.publisher_id':''},{},'publisher_missing']]){
    const e=env(settings);await connected(e);
    await withFetch(google(opts),async()=>{assert.equal(await api.syncPhotoReports(e,now),'ready');const {snapshot}=await api.photoReportsView(e);assert.equal(snapshot.revenueLinked,false);assert.equal(snapshot.revenueStatus,status);assert.equal(snapshot.rows[0].revenue,null);assert.ok(snapshot.warnings.length);});
  }
});
test('never-started or brand-new experiment verifies readiness without requesting report data',async()=>{
  for(const c of [{...config,enabled:false,startedAt:0},{...config,startedAt:now}]){const e=env({'photo.experiment':JSON.stringify(c)});await connected(e);let calls=0;await withFetch(async(url,init)=>{calls++;assert.ok(!String(url).includes(':runReport'));return google()(url,init);},async()=>{assert.equal(await api.syncPhotoReports(e,now),'ready');assert.equal(calls,2);assert.equal((await api.photoReportsView(e)).readiness.checkedAt,now);});}
});
test('OAuth checks explicit Analytics scope, verified identity, property and matching web stream before storing own encrypted token',async()=>{
  const e=env();let user={email:'analytics@example.com',email_verified:true};let stream='https://capitulodehoje.com.br';let propertyName='properties/'+property;let calls=0;
  await withFetch(async(url)=>{calls++;const u=String(url);if(u.includes('userinfo'))return Response.json(user);if(u.includes('/dataStreams'))return Response.json({dataStreams:[{type:'WEB_DATA_STREAM',webStreamData:{defaultUri:stream}}]});return Response.json({name:propertyName,timeZone:'America/Sao_Paulo'});},async()=>{
    await assert.rejects(()=>api.savePhotoConnection(e,{access_token:'a',refresh_token:'r',scope:'openid email'}),/leitura|Analytics|permiss/);assert.equal(calls,0);
    user.email_verified=false;await assert.rejects(()=>api.savePhotoConnection(e,{access_token:'a',refresh_token:'r',scope}),/verificad/);user.email_verified=true;
    stream='https://another.example';await assert.rejects(()=>api.savePhotoConnection(e,{access_token:'a',refresh_token:'r',scope}),/domínio|fluxo/);stream='https://capitulodehoje.com.br';
    propertyName='properties/1';await assert.rejects(()=>api.savePhotoConnection(e,{access_token:'a',refresh_token:'r',scope}),/propriedade/);propertyName='properties/'+property;
    await assert.rejects(()=>api.savePhotoConnection(e,{access_token:'a',scope}),/contínuo|novamente/);
    await api.savePhotoConnection(e,{access_token:'a',refresh_token:'r',scope});const view=await api.photoReportsView(e);assert.equal(view.connected,true);assert.equal(view.email,'analytics@example.com');
    const stored=e.IMAGES.objects.get(root+'connection').value;assert.ok(!stored.includes('analytics@example.com'));const own=await unseal(e,root+'connection',stored);assert.equal(own.refreshToken,'r');assert.equal(e.IMAGES.objects.has('_internal/adsense-v1/connection'),false);
  });
});

test('GA protobuf empty report may omit zero rowCount; missing count with nonempty data is rejected',()=>{
  const empty=rawReport([]);delete empty.rowCount;
  assert.deepEqual(api.parsePhotoReport(empty,{start:'2026-10-02',end:'2026-10-15'},false).rows,[]);
  const partial=rawReport();delete partial.rowCount;
  assert.throws(()=>api.parsePhotoReport(partial,{start:'2026-10-02',end:'2026-10-15'},true),/parcial|truncad/);
});
test('changed Analytics timezone rejects sync rather than mislabelling stale calendar dates',async()=>{
  const e=env();await connected(e);const raw=rawReport();raw.metadata.timeZone='UTC';
  await withFetch(google({report:raw}),async()=>{
    assert.equal(await api.syncPhotoReports(e,now),'error');const view=await api.photoReportsView(e);assert.equal(view.snapshot,null);assert.match(view.guard.error,/fuso/);
  });
});
test('wrong publisher link never enables revenue and next link page remains explicitly unverified',async()=>{
  for(const [next,status] of [[undefined,'missing_link'],['page2','link_unverified']]){
    const e=env();await connected(e);let requests=0;
    await withFetch(async(url,init)=>{requests++;if(String(url).includes('/adSenseLinks'))return Response.json({adsenseLinks:[{adClientCode:'ca-pub-0000000000000000'}],nextPageToken:next});return google()(url,init);},async()=>{
      assert.equal(await api.syncPhotoReports(e,now),'ready');const {snapshot}=await api.photoReportsView(e);assert.equal(snapshot.revenueStatus,status);assert.equal(snapshot.rows[0].revenue,null);assert.equal(requests,3);
    });
  }
});
test('upstream report body stays bounded to configured experiment dates and no automatic fallback query',async()=>{
  const e=env();await connected(e);let body;let reports=0;
  await withFetch(async(url,init)=>{if(String(url).includes(':runReport')){body=JSON.parse(init.body);reports++;}return google()(url,init);},async()=>{
    assert.equal(await api.syncPhotoReports(e,now),'ready');assert.equal(reports,1);assert.deepEqual(body,api.photoReportQuery('capitulodehoje.com.br',{start:'2026-10-02',end:'2026-10-15'}));
  });
});
test('metadata truncation and hidden non-revenue metrics cannot become a complete report',()=>{
  const period={start:'2026-10-02',end:'2026-10-15'};
  const truncated=rawReport();truncated.metadata.dataTruncationReasons=[{dataTruncationType:'DATA_TRUNCATION_TYPE_DATE_RANGE'}];assert.throws(()=>api.parsePhotoReport(truncated,period,true),/truncad/);
  const restricted=rawReport();restricted.metadata.schemaRestrictionResponse={activeMetricRestrictions:[{metricName:'sessions',restrictedMetricTypes:['COST_DATA']}]};assert.throws(()=>api.parsePhotoReport(restricted,period,true),/restri/);
});
test('GA revenue role restriction stays null even with verified AdSense link; engagement remains available',async()=>{
  const raw=rawReport();raw.metadata.schemaRestrictionResponse={activeMetricRestrictions:[{metricName:'totalAdRevenue',restrictedMetricTypes:['REVENUE_DATA']}]};
  assert.equal(api.parsePhotoReport(raw,{start:'2026-10-02',end:'2026-10-15'},true).rows[0].revenue,null);
  const e=env();await connected(e);
  await withFetch(google({report:raw}),async()=>{
    assert.equal(await api.syncPhotoReports(e,now),'ready');const {snapshot,readiness}=await api.photoReportsView(e);assert.equal(readiness.revenueLinked,false);assert.equal(readiness.revenueStatus,'revenue_restricted');assert.equal(snapshot.revenueLinked,false);assert.equal(snapshot.revenueStatus,'revenue_restricted');assert.equal(snapshot.rows[0].views,100);assert.equal(snapshot.rows[0].revenue,null);assert.match(snapshot.warnings.join(' '),/permiss|restri/);
  });
});


test('first connection stores independently bound private publisher readiness without starting experiment',async()=>{
  const e=env({'photo.experiment':JSON.stringify({...config,enabled:false,startedAt:0})});
  await withFetch(async(url)=>{const u=String(url);if(u.includes('userinfo'))return Response.json({email:'ga@example.com',email_verified:true});if(u.includes('/dataStreams'))return Response.json({dataStreams:[{type:'WEB_DATA_STREAM',webStreamData:{defaultUri:e.CANONICAL_URL}}]});if(u.includes('/adSenseLinks'))return Response.json({adsenseLinks:[{adClientCode:'ca-pub-9160979665550731'}]});return Response.json({name:'properties/'+property,timeZone:'America/Sao_Paulo'});},async()=>{
    const before=Date.now();await api.savePhotoConnection(e,{access_token:'access',refresh_token:'own-ga-refresh',scope});const view=await api.photoReportsView(e);assert.equal(view.readiness.revenueLinked,true);assert.equal(view.readiness.publisherId,'ca-pub-9160979665550731');assert.ok(view.readiness.validFrom>=before);assert.equal(view.readiness.checkedAt,view.readiness.validFrom);assert.equal(view.snapshot,null);assert.ok(!JSON.stringify(view).includes('own-ga-refresh'));assert.ok(!e.IMAGES.objects.get(root+'readiness').value.includes('ca-pub'));
  });
});
test('readiness can be checked before first start and is bounded by the same reservation',async()=>{
  const e=env({'photo.experiment':JSON.stringify({...config,enabled:false,startedAt:0})});await connected(e,false);let calls=0;
  await withFetch(async(url,init)=>{calls++;assert.ok(!String(url).includes(':runReport'));return google()(url,init);},async()=>{
    assert.equal(await api.syncPhotoReports(e,now,{manual:true}),'ready');const view=await api.photoReportsView(e);assert.deepEqual(view.readiness,{checkedAt:now,revenueLinked:true,validFrom:now,publisherId:'ca-pub-9160979665550731',revenueStatus:'verified'});assert.equal(view.snapshot,null);assert.equal(await api.syncPhotoReports(e,now+1,{manual:true}),'limited');assert.equal(calls,2);
  });
});
test('newly verified link retains engagement since start and excludes only unsafe revenue dates',async()=>{
  const e=env();await connected(e,false);let query;
  await withFetch(async(url,init)=>{if(String(url).includes(':runReport'))query=JSON.parse(init.body);return google()(url,init);},async()=>{
    assert.equal(await api.syncPhotoReports(e,now),'ready');
    assert.deepEqual(query.dateRanges,[{startDate:'2026-10-02',endDate:'2026-10-15'}]);
    const {snapshot}=await api.photoReportsView(e);assert.equal(snapshot.rows[0].views,100);assert.equal(snapshot.rows[0].revenue,null);assert.equal(snapshot.revenueValidFrom,now);
  });
  const later=now+3*86400000;
  await withFetch(google({report:rawReport([['20261015','static','adsense','mobile',100,10,6,120,9],['20261018','static','adsense','mobile',50,5,3,60,2]])}),async()=>{
    assert.equal(await api.syncPhotoReports(e,later),'ready');const {snapshot}=await api.photoReportsView(e);
    assert.equal(snapshot.start,'2026-10-02');assert.equal(snapshot.rows[0].revenue,null);assert.equal(snapshot.rows[1].revenue,2);assert.match(snapshot.warnings.join(' '),/engajamento.*início|receita.*dias/i);
  });
});
test('temporary link verification failure preserves the safe monetary era without dropping engagement',async()=>{
  const e=env();await connected(e);let linkFail=false;let query;
  await withFetch(async(url,init)=>{if(String(url).includes(':runReport'))query=JSON.parse(init.body);return google({linkFail})(url,init);},async()=>{
    assert.equal(await api.syncPhotoReports(e,now),'ready');const initial=(await api.photoReportsView(e)).readiness.validFrom;
    linkFail=true;assert.equal(await api.syncPhotoReports(e,now+api.PHOTO_SYNC_INTERVAL),'ready');
    let view=await api.photoReportsView(e);assert.equal(view.readiness.revenueLinked,false);assert.equal(view.readiness.validFrom,initial);assert.equal(view.snapshot.rows[0].views,100);assert.equal(view.snapshot.rows[0].revenue,null);
    linkFail=false;assert.equal(await api.syncPhotoReports(e,now+2*api.PHOTO_SYNC_INTERVAL),'ready');
    view=await api.photoReportsView(e);assert.equal(view.readiness.validFrom,initial);assert.equal(view.snapshot.rows[0].revenue,1.5);assert.deepEqual(query.dateRanges,[{startDate:'2026-10-02',endDate:'2026-10-15'}]);
  });
});
test('lost link immediately hides cached money; recovered link starts a new safe revenue era',async()=>{
  const e=env();await connected(e);let linked=true;let query;
  await withFetch(async(url,init)=>{if(String(url).includes(':runReport'))query=JSON.parse(init.body);return google({link:linked})(url,init);},async()=>{
    assert.equal(await api.syncPhotoReports(e,now),'ready');assert.equal((await api.photoReportsView(e)).snapshot.rows[0].revenue,1.5);
    linked=false;const pausedConfig=JSON.stringify({...config,enabled:false});const originalPrepare=e.DB.prepare;e.DB.prepare=function(sql){const original=originalPrepare(sql);const bind=original.bind;original.bind=function(...keys){const q=bind.apply(this,keys);return {...q,async all(){const result=await q.all();result.results=result.results.map(r=>r.key==='photo.experiment'?{...r,value:pausedConfig}:r);return result;}};};return original;};
    assert.equal(await api.syncPhotoReports(e,now+api.PHOTO_SYNC_INTERVAL),'ready');let view=await api.photoReportsView(e);assert.equal(view.readiness.revenueLinked,false);assert.equal(view.snapshot.rows[0].revenue,null);assert.equal(view.snapshot.revenueLinked,false);
    linked=true;const recoveredAt=now+2*api.PHOTO_SYNC_INTERVAL;assert.equal(await api.syncPhotoReports(e,recoveredAt),'ready');view=await api.photoReportsView(e);assert.equal(view.readiness.validFrom,recoveredAt);assert.equal(view.snapshot.rows[0].revenue,null);assert.equal(view.snapshot.revenueLinked,true);
  });
});


test('pausing keeps fetching completed assigned days so final-day and delayed GA results are retained',async()=>{
  const e=env({'photo.experiment':JSON.stringify({...config,enabled:false})});await connected(e);let reports=0;let query;
  const afterPause=now+86400000;
  await withFetch(async(url,init)=>{if(String(url).includes(':runReport')){reports++;query=JSON.parse(init.body);}return google({report:rawReport([['20261016','static','adsense','mobile',120,12,8,180,2]])})(url,init);},async()=>{
    assert.equal(await api.syncPhotoReports(e,afterPause),'ready');assert.equal(reports,1);assert.equal(query.dateRanges[0].endDate,'2026-10-16');
    assert.deepEqual(query.dimensionFilter.andGroup.expressions[0].filter.inListFilter.values,['static','motion']);const {snapshot}=await api.photoReportsView(e);assert.equal(snapshot.generatedAt,afterPause);assert.equal(snapshot.rows[0].date,'2026-10-16');assert.equal(snapshot.rows[0].views,120);assert.equal(snapshot.rows[0].revenue,2);
  });
});

test('invalid report dimensions identify the failed field without exposing arbitrary values',()=>{
  const period={start:'2026-10-02',end:'2026-10-15'};
  for(const [variant,adArm,device,message] of [
    ['static','adsense','',/aparelho vazio/],
    ['(not set)','adsense','mobile',/variante sem atribuição/],
    ['private unexpected value','adsense','mobile',/variante desconhecida/],
    ['static','(other)','mobile',/outras linhas agrupadas/]
  ]){
    assert.throws(()=>api.parsePhotoReport(rawReport([['20261015',variant,adArm,device,1,1,1,1,0]]),period,false),message);
  }
});


test('missing ad assignment preserves valid photo cohorts and never guesses AdSense attribution',async()=>{
  const missing=rawReport([
    ['20261015','static','','mobile',100,10,6,90,0],
    ['20261015','static','(not set)','mobile',20,2,1,10,0],
    ['20261015','motion','','mobile',80,8,5,100,0],
    ['20261015','static','adsense','mobile',30,3,2,20,0]
  ]);
  delete missing.rows[2].dimensionValues[2].value; // Empty protobuf strings may omit value.
  const e=env();await connected(e);
  await withFetch(google({link:false,report:missing}),async()=>{
    assert.equal(await api.syncPhotoReports(e,now),'ready');
    const {snapshot,guard}=await api.photoReportsView(e);assert.equal(guard.status,'ready');
    assert.deepEqual(snapshot.rows.map(row=>row.adArm),['(not set)','(not set)','(not set)','adsense']);
    assert.ok(snapshot.warnings.some(w=>/Sem grupo de anúncios/.test(w)));
    const all=api.aggregatePhotoRows(snapshot.rows);assert.equal(all[0].views,150);assert.equal(all[1].views,80);
    const unknown=api.aggregatePhotoRows(snapshot.rows,{adArm:'(not set)'});assert.equal(unknown[0].sessions,12);assert.equal(unknown[1].sessions,8);
    const ads=api.aggregatePhotoRows(snapshot.rows,{adArm:'adsense'});assert.equal(ads[0].views,30);assert.equal(ads[1].views,0);assert.equal(ads[0].revenue,null);
  });
});
