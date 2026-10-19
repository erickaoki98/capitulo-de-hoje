/** Active = visible tab, refreshed at the existing one-minute cadence.
 * Shared storage reduces duplicate tabs; the SQL conditional update is authoritative.
 * Storage failure falls back to this tab, never breaks the page.
 */
export const heartbeatScript = `(function(){
  var vid, last = 0;
  try { vid = localStorage.getItem('_vid'); } catch(e){}
  if (!vid) {
    vid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem('_vid', vid); } catch(e){}
  }
  function hb(){
    if (document.hidden) return;
    var now = Date.now(), shared = 0;
    try { shared = Number(localStorage.getItem('_hb_at')) || 0; } catch(e){}
    var previous = Math.max(last, shared);
    if (previous <= now && now - previous < 55000) return;
    try {
      if (navigator.sendBeacon('/api/heartbeat', JSON.stringify({vid:vid,path:location.pathname}))) {
        last = now;
        try { localStorage.setItem('_hb_at', String(now)); } catch(e){}
      }
    } catch(e){}
  }
  hb();
  setInterval(hb, 60000);
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) hb(); });
})();`;
