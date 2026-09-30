import test from 'node:test';
import assert from 'node:assert/strict';
import { METRICS, SYNC_INTERVAL, parseReport, reportPeriod, reportUrl, seal, unseal, reportsView, saveConnection, syncReports } from './adsenseReports.ts';

const root = '_internal/adsense-v1/';
const account = 'accounts/pub-9160979665550731';
const now = Date.parse('2026-09-30T01:00:00Z');
function rawReport() {
  return { headers: [{ name: 'DATE' }, ...METRICS.map(name => ({ name, ...(name === 'ESTIMATED_EARNINGS' || name === 'PAGE_VIEWS_RPM' ? { currencyCode: 'USD' } : {}) }))], rows: [{ cells: ['2026-09-28','12.5','1000','2200','25','12.5','0.025'].map(value => ({value})) }], totals: { cells: ['','12.5','1000','2200','25','12.5','0.025'].map(value => ({value})) }, totalMatchedRows: '1' };
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
    return Response.json(rawReport());
  };
  try {
    const results=await Promise.all(Array.from({length:50},()=>syncReports(e,now)));
    assert.equal(results.filter(v=>v==='ready').length,1);
    assert.equal(calls,2);
    const view=await reportsView(e); assert.equal(view.snapshot.totals[0],12.5); assert.equal(calls,2);
    assert.ok(!JSON.stringify(view).includes('private-refresh'));
    assert.ok(!e.IMAGES.objects.get(root+'report').value.includes('12.5'));
    const old=e.IMAGES.objects.get(root+'report').value;
    fail=true;
    assert.equal(await syncReports(e,now+SYNC_INTERVAL),'error');
    assert.equal(e.IMAGES.objects.get(root+'report').value,old);
    assert.equal(await syncReports(e,now+SYNC_INTERVAL+1),'limited');
    assert.equal(calls,4);
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
