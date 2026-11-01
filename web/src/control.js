import * as prefs from './settings.js';
const $ = s => document.querySelector(s);
let settings = prefs.load(), toastTimer;
function toast(t) { $('#toast').textContent = t; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4000); }
function commit() { prefs.save(settings); prefs.applyDocument(settings); }

// Back: return to the game tab that opened us, if there is one, instead of opening a second game.
$('#back').onclick = e => {
  try { if (window.opener && !window.opener.closed && window.opener.location.pathname.startsWith('/whaleship')) { e.preventDefault(); window.opener.focus(); window.close(); } } catch {}
};

// Settings
for (const key of ['master', 'effects', 'ambient', 'music']) {
  const el = $('#' + key + '-volume'); el.value = Math.round(settings[key] * 100);
  el.oninput = () => { settings[key] = Number(el.value) / 100; commit(); };
}
for (const [id, key] of [['fast-animation', 'fast'], ['reduced-motion', 'reduced'], ['high-contrast', 'contrast'], ['manual', 'manual'], ['confirm', 'confirm']]) {
  const el = $('#' + id); el.checked = !!settings[key];
  el.onchange = () => { settings[key] = el.checked; commit(); };
}
$('#font-size').value = settings.font;
$('#font-size').onchange = () => { settings.font = Number($('#font-size').value); commit(); };
prefs.applyDocument(settings);

// Captain
(async () => {
  try {
    const r = await fetch('./api/profile'); if (!r.ok) throw Error(); const profile = await r.json();
    const input = $('#captain-name');
    if (profile.authenticated) { input.value = profile.name; input.disabled = true; $('#identity-note').textContent = 'Fridge account recognized. Results use this account.'; }
    else { input.value = prefs.callsign() || profile.name; $('#identity-note').textContent = 'Guest captain. Stats stay with this browser; no account required.'; }
  } catch { $('#identity-note').textContent = 'Harbor unreachable; callsign is saved locally.'; $('#captain-name').value = prefs.callsign(); }
})();
$('#captain-name').onchange = () => { prefs.setCallsign($('#captain-name').value.trim()); toast('Callsign saved. Used for your next match.'); };

// Join by invitation: hand it to the open game tab, or open the game with it.
$('#join-form').onsubmit = e => {
  e.preventDefault();
  const v = $('#invite-input').value.trim();
  let id = null; try { id = new URLSearchParams(new URL(v, location.href).hash.slice(1)).get('join'); } catch {}
  if (!id && /^[a-f0-9]{32}$/.test(v)) id = v;
  if (!id || !/^[a-f0-9]{32}$/.test(id)) { toast('That invitation is not valid. Paste the complete copied link.'); return; }
  try { if (window.opener && !window.opener.closed) { window.opener.location.hash = 'join=' + id; window.opener.focus(); window.close(); return; } } catch {}
  location.href = './#join=' + id;
};

// Ranks
async function ranks() {
  const body = $('#rank-body'); body.replaceChildren(); $('#rank-empty').hidden = false; $('#rank-empty').textContent = 'Reading the admiralty records…';
  try {
    const r = await fetch(`./api/leaderboard?mode=${$('#rank-mode').value}&period=${$('#rank-period').value}`); if (!r.ok) throw Error();
    const rows = await r.json();
    $('#rank-empty').textContent = rows.length ? '' : 'No deployments recorded in this category yet.'; $('#rank-empty').hidden = rows.length > 0;
    rows.forEach(row => { const tr = document.createElement('tr');
      ['rank','name','games','wins','losses','forfeit_wins','win_percentage','accuracy','ships_sunk','streak','longest_streak'].forEach(key => {
        const td = document.createElement('td'); td.textContent = ['win_percentage','accuracy'].includes(key) ? Number(row[key]).toFixed(1) + '%' : row[key]; tr.append(td); });
      body.append(tr); });
  } catch { $('#rank-empty').textContent = 'Records unavailable. Try again shortly.'; }
}
$('#rank-mode').onchange = ranks; $('#rank-period').onchange = ranks; ranks();

// Harbor status
async function metrics() {
  try { const j = await (await fetch('./api/metrics')).json();
    $('#infra-status').textContent = `Infrastructure: ${j.status}`; $('#service-light').classList.toggle('online', j.status === 'operational');
    $('#deployments').textContent = j.infrastructure.active_workers === undefined ? 'Worker metrics unavailable' : `${j.infrastructure.active_workers} / ${j.infrastructure.max_workers} active deployments`;
  } catch { $('#infra-status').textContent = 'Infrastructure: unreachable'; }
}
metrics(); setInterval(() => { if (!document.hidden) metrics(); }, 30000);
