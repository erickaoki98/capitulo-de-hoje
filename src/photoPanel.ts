import type { PhotoPanelData } from './photoRoutes.ts';
import { approvedExample, PHOTO_SOURCE, photoMapsJSON } from './photoMaps.ts';
import { aggregatePhotoRows } from './photoReports.ts';

const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const n=(value:number|null|undefined)=>value==null?'—':value.toLocaleString('pt-BR',{maximumFractionDigits:2});
const pct=(value:number|null)=>value==null?'—':value.toLocaleString('pt-BR',{style:'percent',maximumFractionDigits:1});
export function photoPanelBody(data:PhotoPanelData,message?:string):string {
  const {config,reports,adArm,device}=data, snapshot=reports.snapshot;
  const totals=aggregatePhotoRows(snapshot?.rows??[],{adArm,device});
  const stamp=(time:number)=>new Date(time).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const money=(value:number|null|undefined)=>value==null||!snapshot?.currency?'—':value.toLocaleString('pt-BR',{style:'currency',currency:snapshot.currency});
  const stale=!!snapshot && Date.now()-snapshot.generatedAt>2*3600000;
  const readiness=reports.readiness, ready=!!(reports.connected&&reports.guard?.status!=='error'&&readiness?.revenueLinked&&Date.now()-readiness.checkedAt<=7200000);
  const maps=Object.keys(data.maps).length?data.maps:approvedExample();
  const started=!!config.startedAt;
  const status=config.enabled?'Em andamento':started?'Pausado':'Ainda não iniciado';
  const select=(name:string,current:string,options:[string,string][])=>`<select name="${name}">${options.map(([value,label])=>`<option value="${escape(value)}"${value===current?' selected':''}>${escape(label)}</option>`).join('')}</select>`;
  const hasData=!!snapshot?.rows.length;
  const row=(label:string,values:string[])=>`<tr><th scope="row">${label}</th>${values.map(v=>`<td>${v}</td>`).join('')}</tr>`;
  const values=(fn:(t:typeof totals[number])=>string)=>totals.map(t=>hasData?fn(t):'—');
  const lifecycleAction=config.enabled?'pause':'start';
  return `<style>
  .photo-panel{display:grid;gap:20px}.photo-panel p{line-height:1.6}.photo-panel .photo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.photo-panel .photo-card{padding:22px;background:var(--adm-card,#fff);border:1px solid var(--adm-border,#e5e7eb);border-radius:12px}.photo-panel h2{font-size:18px;margin:0 0 12px}.photo-panel h3{font-size:14px;margin:0 0 10px}.photo-panel .photo-big{font-size:24px;font-weight:600;margin:6px 0}.photo-panel .photo-muted{color:var(--adm-text-muted,#596170);font-size:13px}.photo-panel .photo-actions,.photo-panel .photo-filters{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.photo-panel label{display:grid;gap:7px;font-size:13px}.photo-panel select,.photo-panel button,.photo-panel .photo-link{min-height:44px;padding:10px 14px;border-radius:8px;border:1px solid var(--adm-border,#d9dce4);font:inherit}.photo-panel input:not([type=range]):not([type=hidden]){min-height:44px;padding:10px 12px;border:1px solid var(--adm-border,#d9dce4);border-radius:8px;font:inherit;width:100%;box-sizing:border-box;background:var(--adm-card,#fff);color:inherit}.photo-panel input[type=range]{min-height:44px;max-width:100%}.photo-panel input:focus-visible,.photo-panel button:focus-visible{outline:3px solid #6541c4;outline-offset:3px}.photo-panel button{background:#6541c4;color:white}.photo-panel button:disabled{opacity:.55;cursor:not-allowed}.photo-panel .photo-link{display:inline-flex;align-items:center;color:inherit;text-decoration:none;background:transparent}.photo-panel .photo-note{border-left:3px solid #8264c5;padding:12px 16px;background:var(--adm-card,#fff)}.photo-panel .photo-table-wrap{overflow-x:auto}.photo-panel table{width:100%;border-collapse:collapse}.photo-panel th,.photo-panel td{padding:14px 10px;border-bottom:1px solid var(--adm-border,#e5e7eb);text-align:right;white-space:nowrap}.photo-panel th:first-child{text-align:left;white-space:normal;min-width:155px}.photo-panel table thead th{background:var(--adm-card,#fff)}.photo-panel .photo-error{border-left-color:#b42318}.photo-panel figure{margin:0}.photo-panel .photo-preview{max-width:420px;aspect-ratio:1;overflow:hidden;border-radius:8px;position:relative}.photo-panel .photo-preview img{position:absolute;width:100%;height:100%;max-width:none;transform-origin:0 0}.photo-panel .photo-preview img+img{opacity:0}.photo-panel details summary{min-height:44px;padding:12px 0;cursor:pointer}@media(max-width:800px){.photo-panel .photo-grid{grid-template-columns:1fr}.photo-panel .photo-card{padding:16px}.photo-panel th,.photo-panel td{padding:12px 8px}}
  </style>
  <div class="photo-panel">
    ${message?`<div class="photo-note" role="status">${escape(message)}</div>`:''}
    <div class="photo-grid">
      <section class="photo-card"><h3>Teste de fotos</h3><p class="photo-big">${status}</p><p class="photo-muted">${started?'Início: '+stamp(config.startedAt):'O blog continua com fotos estáticas até o início do teste.'}</p><p class="photo-muted">Divisão 50% / 50%, persistente por navegador.</p></section>
      <section class="photo-card"><h3>Analytics</h3><p class="photo-big">${reports.connected?'Conectado':'A conectar'}</p><p class="photo-muted">${reports.email?escape(reports.email):'Leitura da propriedade Capítulo de Hoje.'}</p></section>
      <section class="photo-card"><h3>Receita por versão</h3><p class="photo-big">${readiness?.revenueLinked?'Vínculo verificado':'Indisponível'}</p><p class="photo-muted">${readiness?.revenueLinked?'Coleta após a preparação do vínculo; dias completos e com acesso à receita.':'O AdSense precisa estar vinculado à mesma propriedade do Analytics. Sem vínculo, não tratamos receita como zero.'}</p></section>
    </div>
    ${(reports.error||reports.guard?.error)?`<div class="photo-note photo-error" role="alert">${escape(reports.error||reports.guard?.error)}</div>`:''}
    ${stale?'<div class="photo-note">Relatório anterior: a última atualização tem mais de duas horas. Confira a conexão antes de comparar resultados.</div>':''}
    ${snapshot?.warnings.map(w=>`<div class="photo-note">${escape(w)}</div>`).join('')||''}
    <section class="photo-card"><h2>Foto estática × recortes animados</h2>
      <form class="photo-filters" method="GET" action="/admin/teste-fotos"><label>Anúncios${select('anuncios',adArm,[['','Todos os grupos'],['adsense','Somente AdSense'],['nativo','Somente nativos'],['(not set)','Sem grupo de anúncios']])}</label><label>Aparelho${select('aparelho',device,[['','Todos'],['mobile','Celular'],['desktop','Computador'],['tablet','Tablet']])}</label><button type="submit">Aplicar filtros</button></form>
      <p class="photo-muted">${snapshot?`Período: ${escape(snapshot.start)} a ${escape(snapshot.end)} · Atualizado em ${stamp(snapshot.generatedAt)}.`:'Aguardando início do teste e coleta. Os acessos anteriores sem grupo A/B ficam fora da comparação.'}</p>
      <div class="photo-table-wrap"><table><thead><tr><th scope="col">Métrica</th><th scope="col">A · Foto estática</th><th scope="col">B · Recortes animados</th></tr></thead><tbody>
      ${row('Visualizações',values(t=>n(t.views)))}
      ${row('Sessões',values(t=>n(t.sessions)))}
      ${row('Receita atribuída',values(t=>money(t.revenue)))}
      ${row('Receita por mil visualizações',values(t=>money(t.rpmPer1000Views)))}
      ${row('Receita por mil sessões',values(t=>money(t.revenuePer1000Sessions)))}
      ${row('Engajamento médio por sessão',values(t=>t.engagementSecondsPerSession==null?'—':n(t.engagementSecondsPerSession)+' s'))}
      ${row('Taxa de engajamento',values(t=>pct(t.engagementRate)))}
      ${row('Páginas por sessão',values(t=>n(t.sessions?t.views/t.sessions:null)))}
      </tbody></table></div>
      <p class="photo-muted">${hasData?'Resultados descritivos; ainda não declaramos um vencedor ou significância estatística.':'Ainda não há amostra para comparar as versões.'} Tempo de engajamento considera uso em primeiro plano; trocar um enquadramento não conta como interação.</p>
      <p class="photo-muted">A receita por mil usa visualizações do Analytics. O teste de anúncios continua separado; use o filtro “Somente AdSense” para comparar fotos dentro do mesmo tipo de monetização.</p>
    </section>
    <section class="photo-card"><h2>Conexão e coleta</h2><div class="photo-actions">
      <form method="POST" action="/admin/teste-fotos/connect"><button type="submit"${!reports.configured?' disabled':''}>${reports.connected?'Reconectar':'Conectar'} Analytics (leitura)</button></form>
      <form method="POST" action="/admin/teste-fotos/sync"><button type="submit"${!reports.connected?' disabled':''}>Verificar conexão e atualizar</button></form>
      <a class="photo-link" href="/admin/adsense">Receita geral do AdSense</a>
    </div><p class="photo-muted">${reports.configured?'A conexão solicita somente leitura do Analytics e usa a mesma conta que tem acesso à propriedade do blog.':'O cliente Google do blog ainda precisa estar configurado para conectar o Analytics.'} Atualização automática por hora; falhas preservam o último relatório válido.</p>
    </section>
    <section class="photo-card"><h2>Prévia dos recortes</h2><figure><div class="photo-preview" id="photo-admin-preview" role="img" aria-label="Recortes fechados de Heitor e Pilar; o rosto da testemunha não aparece no recorte do homem."><img src="/img/9e5335709590212c.jpg" alt="" width="1080" height="1080"><img src="/img/9e5335709590212c.jpg" alt="" width="1080" height="1080"></div><figcaption class="photo-muted">Mesma foto, com planos próximos. Detalhes do ambiente só entram quando acrescentam ação à cena.</figcaption></figure><button type="button" id="photo-preview-pause">Pausar prévia</button>
      <script type="module">import {startPhotoPreview} from '/photo-motion.js?v=20261016-1';startPhotoPreview(document.getElementById('photo-admin-preview'),document.getElementById('photo-preview-pause'));</script>
    </section>
    <section class="photo-card"><h2>Mapa visual da imagem</h2><p>Marque de 2 a 6 enquadramentos: rosto, reação, interação ou detalhe que conte a cena. Clique na foto para posicionar o corte e ajuste o zoom. Evite rostos do fundo e objetos sem função na ação.</p>
    <form id="photo-map-form" method="POST" action="/admin/teste-fotos/map">
    <label>Caminho da foto<input name="source" value="${PHOTO_SOURCE}" maxlength="160" required></label><button type="button" id="photo-map-load">Carregar foto</button>
    <div id="photo-map-stage" style="position:relative;max-width:420px;margin:16px 0"><img id="photo-map-image" alt="Foto completa para marcar os enquadramentos" style="display:block;width:100%;height:auto"><div id="photo-map-box" style="position:absolute;border:3px solid #ffc400;box-shadow:0 0 0 1px #222;pointer-events:none"></div></div>
    <div class="photo-filters"><label>Posição horizontal<input name="x" type="range" min="0" max="1" step=".005" value=".17"></label><label>Posição vertical<input name="y" type="range" min="0" max="1" step=".005" value="0"></label><label>Tamanho do corte<input name="size" type="range" min=".1" max="1" step=".005" value=".3"></label></div>
    <label>O que esse corte mostra?<input id="photo-map-label" maxlength="80" placeholder="Ex.: reação de Pilar"></label><button type="button" id="photo-map-add">Adicionar enquadramento</button><ol id="photo-map-list"></ol><input type="hidden" name="shots"><button type="submit"${config.enabled?' disabled':''}>Aprovar e salvar mapa</button>
    </form><p class="photo-muted">${config.enabled?'Pause o teste para revisar mapas.':'O mapa fica salvo no servidor e é reutilizado em cada visita, sem analisar a foto novamente.'} Imagens sem mapa aprovado permanecem estáticas.</p>
    <script type="application/json" id="photo-map-data">${photoMapsJSON(maps)}</script><script type="module" src="/photo-map-editor.js?v=20261016-1"></script></section>
    <section class="photo-card"><h2>${config.enabled?'Pausar teste':'Iniciar teste no blog'}</h2><p>Ao iniciar, metade dos navegadores recebe fotos estáticas e metade recebe recortes animados nas fotos elegíveis do corpo do artigo. A preferência por movimento reduzido e fotos sem mapa aprovado mantêm a imagem parada.</p><form method="POST" action="/admin/teste-fotos/config" class="photo-actions"><input type="hidden" name="action" value="${lifecycleAction}"><button type="submit"${!config.enabled&&!ready?' disabled':''}>${config.enabled?'Pausar teste':started?'Retomar teste 50% / 50%':'Iniciar teste 50% / 50%'}</button></form><p class="photo-muted">${!ready&&!config.enabled?'Verifique a conexão e o vínculo de receita para liberar o início. ':''}A pausa mantém o histórico e o grupo de cada navegador. Hero, anúncios e recomendações conservam seu comportamento.</p></section>
  </div>`;
}
