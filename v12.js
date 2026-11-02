// v12 : nouvelles séances de la semaine (fenêtre 7 jours rafraîchie automatiquement + badge « Nouveau »)
(function () {
"use strict";
const NEWMS = 3 * 864e5, KEY = "showSeen";
let SEEN = LS.get(KEY, null), BASE = LS.get("showBase", 0);
if (!SEEN) { SEEN = {}; BASE = Date.now(); LS.set("showBase", BASE); }
const sk = (f, cid, t) => cid + "|" + t.time + "|" + (f.id || norm(f.title));
function track(films) { const now = Date.now(); let added = 0;
  films.forEach(f => (f.by || []).forEach(b => b.c && (b.times || []).forEach(t => { const k = sk(f, b.c.id, t); if (!SEEN[k]) { SEEN[k] = now; added++; } })));
  const cut = new Date(Date.now() - 864e5).toISOString().slice(0, 16); Object.keys(SEEN).forEach(k => { if (k.split("|")[1] < cut) delete SEEN[k]; });
  try { LS.set(KEY, SEEN); } catch (e) { SEEN = {}; } return added; }
const isNew = (f, c, t) => { const s = SEEN[sk(f, c.id, t)]; return !!s && s - BASE > 36e5 && Date.now() - s < NEWMS; };
window.isNewShow = isNew;
// badge sur les horaires
const oTB = timeBtn; timeBtn = function (f, c, t, now) { const h = oTB.apply(this, arguments); return isNew(f, c, t) ? h.replace(/<\/button>\s*$/, `<span class="tnew">Nouveau</span></button>`) : h; };
const oLD = loadData; loadData = async function () { const r = await oLD.apply(this, arguments); if (track(FILMS)) renderShows(view()); return r; };
// fenêtre de 7 jours chargée en arrière-plan, pour l'Accueil
const WEEKF = {films: [], at: 0, err: ""};
window.WEEKF = WEEKF;
async function loadWeek() {
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i); return ymd(d); });
  const ids = scopeIds(), q = ids && ids.length ? "?ids=" + encodeURIComponent(ids.join(",")) : "";
  const by = {}; let ok = 0;
  for (const d of days) { try { const x = await fetch("/allocine-all/" + d + q).then(j); ok++;
      Object.entries(x.cinemas || {}).forEach(([cid, films]) => { const c = byId(cid); if (!c || !films) return;
        films.forEach(f => { const k = f.id || norm(f.title); const F = by[k] ||= {...f, times: [], by: []}; F.times.push(...f.times); const ex = F.by.find(b => b.c === c); ex ? ex.times.push(...f.times) : F.by.push({c, times: [...f.times]}); }); }); } catch (e) {} }
  if (!ok) { WEEKF.err = "Allociné indisponible pour le moment : nouvelles séances bientôt."; return; }
  WEEKF.films = Object.values(by).map(classify); WEEKF.at = Date.now(); WEEKF.err = ""; track(WEEKF.films);
  if (document.querySelector("#v-home.on") && window.cineRefresh) cineRefresh();
}
window.newWeek = () => WEEKF.films.map(f => { let n = 0; f.by.forEach(b => b.times.forEach(t => isNew(f, b.c, t) && n++)); return [f, n]; }).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
setTimeout(loadWeek, 15000);
(function first(n) { if (FILMS.length) { if (track(FILMS)) renderShows(view()); } else if (n < 60) setTimeout(() => first(n + 1), 1000); })(0);
// rafraîchissement auto : toutes les 30 min quand l'app est visible, et au changement de jour (nouveaux jours)
let DAY0 = ymd(new Date()), LAST = Date.now();
function tick() { if (document.hidden) return; if (ymd(new Date()) !== DAY0) { location.reload(); return; }
  if (Date.now() - LAST > 30 * 6e4) { LAST = Date.now(); loadData(); loadWeek(); } }
setInterval(tick, 6e4); document.addEventListener("visibilitychange", tick);
})();
