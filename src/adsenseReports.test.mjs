import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, SYNC_INTERVAL, MANUAL_GAP, BREAKDOWN_METRICS, UNIT_DIMENSIONS, FORMAT_DIMENSIONS, parseReport, parseBreakdown, breakdownUrl, pageRpm, nextDayIn, reportPeriod, reportUrl, seal, unseal, reportsView, saveConnection, syncReports } from './adsenseReports.ts';

const root = '_internal/adsense-v1/';
const account = 'accounts/pub-9160979665550731';
const now = Date.parse('2026-09-30T01:00:00Z');
function rawReport() {
  return { headers: [{ name: 'DATE' }, ...METRICS.map(name => ({ name, ...(name === 'ESTIMATED_EARNINGS' || name === 'PAGE_VIEWS_RPM' ? { currencyCode: 'USD' } : {}) }))], rows: [{ cells: ['2026-09-28','12.5','1000','2200','25','12.5','0.025'].map(value => ({value})) }], totals: { cells: ['','12.5','1000','2200','25','12.5','0.025'].map(value => ({value})) }, totalMatchedRows: '1' };
}
function rawBreakdown(dims, rows) {
  return { headers: [...dims.map(name => ({ name })), ...BREAKDOWN_METRICS.map(name => ({ name }))], rows: rows.map(cells => ({ cells: cells.map(value => ({ value: String(value) })) })) };
}
const unitRows = [['Meio-do-artigo', 'ca-pub-9160979665550731:4047668207', 1285.87, 7751856, 0.17, 0.4863, 46314]];
const formatRows = [['Âncora', 'Anúncios automáticos', 1775.08, 1844465, 0.96, 0.9146, 77593]];
/** Mock do Google: relatório diário ou quebra, conforme as dimensões pedidas na URL. */
function google(url) {
  const u = String(url);
  if (u.includes('AD_UNIT_NAME')) return Response.json(rawBreakdown(UNIT_DIMENSIONS, unitRows));
  if (u.includes('AD_FORMAT_NAME')) return Response.json(rawBreakdown(FORMAT_DIMENSIONS, formatRows));
  return Response.json(rawReport());
}
function bucket() {
  let sequence = 0;
  const objects = new Map();
  return { objects,
    async get(key) { const item = objects.get(key); return item ? { etag: item.etag, text: async () => item.value, json: async () => JSON.parse(item.value) } : null; },
    async put(key, value, opts) {
      const old = objects.get(key);
      if (opts?.onlyIf?.etagMatches && old?.etag !== opts.onlyIf.etagMatches) return null;
      if (opts?.onlyIf?.etagDoesNotMatch === '*' && old) return null;
      const item = { etag: String(++sequence), value }; objects.set(key, item); return { etag: item.etag };
    },
  };
}
function env() { return { IMAGES: bucket(), SESSION_SECRET: 'test-only-secret', ADSENSE_CLIENT_ID: 'test-client', ADSENSE_CLIENT_SECRET: 'test-secret', ADSENSE_GOOGLE_EMAIL: 'expected@example.com', CANONICAL_URL: 'https://capitulodehoje.com.br', DB: {prepare(){throw Error('No D1 queries allowed');}} }; }
async function connected(e) { await e.IMAGES.put(root+'connection', await seal(e, root+'connection', { id: 'connection-1', email: 'expected@example.com', account, timeZone:'America/Sao_Paulo', refreshToken:'private-refresh' })); }

test('period uses account calendar across UTC midnight and leap year', () => {
  assert.deepEqual(reportPeriod('America/Sao_Paulo', now), {start:'2026-08-30',end:'2026-09-28'});
  assert.deepEqual(reportPeriod('UTC', Date.parse('2024-03-01T00:00:00Z')), {start:'2024-01-31',end:'2024-02-29'});
});
test('Google request is bounded and filtered to the site, preserving account currency', () => {
  const url = new URL(reportUrl(account, 'capitulodehoje.com.br', reportPeriod('UTC', now)));
  assert.equal(url.searchParams.get('limit'), '31');
  assert.equal(url.searchParams.get('filters'), 'DOMAIN_CODE==capitulodehoje.com.br,DOMAIN_CODE==www.capitulodehoje.com.br');
  assert.equal(url.searchParams.get('reportingTimeZone'),'ACCOUNT_TIME_ZONE');
  assert.deepEqual(url.searchParams.getAll('metrics'), METRICS);
  assert.equal(url.searchParams.has('currencyCode'),false);
  assert.throws(() => reportUrl('../foo','evil;domain',reportPeriod('UTC', now)));
});
test('uses Google totals and ratio units, rejects malformed and truncated reports', () => {
  const raw=rawReport();
  assert.equal(parseReport(raw).totals[5],0.025);
  assert.equal(parseReport(raw).currency,'USD');
  assert.throws(()=>parseReport({...raw,totalMatchedRows:'40'}),/truncado/);
  const invalid=rawReport(); invalid.rows[0].cells[1].value='NaN'; assert.throws(()=>parseReport(invalid),/inválida/);
  assert.throws(()=>parseReport({...raw,headers:[]}),/formato/);
  assert.throws(()=>parseReport({...raw,totals:undefined}),/totais/);
  assert.deepEqual(parseReport({...raw, rows:undefined,totals:undefined,totalMatchedRows:'0'}).totals, [0,0,0,0,0,0]);
});
test('encrypted storage hides credentials and rejects tampering, another key and purpose', async()=>{
  const e=env(); const sealed=await seal(e,'connection',{refreshToken:'super-secret'});
  assert.ok(!sealed.includes('super-secret'));
  assert.deepEqual(await unseal(e,'connection',sealed),{refreshToken:'super-secret'});
  await assert.rejects(()=>unseal(e,'report',sealed));
  await assert.rejects(()=>unseal({...e,SESSION_SECRET:'other'},'connection',sealed));
  await assert.rejects(()=>unseal(e,'connection','bad.'+sealed.split('.')[1]));
});
test('50 concurrent syncs make one Google report request; GET is read-only; failures preserve snapshot and consume reservation', async()=>{
  const e=env(); await connected(e); const oldFetch=globalThis.fetch; let calls=0; let fail=false;
  globalThis.fetch=async(url,init)=>{
    calls++;
    if (String(url).includes('/token')) { assert.equal(new URLSearchParams(init.body).get('refresh_token'),'private-refresh'); return Response.json({access_token:'private-access'}); }
    if(fail) return new Response('private error details',{status:403});
    return google(url);
  };
  try {
    const results=await Promise.all(Array.from({length:50},()=>syncReports(e,now)));
    assert.equal(results.filter(v=>v==='ready').length,1);
    assert.equal(calls,4); // 1 token + relatório diário + 2 quebras, de UMA sincronização só
    const view=await reportsView(e); assert.equal(view.snapshot.totals[0],12.5); assert.equal(calls,4);
    assert.equal(view.snapshot.byUnit[0].keys[0],'Meio-do-artigo'); assert.equal(view.snapshot.byFormat[0].values[2],0.96);
    assert.ok(!JSON.stringify(view).includes('private-refresh'));
    assert.ok(!e.IMAGES.objects.get(root+'report').value.includes('12.5'));
    const old=e.IMAGES.objects.get(root+'report').value;
    fail=true;
    assert.equal(await syncReports(e,now+SYNC_INTERVAL),'error');
    assert.equal(e.IMAGES.objects.get(root+'report').value,old);
    assert.equal(await syncReports(e,now+SYNC_INTERVAL+1),'limited');
    assert.equal(calls,6); // a falha parou no relatório diário: token + 1
    const failed=await reportsView(e); assert.equal(failed.guard.status,'error'); assert.equal(failed.snapshot.totals[0],12.5);
    assert.ok(!JSON.stringify(failed).includes('private error details'));
  } finally {globalThis.fetch=oldFetch;}
});
test('unconfigured, disconnected or failed R2 never calls Google',async()=>{
  const e=env();const previous=globalThis.fetch;globalThis.fetch=()=>{throw Error('must not call Google');};
  try {
    assert.equal(await syncReports({...e,ADSENSE_CLIENT_ID:undefined},now),'disabled');
    assert.equal(await syncReports(e,now),'disconnected');
    e.IMAGES.get=async()=>{throw Error('storage unavailable');};
    assert.equal(await syncReports(e,now),'error');
  } finally {globalThis.fetch=previous;}
});
test('connection requires verified expected Google identity and configured publisher', async()=>{
  const e=env();const previous=globalThis.fetch;let identity={email:'other@example.com',email_verified:true};
  globalThis.fetch=async url=>Response.json(String(url).includes('userinfo')?identity:{name:account,timeZone:{id:'America/Sao_Paulo'}});
  try {
    await assert.rejects(()=>saveConnection(e,{access_token:'a',refresh_token:'r'},'ca-pub-9160979665550731'),/não corresponde/);
    identity={email:'expected@example.com',email_verified:false};
    await assert.rejects(()=>saveConnection(e,{access_token:'a',refresh_token:'r'},'ca-pub-9160979665550731'),/não corresponde/);
    identity.email_verified=true;
    await assert.rejects(()=>saveConnection(e,{access_token:'a',refresh_token:'r'},''),/Publisher/);
    await saveConnection(e,{access_token:'a',refresh_token:'r'},'ca-pub-9160979665550731');
    const view=await reportsView(e);assert.equal(view.connected,true);assert.equal(view.account,account);
    assert.ok(!e.IMAGES.objects.get(root+'connection').value.includes('expected@example.com'));
  } finally {globalThis.fetch=previous;}
});

test('quebras por bloco e por formato: URL limitada ao site e parse validado', () => {
  const url = new URL(breakdownUrl(account, 'capitulodehoje.com.br', reportPeriod('UTC', now), UNIT_DIMENSIONS));
  assert.deepEqual(url.searchParams.getAll('dimensions'), [...UNIT_DIMENSIONS]);
  assert.deepEqual(url.searchParams.getAll('metrics'), [...BREAKDOWN_METRICS]);
  assert.equal(url.searchParams.get('filters'), 'DOMAIN_CODE==capitulodehoje.com.br,DOMAIN_CODE==www.capitulodehoje.com.br');
  assert.equal(url.searchParams.get('orderBy'), '-ESTIMATED_EARNINGS');
  assert.equal(url.searchParams.get('languageCode'), 'pt-BR');
  assert.equal(url.searchParams.get('limit'), '50');
  assert.throws(() => breakdownUrl(account, 'capitulodehoje.com.br', reportPeriod('UTC', now), ['PAYMENT_ID']));
  const rows = parseBreakdown(rawBreakdown(FORMAT_DIMENSIONS, formatRows), FORMAT_DIMENSIONS);
  assert.deepEqual(rows[0].keys, ['Âncora', 'Anúncios automáticos']);
  assert.deepEqual(rows[0].values, [1775.08, 1844465, 0.96, 0.9146, 77593]);
  assert.throws(() => parseBreakdown(rawBreakdown(FORMAT_DIMENSIONS, [['x', 'y', 'NaN', 1, 1, 1, 1]]), FORMAT_DIMENSIONS), /inválida/);
  assert.throws(() => parseBreakdown(rawReport(), FORMAT_DIMENSIONS), /formato/);
});

test('quebra que falha não derruba a sincronização e mantém a quebra anterior', async () => {
  const e = env(); await connected(e); const previous = globalThis.fetch; let breakFails = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/token')) return Response.json({ access_token: 'a' });
    if (breakFails && String(url).includes('AD_UNIT_NAME')) return new Response('x', { status: 500 });
    return google(url);
  };
  try {
    assert.equal(await syncReports(e, now), 'ready');
    breakFails = true;
    assert.equal(await syncReports(e, now + SYNC_INTERVAL), 'ready');
    const view = await reportsView(e);
    assert.equal(view.snapshot.generatedAt, now + SYNC_INTERVAL);
    assert.equal(view.snapshot.byUnit[0].keys[0], 'Meio-do-artigo'); // anterior preservada
    assert.ok(view.snapshot.warnings.some(w => /quebra/.test(w)));
  } finally { globalThis.fetch = previous; }
});

test('atualização manual: 5 minutos entre cliques; o cron continua de hora em hora', async () => {
  const e = env(); await connected(e); const previous = globalThis.fetch; let reports = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/token')) return Response.json({ access_token: 'a' });
    if (String(url).includes('dimensions=DATE')) reports++;
    return google(url);
  };
  try {
    assert.equal(await syncReports(e, now), 'ready');                                   // cron
    assert.equal(await syncReports(e, now + MANUAL_GAP - 1, { manual: true }), 'limited');
    assert.equal(await syncReports(e, now + MANUAL_GAP, { manual: true }), 'ready');    // manual liberado
    assert.equal(await syncReports(e, now + MANUAL_GAP + 60000), 'limited');            // cron espera 1 h
    assert.equal(await syncReports(e, now + MANUAL_GAP + 60000, { manual: true }), 'limited');
    assert.equal(reports, 2);
  } finally { globalThis.fetch = previous; }
});

test('RPM de página: dias desde o início do teste ou, sem eles, os 30 dias', () => {
  const snap = { currency: 'USD', generatedAt: now, start: '2026-08-30', end: '2026-09-28', totals: [60, 30000], rows: [
    { date: '2026-09-26', values: [20, 10000] }, { date: '2026-09-27', values: [15, 5000] }, { date: '2026-09-28', values: [25, 15000] },
  ] };
  const since = pageRpm(snap, '2026-09-27');
  assert.equal(since.sinceTest, true); assert.equal(since.days, 2);
  assert.ok(Math.abs(since.rpm - 2) < 1e-9); // (15+25)/(5.000+15.000) × 1000
  const all = pageRpm(snap, '2026-10-05');
  assert.equal(all.sinceTest, false); assert.ok(Math.abs(all.rpm - 2) < 1e-9); assert.equal(all.start, '2026-08-30');
  assert.equal(pageRpm(null), null);
  assert.equal(pageRpm({ ...snap, rows: [], totals: [0, 0] }), null);
  assert.equal(nextDayIn('America/Sao_Paulo', Date.parse('2026-09-30T01:48:00Z')), '2026-09-30'); // 29/09 22:48 BRT
});
