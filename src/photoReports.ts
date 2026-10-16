import type { Env } from './types';
import { exchangeToken, googleJson, randomToken, seal, unseal } from './adsenseReports.ts';
import { getSettingsByKeys } from './db.ts';

export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
export const PHOTO_PROPERTY_ID = '450970542';
export const PHOTO_SYNC_INTERVAL = 60 * 60 * 1000;
export const PHOTO_MANUAL_GAP = 5 * 60 * 1000;
const ROOT = '_internal/photo-analytics-v1/';
const CONNECTION = ROOT + 'connection';
const REPORT = ROOT + 'report';
const GUARD = ROOT + 'guard';
const READINESS = ROOT + 'readiness';
const DIMENSIONS = ['date', 'customUser:photo_ab_v1', 'customUser:ad_arm', 'deviceCategory'];
const METRICS = ['screenPageViews', 'sessions', 'engagedSessions', 'userEngagementDuration', 'totalAdRevenue'];
const LIMIT = 5000;
type Variant = 'static' | 'motion';
type RevenueStatus = 'verified' | 'missing_link' | 'link_unverified' | 'publisher_missing' | 'revenue_restricted';
interface PhotoConnection { id: string; email: string; refreshToken: string; timeZone: string }
export interface PhotoReportRow {
  date: string; variant: Variant; adArm: string; device: string;
  views: number; sessions: number; engagedSessions: number; engagementSeconds: number; revenue: number | null;
}
export interface PhotoTotals extends Omit<PhotoReportRow, 'date' | 'adArm' | 'device'> {
  engagementRate: number | null; engagementSecondsPerSession: number | null;
  rpmPer1000Views: number | null; revenuePer1000Sessions: number | null;
}
export interface PhotoReadiness { checkedAt: number; revenueLinked: boolean; validFrom: number; publisherId: string }
interface StoredReadiness extends PhotoReadiness { connectionId: string; revenueStatus: RevenueStatus }
export interface PhotoReportSnapshot {
  connectionId: string; publisherId: string; revenueValidFrom: number; testId: string; generatedAt: number; start: string; end: string;
  domain: string; propertyId: string; timeZone: string; currency: string | null;
  revenueLinked: boolean; revenueStatus: RevenueStatus; rows: PhotoReportRow[]; warnings: string[];
}
export interface PhotoSyncGuard { nextAttemptAt: number; startedAt: number; status: 'syncing' | 'ready' | 'error'; error?: string }
export interface PhotoReportsView {
  configured: boolean; connected: boolean; email?: string;
  snapshot: PhotoReportSnapshot | null; guard: PhotoSyncGuard | null; readiness: PhotoReadiness | null; error?: string;
}
class PhotoReportsError extends Error {}
function safeError(e: unknown): string {
  return e instanceof PhotoReportsError ? e.message : 'Sincronização do Analytics indisponível. Os últimos dados válidos foram preservados.';
}
export function photoReportsConfigured(env: Env): boolean {
  if (!env.ADSENSE_CLIENT_ID || !env.ADSENSE_CLIENT_SECRET || !env.SESSION_SECRET) return false;
  try { return new URL(env.CANONICAL_URL!).protocol === 'https:'; } catch { return false; }
}
async function readPrivate<T>(env: Env, key: string): Promise<T | null> {
  const object = await env.IMAGES.get(key);
  return object ? unseal<T>(env, key, await object.text()) : null;
}
async function writePrivate(env: Env, key: string, value: unknown): Promise<void> {
  await env.IMAGES.put(key, await seal(env, key, value), { httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' } });
}
async function analyticsJson<T>(url: string, token: string): Promise<T> {
  try { return await googleJson<T>(url, token); }
  catch { throw new PhotoReportsError('O Google Analytics não confirmou o acesso de leitura. Verifique as APIs e a autorização da propriedade.'); }
}

/** A separate consent and refresh token; never reuse the AdSense connection implicitly. */
export async function savePhotoConnection(env: Env, token: { access_token: string; refresh_token?: string; scope?: string }): Promise<void> {
  if (!photoReportsConfigured(env)) throw new PhotoReportsError('Configure o cliente Google e a sessão administrativa.');
  if (!token.scope?.split(/\s+/).includes(ANALYTICS_SCOPE)) throw new PhotoReportsError('Autorize a permissão de leitura do Google Analytics.');
  if (!token.refresh_token) throw new PhotoReportsError('Autorize o acesso contínuo ao Analytics. Tente conectar novamente.');
  const user = await analyticsJson<{email?: string; email_verified?: boolean}>('https://openidconnect.googleapis.com/v1/userinfo', token.access_token);
  if (!user.email || user.email_verified !== true) throw new PhotoReportsError('A identidade Google não retornou um e-mail verificado.');
  const propertyUrl = `https://analyticsadmin.googleapis.com/v1beta/properties/${PHOTO_PROPERTY_ID}`;
  const property = await analyticsJson<{name?: string; timeZone?: string}>(propertyUrl, token.access_token);
  if (property.name !== `properties/${PHOTO_PROPERTY_ID}` || !property.timeZone) throw new PhotoReportsError('A propriedade Analytics não corresponde à propriedade esperada.');
  try { new Intl.DateTimeFormat('en', { timeZone: property.timeZone }).format(); }
  catch { throw new PhotoReportsError('A propriedade Analytics não retornou um fuso válido.'); }
  const streams = await analyticsJson<{dataStreams?: {type?: string; webStreamData?: {defaultUri?: string}}[]}>(propertyUrl + '/dataStreams?pageSize=200', token.access_token);
  const domain = new URL(env.CANONICAL_URL!).hostname;
  const matches = streams.dataStreams?.some(stream => {
    try { return stream.type === 'WEB_DATA_STREAM' && new URL(stream.webStreamData?.defaultUri ?? '').hostname === domain; }
    catch { return false; }
  });
  if (!matches) throw new PhotoReportsError('Nenhum fluxo web da propriedade corresponde ao domínio deste blog.');
  const connection: PhotoConnection = {id: randomToken(), email: user.email, timeZone: property.timeZone, refreshToken: token.refresh_token};
  const settings = await getSettingsByKeys(env.DB,['adsense.publisher_id']);
  await refreshReadiness(env,connection,token.access_token,settings['adsense.publisher_id'] ?? '',Date.now());
  await writePrivate(env, CONNECTION, connection);
}
function calendarDay(timeZone: string, ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ms);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
/** Completed Analytics calendar days only; at most 28 days, never before assignment started. */
export function photoReportPeriod(timeZone: string, startedAt: number, now = Date.now()): {start: string; end: string} | null {
  if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now) return null;
  const today = Date.parse(calendarDay(timeZone, now) + 'T00:00:00Z');
  const end = new Date(today - 86400000).toISOString().slice(0,10);
  const start = [calendarDay(timeZone, startedAt), new Date(today - 28 * 86400000).toISOString().slice(0,10)].sort().at(-1)!;
  return start <= end ? {start,end} : null;
}
export function photoReportQuery(domain: string, period: {start: string; end: string}) {
  if (!/^[a-z0-9.-]+$/.test(domain) || !/^\d{4}-\d{2}-\d{2}$/.test(period.start) || !/^\d{4}-\d{2}-\d{2}$/.test(period.end) || period.start > period.end || Date.parse(period.end) - Date.parse(period.start) > 27 * 86400000) throw new PhotoReportsError('Domínio ou período do relatório inválido.');
  return {
    dateRanges: [{startDate:period.start,endDate:period.end}], dimensions:DIMENSIONS.map(name=>({name})), metrics:METRICS.map(name=>({name})),
    dimensionFilter: {andGroup:{expressions:[
      {filter:{fieldName:'customUser:photo_ab_v1',inListFilter:{values:['static','motion'],caseSensitive:true}}},
      {filter:{fieldName:'hostName',stringFilter:{matchType:'EXACT',value:domain,caseSensitive:false}}},
    ]}}, limit:LIMIT, keepEmptyRows:false,
  };
}
interface RawPhotoReport {
  dimensionHeaders?: {name: string}[]; metricHeaders?: {name: string}[];
  rows?: {dimensionValues?: {value?: string}[]; metricValues?: {value?: string}[]}[];
  rowCount?: number; metadata?: {currencyCode?: string; timeZone?: string; samplingMetadatas?: unknown[]; subjectToThresholding?: boolean; dataLossFromOtherRow?: boolean; dataTruncationReasons?: unknown[]; schemaRestrictionResponse?: {activeMetricRestrictions?: {metricName?: string}[]}};
}
function restrictedMetrics(raw: RawPhotoReport): string[] {
  return (raw.metadata?.schemaRestrictionResponse?.activeMetricRestrictions ?? []).map(r => r.metricName ?? '');
}
export function parsePhotoReport(raw: RawPhotoReport, period: {start: string; end: string}, revenueLinked: boolean): {currency: string | null; rows: PhotoReportRow[]} {
  const dims = DIMENSIONS.map(name => raw.dimensionHeaders?.findIndex(h => h.name === name) ?? -1);
  const metrics = METRICS.map(name => raw.metricHeaders?.findIndex(h => h.name === name) ?? -1);
  if (dims.some(i => i < 0) || metrics.some(i => i < 0)) throw new PhotoReportsError('O Analytics retornou um formato de relatório inesperado.');
  const rows = raw.rows ?? [];
  const rowCount = raw.rowCount ?? (rows.length === 0 ? 0 : NaN);
  if (rows.length > LIMIT || !Number.isInteger(rowCount) || rowCount !== rows.length) throw new PhotoReportsError('Relatório truncado ou parcial; os dados anteriores foram preservados.');
  if (raw.metadata?.samplingMetadatas?.length) throw new PhotoReportsError('O Analytics retornou dados com amostragem; os dados anteriores foram preservados.');
  if (raw.metadata?.subjectToThresholding) throw new PhotoReportsError('O Analytics aplicou um limiar de privacidade; os dados anteriores foram preservados.');
  if (raw.metadata?.dataLossFromOtherRow) throw new PhotoReportsError('O Analytics agrupou outras linhas; os dados anteriores foram preservados.');
  if (raw.metadata?.dataTruncationReasons?.length) throw new PhotoReportsError('Relatório truncado pelo Analytics em parte do período; os dados anteriores foram preservados.');
  const restrictions = restrictedMetrics(raw);
  if (restrictions.some(name => METRICS.includes(name) && name !== 'totalAdRevenue')) throw new PhotoReportsError('O Analytics restringiu métricas de engajamento; os dados anteriores foram preservados.');
  const revenueReadable = revenueLinked && !restrictions.includes('totalAdRevenue');
  const currency = raw.metadata?.currencyCode;
  if (revenueReadable && !/^[A-Z]{3}$/.test(currency ?? '')) throw new PhotoReportsError('O Analytics não informou a moeda da receita.');
  const seen = new Set<string>();
  return {currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null, rows:rows.map(row => {
    const keys = dims.map(i => row.dimensionValues?.[i]?.value ?? '');
    const [rawDate,variant,adArm,device] = keys;
    const date = rawDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    if (!/^\d{8}$/.test(rawDate) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date || date < period.start || date > period.end) throw new PhotoReportsError('O Analytics retornou uma data inválida ou fora do período solicitado.');
    if ((variant !== 'static' && variant !== 'motion') || !adArm || !device || keys.some(k => k === '(other)')) throw new PhotoReportsError('O Analytics retornou uma variante inválida ou outras linhas agrupadas.');
    const key = JSON.stringify(keys);
    if (seen.has(key)) throw new PhotoReportsError('O Analytics retornou linhas duplicadas.');
    seen.add(key);
    const values = metrics.map(i => {
      const value = row.metricValues?.[i]?.value;
      if (value === undefined || value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) throw new PhotoReportsError('O Analytics retornou uma métrica inválida.');
      return Number(value);
    });
    return {date,variant,adArm,device,views:values[0],sessions:values[1],engagedSessions:values[2],engagementSeconds:values[3],revenue:revenueReadable?values[4]:null};
  })};
}
export function aggregatePhotoRows(rows: PhotoReportRow[], filters: {adArm?: string; device?: string} = {}): PhotoTotals[] {
  return (['static','motion'] as const).map(variant => {
    const selected = rows.filter(row => row.variant === variant && (!filters.adArm || row.adArm === filters.adArm) && (!filters.device || row.device === filters.device));
    const sum = (key: 'views' | 'sessions' | 'engagedSessions' | 'engagementSeconds') => selected.reduce((total,row) => total + row[key],0);
    const views = sum('views'), sessions = sum('sessions'), engagedSessions = sum('engagedSessions'), engagementSeconds = sum('engagementSeconds');
    const revenue = selected.length && selected.every(r => r.revenue !== null) ? selected.reduce((total,row) => total + row.revenue!,0) : null;
    return {variant,views,sessions,engagedSessions,engagementSeconds,revenue,engagementRate:sessions?engagedSessions/sessions:null,engagementSecondsPerSession:sessions?engagementSeconds/sessions:null,rpmPer1000Views:revenue!==null&&views?revenue/views*1000:null,revenuePer1000Sessions:revenue!==null&&sessions?revenue/sessions*1000:null};
  });
}
/** Only cached private storage: opening admin never calls Google or aggregates D1 events. */
export async function photoReportsView(env: Env): Promise<PhotoReportsView> {
  const base: PhotoReportsView = {configured:photoReportsConfigured(env),connected:false,snapshot:null,guard:null,readiness:null};
  if (!base.configured) return base;
  try {
    const connection = await readPrivate<PhotoConnection>(env, CONNECTION);
    if (!connection) return base;
    const [storedSnapshot,guard,storedReadiness] = await Promise.all([readPrivate<PhotoReportSnapshot>(env, REPORT),env.IMAGES.get(GUARD),readPrivate<StoredReadiness>(env,READINESS)]);
    const readiness = storedReadiness?.connectionId===connection.id ? storedReadiness : null;
    let snapshot = storedSnapshot?.connectionId===connection.id ? storedSnapshot : null;
    if (snapshot && (!readiness?.revenueLinked || snapshot.publisherId !== readiness.publisherId || snapshot.revenueValidFrom !== readiness.validFrom)) {
      snapshot = {...snapshot,revenueLinked:false,revenueStatus:readiness?.revenueLinked?'link_unverified':readiness?.revenueStatus??'link_unverified',rows:snapshot.rows.map(row=>({...row,revenue:null})),warnings:[...snapshot.warnings,'A verificação mais recente não confirma receita disponível para o vínculo e período deste relatório. Os dados de engajamento foram preservados.']};
    }
    return {...base,connected:true,email:connection.email,snapshot,readiness:readiness?{checkedAt:readiness.checkedAt,revenueLinked:readiness.revenueLinked,validFrom:readiness.validFrom,publisherId:readiness.publisherId}:null,guard:guard?await guard.json<PhotoSyncGuard>():null};
  } catch (e) { return {...base,error:safeError(e)}; }
}
async function revenueLink(token: string, publisherId: string): Promise<{linked: boolean; status: RevenueStatus}> {
  const publisher = publisherId.replace(/^ca-/, '');
  if (!/^pub-\d{16}$/.test(publisher)) return {linked:false,status:'publisher_missing'};
  try {
    const response = await analyticsJson<{adsenseLinks?: {adClientCode?: string}[]; nextPageToken?: string}>(`https://analyticsadmin.googleapis.com/v1alpha/properties/${PHOTO_PROPERTY_ID}/adSenseLinks?pageSize=200`,token);
    const linked = response.adsenseLinks?.some(link => link.adClientCode === 'ca-' + publisher) ?? false;
    // ponytail: one bounded page; a next page without a match means unverified, never zero revenue.
    return {linked,status:linked?'verified':response.nextPageToken?'link_unverified':'missing_link'};
  } catch { return {linked:false,status:'link_unverified'}; }
}
async function refreshReadiness(env: Env, connection: PhotoConnection, token: string, publisher: string, now: number): Promise<StoredReadiness> {
  const rawPublisher = publisher.trim().replace(/^ca-/, '');
  const publisherId = /^pub-\d{16}$/.test(rawPublisher) ? 'ca-' + rawPublisher : publisher.trim();
  const previous = await readPrivate<StoredReadiness>(env,READINESS);
  const link = await revenueLink(token,publisherId);
  const continuous = link.linked && previous?.revenueLinked && previous.connectionId===connection.id && previous.publisherId===publisherId && Number.isFinite(previous.validFrom) && previous.validFrom > 0;
  const readiness: StoredReadiness = {connectionId:connection.id,publisherId,checkedAt:now,revenueLinked:link.linked,validFrom:link.linked?(continuous?previous!.validFrom:now):0,revenueStatus:link.status};
  await writePrivate(env,READINESS,readiness);
  return readiness;
}
function safeRevenueStart(timeZone: string, validFrom: number): string {
  // Collection can begin up to 24h after linking: start with the following full calendar day.
  const collectionDay = calendarDay(timeZone,validFrom + 86400000);
  return new Date(Date.parse(collectionDay + 'T00:00:00Z') + 86400000).toISOString().slice(0,10);
}
/** One global conditional reservation, 1/hour cron or 1/5min manual; no retries or event tables. */
export async function syncPhotoReports(env: Env, now = Date.now(), options: {manual?: boolean} = {}): Promise<'ready' | 'limited' | 'error' | 'not_connected'> {
  if (!photoReportsConfigured(env)) return 'not_connected';
  try {
    const connection = await readPrivate<PhotoConnection>(env, CONNECTION);
    if (!connection) return 'not_connected';
    const previous = await env.IMAGES.get(GUARD);
    const guard = previous ? await previous.json<PhotoSyncGuard>() : null;
    if (guard && (options.manual ? !Number.isFinite(guard.startedAt) || now - guard.startedAt < PHOTO_MANUAL_GAP : !Number.isFinite(guard.nextAttemptAt) || now < guard.nextAttemptAt)) return 'limited';
    const reserved: PhotoSyncGuard = {startedAt:now,nextAttemptAt:now+PHOTO_SYNC_INTERVAL,status:'syncing'};
    const reservation = await env.IMAGES.put(GUARD,JSON.stringify(reserved),{onlyIf:previous?{etagMatches:previous.etag}:{etagDoesNotMatch:'*'}});
    if (!reservation) return 'limited';
    try {
      const settings = await getSettingsByKeys(env.DB,['photo.experiment','adsense.publisher_id']);
      const config = JSON.parse(settings['photo.experiment'] ?? 'null') as {enabled?: boolean; id?: string; startedAt?: number} | null;
      const token = await exchangeToken(env,{grant_type:'refresh_token',refresh_token:connection.refreshToken});
      const readiness = await refreshReadiness(env,connection,token.access_token,settings['adsense.publisher_id'] ?? '',now);
      const link = {linked:readiness.revenueLinked,status:readiness.revenueStatus};
      const period = config?.startedAt ? photoReportPeriod(connection.timeZone,config.startedAt,now) : null;
      const originalStart = period?.start;
      if (period && readiness.revenueLinked) period.start = [period.start,safeRevenueStart(connection.timeZone,readiness.validFrom)].sort().at(-1)!;
      // A pause stops assignment in the browser; keep reading assigned days for GA latency and the final day.
      if (!config || typeof config.id !== 'string' || !config.id || config.id.length > 80 || !period || period.start > period.end) {
        await env.IMAGES.put(GUARD,JSON.stringify({...reserved,status:'ready'}),{onlyIf:{etagMatches:reservation.etag}});
        return 'ready';
      }
      const domain = new URL(env.CANONICAL_URL!).hostname;
      const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PHOTO_PROPERTY_ID}:runReport`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(photoReportQuery(domain,period)),signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new PhotoReportsError(`O relatório Analytics não ficou disponível (HTTP ${response.status}). Os últimos dados válidos foram preservados.`);
      const raw = await response.json() as RawPhotoReport;
      if (raw.metadata?.timeZone !== connection.timeZone) throw new PhotoReportsError('O fuso da propriedade Analytics mudou ou não foi informado. Reconecte a conta para confirmar o calendário.');
      if (link.linked && restrictedMetrics(raw).includes('totalAdRevenue')) { link.linked = false; link.status = 'revenue_restricted'; }
      const parsed = parsePhotoReport(raw,period,link.linked);
      const warnings = ['O Analytics pode atrasar e revisar os dados; o relatório inclui somente dias encerrados. Comparações descritivas, sem vencedor automático.'];
      if (period.start !== originalStart) warnings.push('O período foi reduzido para começar somente após a confirmação do vínculo e a janela inicial de coleta de receita. Visualizações e sessões usam o mesmo período da receita.');
      if (!link.linked) warnings.push(link.status==='revenue_restricted'?'Receita indisponível: a permissão desta conta no Analytics restringe a leitura de receita.':link.status==='missing_link'?'Receita indisponível: esta propriedade Analytics não confirmou vínculo com o AdSense deste blog.':link.status==='publisher_missing'?'Receita indisponível: configure o Publisher ID do AdSense deste blog.':'Receita indisponível: não foi possível verificar o vínculo entre Analytics e AdSense.');
      await writePrivate(env,REPORT,{...parsed,...period,connectionId:connection.id,publisherId:readiness.publisherId,revenueValidFrom:readiness.validFrom,testId:config.id,generatedAt:now,propertyId:PHOTO_PROPERTY_ID,domain,timeZone:connection.timeZone,revenueLinked:link.linked,revenueStatus:link.status,warnings} satisfies PhotoReportSnapshot);
      await env.IMAGES.put(GUARD,JSON.stringify({...reserved,status:'ready'}),{onlyIf:{etagMatches:reservation.etag}});
      return 'ready';
    } catch (e) {
      await env.IMAGES.put(GUARD,JSON.stringify({...reserved,status:'error',error:safeError(e)}),{onlyIf:{etagMatches:reservation.etag}});
      return 'error';
    }
  } catch { return 'error'; }
}
