import type { PhotoPanelData } from './photoRoutes.ts';
import { aggregatePhotoRows } from './photoReports.ts';

const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const n=(value:number|null|undefined)=>value==null?'—':value.toLocaleString('pt-BR',{maximumFractionDigits:2});
const pct=(value:number|null)=>value==null?'—':value.toLocaleString('pt-BR',{style:'percent',maximumFractionDigits:1});
export function photoPanelBody(data:PhotoPanelData,message?:string):string {
  const {config,reports,adArm,device}=data, snapshot=reports.snapshot;
  const totals=aggregatePhotoRows(snapshot?.rows??[],{adArm,device});
  const revenueRows=(snapshot?.rows??[]).filter(row=>row.revenue!==null&&(!adArm||row.adArm===adArm)&&(!device||row.device===device));
  const revenueTotals=aggregatePhotoRows(revenueRows);
  const revenueDays=[...new Set(revenueRows.map(row=>row.date))].sort();
  const totalSessions=totals.reduce((sum,total)=>sum+total.sessions,0);
  const stamp=(time:number)=>new Date(time).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const money=(value:number|null|undefined)=>value==null||!snapshot?.currency?'—':value.toLocaleString('pt-BR',{style:'currency',currency:snapshot.currency});
  const stale=!!snapshot && Date.now()-snapshot.generatedAt>2*3600000;
  const readiness=reports.readiness, ai=data.ai;
  const revenueReady=!!readiness?.revenueLinked&&readiness.revenueStatus!=='revenue_restricted';
  const aiCost=ai&&(ai.estimatedCostUsd>0||ai.ready+ai.static+ai.failed>0)?ai.estimatedCostUsd.toLocaleString('pt-BR',{style:'currency',currency:'USD',minimumFractionDigits:4,maximumFractionDigits:4}):'—';
  const started=!!config.startedAt;
  const status=config.enabled?'Em andamento':started?'Pausado':'Ainda não iniciado';
  const select=(name:string,current:string,options:[string,string][])=>`<select name="${name}">${options.map(([value,label])=>`<option value="${escape(value)}"${value===current?' selected':''}>${escape(label)}</option>`).join('')}</select>`;
  const hasData=!!snapshot?.rows.length;
  const row=(label:string,values:string[])=>`<tr><th scope="row">${label}</th>${values.map(v=>`<td>${v}</td>`).join('')}</tr>`;
  const values=(fn:(t:typeof totals[number])=>string)=>totals.map(t=>hasData?fn(t):'—');
  const lifecycleAction=config.enabled?'pause':'start';
  return `<style>
  .adm-main:has(.photo-panel){min-width:0}.photo-panel{display:grid;gap:20px;min-width:0}.photo-panel .photo-card{min-width:0}.photo-panel p{line-height:1.6}.photo-panel .photo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.photo-panel .photo-card{padding:22px;background:var(--adm-card,#fff);border:1px solid var(--adm-border,#e5e7eb);border-radius:12px}.photo-panel h2{font-size:18px;margin:0 0 12px}.photo-panel h3{font-size:14px;margin:0 0 10px}.photo-panel .photo-big{font-size:24px;font-weight:600;margin:6px 0}.photo-panel .photo-muted{color:var(--adm-text-muted,#596170);font-size:13px}.photo-panel .photo-actions,.photo-panel .photo-filters{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.photo-panel label{display:grid;gap:7px;font-size:13px}.photo-panel select,.photo-panel button,.photo-panel .photo-link{min-height:44px;padding:10px 14px;border-radius:8px;border:1px solid var(--adm-border,#d9dce4);font:inherit}.photo-panel select:focus-visible,.photo-panel .photo-link:focus-visible,.photo-panel button:focus-visible{outline:3px solid #6541c4;outline-offset:3px}.photo-panel button{background:#6541c4;color:white}.photo-panel button:disabled{opacity:.55;cursor:not-allowed}.photo-panel .photo-link{display:inline-flex;align-items:center;color:inherit;text-decoration:none;background:transparent}.photo-panel .photo-note{border-left:3px solid #8264c5;padding:12px 16px;background:var(--adm-card,#fff)}.photo-panel .photo-table-wrap{overflow-x:auto}.photo-panel table{width:100%;border-collapse:collapse}.photo-panel th,.photo-panel td{padding:14px 10px;border-bottom:1px solid var(--adm-border,#e5e7eb);text-align:right;white-space:nowrap}.photo-panel th:first-child{text-align:left;white-space:normal;min-width:155px}.photo-panel table thead th{background:var(--adm-card,#fff)}.photo-panel .photo-error{border-left-color:#b42318}@media(max-width:800px){.photo-panel .photo-grid{grid-template-columns:1fr}.photo-panel .photo-card{padding:16px}.photo-panel th,.photo-panel td{padding:12px 8px}}
  </style>
  <div class="photo-panel">
    ${message?`<div class="photo-note" role="status">${escape(message)}</div>`:''}
    <div class="photo-grid">
      <section class="photo-card"><h3>Teste de fotos</h3><p class="photo-big">${status}</p><p class="photo-muted">${started?'Início: '+stamp(config.startedAt):'O blog continua com fotos estáticas até o início do teste.'}</p><p class="photo-muted">Divisão 50% / 50%, persistente por navegador.</p></section>
      <section class="photo-card"><h3>Analytics</h3><p class="photo-big">${reports.connected?'Conectado':'A conectar'}</p><p class="photo-muted">${reports.email?escape(reports.email):'Leitura da propriedade Capítulo de Hoje.'}</p></section>
      <section class="photo-card"><h3>Receita AdSense por versão</h3><p class="photo-big">${revenueReady?'Vínculo verificado':'Indisponível'}</p><p class="photo-muted">${revenueReady?'Coleta após a preparação do vínculo; dias completos e com acesso à receita.':readiness?.revenueStatus==='revenue_restricted'?'A permissão desta conta restringe a leitura de receita. O engajamento continua disponível.':'O AdSense precisa estar vinculado à mesma propriedade do Analytics. Sem vínculo, não tratamos receita como zero.'}</p></section>
    </div>
    ${(reports.error||reports.guard?.error)?`<div class="photo-note photo-error" role="alert">${escape(reports.error||reports.guard?.error)}</div>`:''}
    ${stale?'<div class="photo-note">Relatório anterior: a última atualização tem mais de duas horas. Confira a conexão antes de comparar resultados.</div>':''}
    ${snapshot?.warnings.map(w=>`<div class="photo-note">${escape(w)}</div>`).join('')||''}
    <section class="photo-card"><h2>Foto estática × recortes animados</h2>
      <form class="photo-filters" method="GET" action="/admin/teste-fotos"><label>Anúncios${select('anuncios',adArm,[['','Todos os grupos'],['adsense','Somente AdSense'],['nativo','Somente nativos'],['(not set)','Sem grupo de anúncios']])}</label><label>Aparelho${select('aparelho',device,[['','Todos'],['mobile','Celular'],['desktop','Computador'],['tablet','Tablet']])}</label><button type="submit">Aplicar filtros</button></form>
      <p class="photo-muted">${snapshot?`Período: ${escape(snapshot.start)} a ${escape(snapshot.end)} · Atualizado em ${stamp(snapshot.generatedAt)}.`:`${!started?'Aguardando início do teste e coleta.':!reports.connected?'Aguardando conexão de leitura com o Analytics para exibir os resultados.':'Aguardando a primeira coleta de resultados.'} Os acessos anteriores sem grupo A/B ficam fora da comparação.`}</p>
      <div class="photo-table-wrap"><table><thead><tr><th scope="col">Métrica</th><th scope="col">A · Foto estática</th><th scope="col">B · Recortes animados</th></tr></thead><tbody>
      ${row('Visualizações',values(t=>n(t.views)))}
      ${row('Sessões',values(t=>n(t.sessions)))}
      ${row('Distribuição por sessões',values(t=>pct(totalSessions?t.sessions/totalSessions:null)))}
      ${row('Receita AdSense atribuída (dias válidos)',revenueTotals.map(t=>money(t.revenue)))}
      ${row('Receita por mil visualizações',revenueTotals.map(t=>money(t.rpmPer1000Views)))}
      ${row('Receita por mil sessões',revenueTotals.map(t=>money(t.revenuePer1000Sessions)))}
      ${row('Engajamento médio por sessão',values(t=>t.engagementSecondsPerSession==null?'—':n(t.engagementSecondsPerSession)+' s'))}
      ${row('Taxa de engajamento',values(t=>pct(t.engagementRate)))}
      ${row('Páginas por sessão',values(t=>n(t.sessions?t.views/t.sessions:null)))}
      </tbody></table></div>
      <p class="photo-muted">${hasData?'Resultados descritivos; ainda não declaramos um vencedor ou significância estatística.':'Ainda não há amostra para comparar as versões.'} Tempo de engajamento considera uso em primeiro plano; trocar um enquadramento não conta como interação.</p>
      <p class="photo-muted">A divisão observada usa sessões; um navegador pode iniciar várias sessões. Engajamento e permanência são indicadores indiretos: este relatório não mede a retenção de retorno.</p>
      <p class="photo-muted">${revenueDays.length?`Receita: ${escape(revenueDays[0])} a ${escape(revenueDays.at(-1))}, somente nas datas válidas disponíveis. Os cálculos de receita por mil usam visualizações e sessões dessas mesmas datas.`:'Receita indisponível até haver dias completos com vínculo e permissão confirmados.'} Não há rateio ou estimativa de receita entre versões.</p>
      <p class="photo-muted">A receita por mil usa visualizações do Analytics. O teste de anúncios continua separado; use o filtro “Somente AdSense” para comparar fotos dentro do mesmo tipo de monetização. Vendas e receita dos banners próprios não são atribuídas por este relatório.</p>
    </section>
    <section class="photo-card"><h2>Conexão e coleta</h2><div class="photo-actions">
      <form method="POST" action="/admin/teste-fotos/connect"><button type="submit"${!reports.configured?' disabled':''}>${reports.connected?'Reconectar':'Conectar'} Analytics (leitura)</button></form>
      <form method="POST" action="/admin/teste-fotos/sync"><button type="submit"${!reports.connected?' disabled':''}>Verificar conexão e atualizar</button></form>
      <a class="photo-link" href="/admin/teste-fotos">Atualizar estado do painel</a>
      <a class="photo-link" href="/admin/adsense">Receita geral do AdSense</a>
    </div><p class="photo-muted">${reports.configured?'A conexão solicita somente leitura do Analytics e usa a mesma conta que tem acesso à propriedade do blog.':'O cliente Google do blog ainda precisa estar configurado para conectar o Analytics.'} Atualização automática por hora; falhas preservam o último relatório válido.</p>
    </section>
    <section class="photo-card"><h2>Enquadramento automático</h2>
      <p>${ai?.enabled?'Análise automática ativa.':'Aguardando a preparação automática.'} Os enquadramentos ficam persistidos no servidor e são reutilizados nas visitas.</p>
      ${ai?`<p><strong>${n(ai.totalArticles)} artigos · ${n(ai.totalImages)} fotos</strong></p><div class="photo-grid"><div><h3>Prontas para animar</h3><p class="photo-big">${n(ai.ready)}</p></div><div><h3>Na fila / processando</h3><p class="photo-big">${n(ai.queued)} / ${n(ai.processing)}</p></div><div><h3>Estáticas / falhas</h3><p class="photo-big">${n(ai.static)} / ${n(ai.failed)}</p></div></div><p class="photo-muted">Custo estimado acumulado de análise (uso confirmado): ${aiCost}. ${ai.failed?'Chamadas interrompidas podem ter custo adicional ainda não confirmado. ':''}${ai.lastUpdated?'Estado atualizado em '+stamp(ai.lastUpdated)+'.':''}</p>${ai.error?`<div class="photo-note photo-error" role="alert">${escape(ai.error)}</div>`:''}`:''}
      <p class="photo-muted">Cobertura dos 30 artigos mais recentes e dos artigos futuros, com processamento automático e limites de custo. Fotos sem enquadramento seguro continuam estáticas; falhas não iniciam uma nova cobrança automaticamente.</p>
    </section>
    <section class="photo-card"><h2>${config.enabled?'Pausar teste':'Iniciar teste no blog'}</h2><p>Ao iniciar, metade dos navegadores recebe fotos estáticas e metade recebe recortes animados nas fotos elegíveis do corpo do artigo. A preferência por movimento reduzido e fotos sem enquadramento seguro mantêm a imagem parada.</p><form method="POST" action="/admin/teste-fotos/config" class="photo-actions"><input type="hidden" name="action" value="${lifecycleAction}"><button type="submit">${config.enabled?'Pausar teste':started?'Retomar teste 50% / 50%':'Iniciar teste 50% / 50%'}</button></form><p class="photo-muted">O teste pode começar sem conexão de receita. A pausa mantém o histórico e o grupo de cada navegador. Hero, anúncios e recomendações conservam seu comportamento.</p></section>
  </div>`;
}
