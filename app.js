"use strict";
/* Ciné IDF – séances via la méthode AllocineAPI (proxy /allocine*) */
const CINES = (window.CINEMAS || []).map(c => ({...c, dep: c.dep || depOf(c.zip)}));
function depOf(z) { return ({"75":"Paris","77":"Seine-et-Marne","78":"Yvelines","91":"Essonne","92":"Hauts-de-Seine","93":"Seine-Saint-Denis","94":"Val-de-Marne","95":"Val-d'Oise"})[String(z||"").slice(0,2)] || ""; }
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const j = r => { if (!r.ok) throw new Error(r.status); return r.json(); };
const ymd = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0,10); };
const byId = id => CINES.find(c => c.id === id);
const LS = {get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v))};
const TYPE = {pathe: "Pathé", partner: "Partenaire CinéPass", other: "Cinéma"};
const rt = r => { const m = String(r||"").match(/(\d+)h\s*(\d+)?/); return m ? +m[1]*60 + +(m[2]||0) : 0; };
const km = (a, b) => { const R = 6371, d1 = (b.lat-a.lat)*Math.PI/180, d2 = (b.lng-a.lng)*Math.PI/180; const x = Math.sin(d1/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(d2/2)**2; return 2*R*Math.asin(Math.sqrt(x)); };

// ---------- Letterboxd, listes, alertes ----------
let LB = LS.get("lb", {user: "", seen: [], watch: [], at: 0}), LISTS = {towatch: [], seen: [], rewatch: [], ...LS.get("lists", {})}, ALERTS = LS.get("alerts", {ap: true, watch: true, fav: true});
let LBIDX = null, EXTRA = LS.get("extra", {});
function lbIndex() {
  if (LBIDX) return LBIDX; const mk = arr => { const m = new Map(); (arr || []).forEach(x => { const k = lbKey(x.n); if (!m.has(k)) m.set(k, []); m.get(k).push(x.y); }); return m; };
  return LBIDX = {seen: mk(LB.seen), watch: mk(LB.watch)};
}
const lbKey = t => norm(String(t).replace(/&/g, " and ").replace(/\bet\b/g, "and")).replace(/^(the|le|la|les|l|a|an|un|une) /, "").replace(/ (part|partie|chapitre|chapter) /g, " ").replace(/\b(ii|2)\b/g, "2").replace(/\b(iii|3)\b/g, "3").replace(/ /g, "");
function lbHas(map, f) {
  for (const t of [f.title, f.originalTitle]) { if (!t) continue;
    for (const k of [lbKey(t), lbKey(String(t).split(/ ?[:–-] /)[0])]) { const ys = map.get(k);
      if (ys && ys.some(y => !y || !f.year || Math.abs(y - f.year) <= 1)) return true; } }
  return false;
}
const lbCache = new Map();
function lbState(f) {
  const key = f.id + "|" + (LB.at || 0) + "|" + LISTS.seen.length; if (lbCache.has(key)) return lbCache.get(key);
  const I = lbIndex(); const r = {seen: lbHas(I.seen, f) || inList("seen", f), watch: lbHas(I.watch, f)}; lbCache.set(key, r); return r;
}
async function loadLB(force) {
  if (!LB.user) return;
  if (!force && Date.now() / 1000 - (LB.at || 0) < 6 * 3600 && LB.seen.length + LB.watch.length) return;
  try { const x = await fetch("/letterboxd/" + encodeURIComponent(LB.user)).then(async r => { const y = await r.json(); if (!r.ok) throw new Error(y.error || "Erreur"); return y; });
    const keepCsv = (LB.csvSeen || []), keepCsvW = (LB.csvWatch || []);
    LB = {...LB, seen: [...x.seen, ...keepCsv], watch: [...x.watch, ...keepCsvW], at: x.at, partial: x.partial, liked: x.liked || [], err: ""}; }
  catch (e) { LB.err = e.message; toast(e.message); }
  LS.set("lb", LB); LBIDX = null; lbCache.clear(); if (FILMS.length) renderAll();
  const st = $("#lbstat"); if (st) st.innerHTML = lbStatus();
}
const lbStatus = () => LB.user ? `${LB.err ? "⚠️ " + esc(LB.err) + " · " : ""}<b>${LB.seen.length}</b> films vus · <b>${LB.watch.length}</b> en watchlist${LB.partial ? " (journal récent uniquement : importez votre export CSV pour tout l’historique)" : ""}` : "Non relié";
window.lbBlock = () => `<div class="lbbox"><h3>🟢 Letterboxd</h3><p class="sub">Reliez votre profil public : les films déjà vus apparaissent grisés, ceux de votre watchlist avec un badge vert.</p>
  <form onsubmit="lbLink(event)" class="row"><input id="lbuser" placeholder="Nom d’utilisateur Letterboxd" value="${esc(LB.user)}" autocapitalize="off" aria-label="Nom d’utilisateur Letterboxd"><button class="primary">${LB.user ? "Mettre à jour" : "Relier"}</button>${LB.user ? `<button type="button" class="ghost" onclick="lbUnlink()">Délier</button>` : ""}</form>
  <p class="sub" id="lbstat">${lbStatus()}</p>
  <label class="sub">Ou importez votre export Letterboxd (Réglages → Data → Export : watched.csv, watchlist.csv, diary.csv) : <input type="file" accept=".csv" multiple onchange="lbCsv(this.files)"></label></div>`;
window.lbLink = async e => { e.preventDefault(); const raw = $("#lbuser").value.trim(); if (!raw) return;
  if (/^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(raw)) { $("#lbstat").innerHTML = "⚠️ Entrez votre <b>nom d’utilisateur</b> Letterboxd (celui de l’adresse letterboxd.com/<i>nom</i>), pas votre e-mail."; return; }
  const u = raw.replace(/^.*letterboxd\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "").toLowerCase(); if (!u) return;
  LB = {...LB, user: u, at: 0}; $("#lbstat").textContent = "Chargement de votre profil Letterboxd…"; LS.set("lb", LB); sync(); await loadLB(true); };
window.lbUnlink = () => { LB = {user: "", seen: [], watch: [], at: 0}; LS.set("lb", LB); LBIDX = null; lbCache.clear(); sync(); renderAll(); openAcct(); };
window.lbCsv = async files => {
  for (const file of files) { const txt = await file.text(); const rows = txt.split(/\r?\n/).map(l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map(x => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')) || []);
    const h = rows.shift() || []; const ni = h.indexOf("Name"), yi = h.indexOf("Year"); if (ni < 0) continue;
    const items = rows.filter(r => r[ni]).map(r => ({n: r[ni], y: +r[yi] || null, s: ""}));
    if (/watchlist/i.test(file.name)) { LB.csvWatch = items; LB.watch = [...LB.watch, ...items]; } else { LB.csvSeen = [...(LB.csvSeen || []), ...items]; LB.seen = [...LB.seen, ...items]; } }
  LB.at = LB.at || Math.floor(Date.now() / 1000); LS.set("lb", LB); LBIDX = null; lbCache.clear(); renderAll(); const st = $("#lbstat"); if (st) st.innerHTML = lbStatus(); toast("Export Letterboxd importé");
};
window.alertBlock = () => `<div class="lbbox"><h3>🔔 Alertes</h3><p class="sub">Affichées à l’ouverture de l’app (et en notification si vous l’autorisez).</p>
  ${[["ap", "Avant-premières et séances spéciales dans mes cinémas favoris"], ["watch", "Films de ma watchlist Letterboxd / « À voir » à l’affiche"], ["fav", "Nouveautés près de moi"]].map(([k, l]) => `<label class="sub" style="display:block"><input type="checkbox" ${ALERTS[k] ? "checked" : ""} onchange="ALERTS['${k}']=this.checked;LS.set('alerts',ALERTS);sync()"> ${l}</label>`).join("")}
  <button class="ghost" onclick="askNotif()">Activer les notifications</button></div>`;
window.askNotif = async () => { if (!("Notification" in window)) return toast("Notifications non disponibles sur ce navigateur"); const p = await Notification.requestPermission(); toast(p === "granted" ? "Notifications activées" : "Notifications refusées"); };
const listItem = f => ({id: String(f.id), title: f.title, poster: f.poster || "", year: String(f.year || ""), at: new Date().toISOString().slice(0, 10)});
const inList = (k, f) => LISTS[k].some(x => x.id === String(f.id));
const myList = f => inList("rewatch", f) ? "🔁 À revoir" : inList("towatch", f) ? "📌 À voir" : "";
window.toggleList = (k, id) => { const f = FILMS.find(x => String(x.id) === String(id)); if (!f) return;
  LISTS[k] = inList(k, f) ? LISTS[k].filter(x => x.id !== String(f.id)) : [...LISTS[k], listItem(f)]; LS.set("lists", LISTS); lbCache.clear(); sync(); openFilm(id); renderAll(); };
function renderLists() {
  const names = {towatch: "📌 À voir", seen: "✓ Vu (historique)", rewatch: "🔁 À revoir"};
  $("#lists").innerHTML = Object.entries(names).map(([k, n]) => `<h3 style="color:var(--gold2)">${n} (${LISTS[k].length}) ${LISTS[k].length ? `<button class="ghost" style="padding:3px 10px;font-size:12px" onclick="shareList('${k}')">Partager</button>` : ""}</h3>
    <div class="rail" style="padding-left:0">${LISTS[k].slice().reverse().map(x => `<div class="poster${k === "seen" ? " seen" : ""}" style="cursor:default"><div class="im">${x.poster ? `<img src="${esc(x.poster)}" alt="Affiche de ${esc(x.title)}" loading="lazy">` : ""}</div><h3>${esc(x.title)}</h3><small>${esc(x.year)} · ajouté le ${esc(x.at)}</small> <button class="ghost" style="padding:2px 8px;font-size:11px" aria-label="Retirer ${esc(x.title)}" onclick="LISTS['${k}']=LISTS['${k}'].filter(y=>y.id!=='${esc(x.id)}');LS.set('lists',LISTS);sync();renderLists()">✕</button></div>`).join("") || `<p class="sub">Vide.</p>`}</div>`).join("");
}
window.shareList = async k => { const txt = `Ma liste Ciné IDF « ${{towatch: "À voir", seen: "Vu", rewatch: "À revoir"}[k]} » :\n` + LISTS[k].map(x => `• ${x.title}${x.year ? " (" + x.year + ")" : ""}`).join("\n") + "\nhttps://cine-idf.onrender.com";
  try { if (navigator.share) await navigator.share({text: txt}); else { await navigator.clipboard.writeText(txt); toast("Liste copiée"); } } catch (e) {} };
function recommend(V) {
  const watch = V.filter(f => lbState(f).watch || inList("towatch", f) || inList("rewatch", f));
  const liked = [...LISTS.seen, ...LISTS.towatch].map(x => FILMS.find(f => String(f.id) === x.id)).filter(Boolean);
  const gs = {}; liked.concat(watch).forEach(f => (f.genres || []).forEach(g => gs[g] = (gs[g] || 0) + 1));
  const more = Object.keys(gs).length ? V.filter(f => !watch.includes(f) && !lbState(f).seen).map(f => [f, (f.genres || []).reduce((a, g) => a + (gs[g] || 0), 0) + (+f.rating || 0)]).filter(x => x[1] > 3).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]) : [];
  return [...watch, ...more];
}
const gcal = (f, c, t) => { const s = new Date(t.time), e = new Date(s.getTime() + ((f.dur || 120) + 15) * 60000), z = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(f.title + " (" + (t.version || "").toUpperCase() + ")") + "&dates=" + z(s) + "/" + z(e) + "&location=" + encodeURIComponent(c.name + ", " + (c.fullAddress || c.address || "")) + "&details=" + encodeURIComponent("Réserver : " + (t.url || c.website || "")); };
async function filmExtras(f) {
  try { const x = await fetch("/film-extra/" + f.id).then(j); if (!document.querySelector("#trailer")) return;
    if (x.trailer) $("#trailer").innerHTML = `<div class="trailer"><iframe src="${esc(x.trailer)}" title="Bande-annonce de ${esc(f.title)}" allowfullscreen loading="lazy"></iframe></div>`;
    if ((x.photos || []).length) $("#photos").innerHTML = `<h3 style="color:var(--gold2)">Photos</h3><div class="rail photos" style="padding-left:0">${x.photos.map(p => `<img src="${esc(p)}" alt="Photo du film ${esc(f.title)}" loading="lazy">`).join("")}</div>`;
  } catch (e) {}
}
function checkAlerts() {
  const out = [], seenKey = LS.get("alertSeen", {}), today = ymd(new Date());
  if (ALERTS.ap) FILMS.filter(f => f.cl.ap || f.cl.special.length).forEach(f => f.by.filter(b => FAVS.has(b.c.id)).forEach(b => out.push(`✨ ${f.title} — ${f.cl.ap ? "avant-première" : f.cl.special[0]} à ${b.c.name}`)));
  if (ALERTS.watch) FILMS.filter(f => lbState(f).watch || inList("towatch", f)).forEach(f => out.push(`💚 ${f.title} (votre liste) est à l’affiche dans ${f.by.length} cinéma(s)`));
  if (ALERTS.fav && GEO) FILMS.filter(f => f.cl.fresh && f.by.some(b => (dist(b.c) ?? 99) < 5)).slice(0, 3).forEach(f => out.push(`🆕 ${f.title} : nouveauté à moins de 5 km`));
  const uniq = [...new Set(out)].slice(0, 6);
  $("#alerts").innerHTML = uniq.length ? `<details class="alertbox"><summary>🔔 ${uniq.length} alerte(s) pour vous</summary><ul>${uniq.map(a => `<li>${esc(a)}</li>`).join("")}</ul></details>` : "";
  const fresh = uniq.filter(a => !seenKey[a]); if (fresh.length && "Notification" in window && Notification.permission === "granted") { try { new Notification("Ciné IDF", {body: fresh.slice(0, 3).join("\n"), icon: "icon-192.png"}); } catch (e) {} }
  fresh.forEach(a => seenKey[a] = today); LS.set("alertSeen", seenKey);
}

window.shareFilm = async id => { const f = FILMS.find(x => String(x.id) === String(id)); const url = location.origin + "/film/" + id;
  try { if (navigator.share) await navigator.share({title: f?.title, url}); else { await navigator.clipboard.writeText(url); toast("Lien copié"); } } catch (e) {} };
// ---------- Thème ----------
if (LS.get("theme", "dark") === "light") document.body.classList.add("light");
const setThemeBtn = () => { $("#theme").textContent = document.body.classList.contains("light") ? "🌙" : "☀️"; };
setThemeBtn();
$("#theme").onclick = () => { document.body.classList.toggle("light"); LS.set("theme", document.body.classList.contains("light") ? "light" : "dark"); setThemeBtn(); };

// ---------- Navigation ----------
function go(v) {
  $$("nav button").forEach(x => { const on = x.dataset.v === v; x.classList.toggle("on", on); on ? x.setAttribute("aria-current", "page") : x.removeAttribute("aria-current"); });
  $$(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  if (v === "map") setTimeout(() => map.invalidateSize(), 60);
  if (v === "billets") { renderTickets(); renderLists(); }
  scrollTo(0, 0);
}
$$("nav button").forEach(b => b.onclick = () => go(b.dataset.v));

// ---------- Comptes, favoris, billets (local + serveur) ----------
let TOKEN = LS.get("cineToken", ""), EMAIL = LS.get("cineEmail", "");
let FAVS = new Set(LS.get("favs", [])), TICKETS = LS.get("tickets", []), GAME = LS.get("game", {});
const post = (p, b) => fetch(p, {method: "POST", headers: {"Content-Type": "application/json", ...(TOKEN ? {Authorization: "Bearer " + TOKEN} : {})}, body: JSON.stringify(b || {})})
  .then(async r => { const x = await r.json().catch(() => ({})); if (!r.ok) throw new Error(x.error || "Erreur " + r.status); return x; });
function saveLocal() { LS.set("favs", [...FAVS]); LS.set("tickets", TICKETS); updAcct(); }
function updAcct() { $("#acct").textContent = EMAIL ? "👤 " + EMAIL.split("@")[0] + " · ⭐" + FAVS.size : "👤 Connexion"; }
const profileData = () => ({favs: [...FAVS], tickets: TICKETS, lb: LB.user || "", lists: LISTS, alerts: ALERTS, extra: EXTRA, game: GAME});
async function restore() { // session persistante : reconstitue le compte si le serveur l'a perdu (redéploiement)
  try { const x = await post("/api/restore", {email: EMAIL, restore: LS.get("cineRestore", null), data: profileData()}); applyProfile(x, true); return true; } catch (e) { return false; } }
async function sync() { saveLocal(); if (!TOKEN) return; try { applyProfile(await post("/api/favs", profileData()), false); }
  catch (e) { if (/Session/.test(e.message) && await restore()) { try { await post("/api/favs", profileData()); } catch (_) {} } } }
function applyProfile(x, merge) {
  if (x.restore) LS.set("cineRestore", x.restore);
  if (merge) { (x.favs || []).forEach(f => FAVS.add(f)); const seen = new Set(TICKETS.map(t => t.id)); (x.tickets || []).forEach(t => seen.has(t.id) || TICKETS.push(t));
    for (const k of ["towatch", "seen", "rewatch"]) { const ids = new Set(LISTS[k].map(i => i.id)); ((x.lists || {})[k] || []).forEach(i => ids.has(i.id) || LISTS[k].push(i)); }
    if (x.lb && !LB.user) { LB.user = x.lb; LS.set("lb", LB); loadLB(); } Object.assign(ALERTS, x.alerts || {}); EXTRA = {...(x.extra || {}), ...EXTRA}; LS.set("extra", EXTRA); if (x.game && (x.game.xp || 0) > (GAME.xp || 0)) { GAME = x.game; LS.set("game", GAME); } }
  else { FAVS = new Set(x.favs || []); TICKETS = x.tickets || TICKETS; if (x.lists && Object.keys(x.lists).length) LISTS = {towatch: [], seen: [], rewatch: [], ...x.lists}; if (x.game && (x.game.xp || 0) >= (GAME.xp || 0)) { GAME = x.game; LS.set("game", GAME); } }
  LS.set("lists", LISTS); LS.set("alerts", ALERTS); saveLocal(); }
function onAuth(x) {
  TOKEN = x.token || TOKEN; EMAIL = x.email; LS.set("cineToken", TOKEN); LS.set("cineEmail", EMAIL);
  applyProfile(x, true); sync(); refreshCines(); renderAll && FILMS.length && renderAll();
}
function logoutLocal() { TOKEN = EMAIL = ""; LS.set("cineToken", ""); LS.set("cineEmail", ""); updAcct(); }
let AMODE = "signup", PENDING = null;
window.openAcct = msg => {
  if (EMAIL) {
    const L = [...FAVS].map(byId).filter(Boolean);
    modal(`<div class="auth"><h2>Mon compte</h2><p class="sub">${esc(EMAIL)} · favoris et billets synchronisés sur tous vos appareils.</p><h3>⭐ Mes cinémas favoris (${L.length})</h3>
      <div>${L.map(c => `<button class="chip" onclick="openCine('${c.id}')">${esc(c.name)}</button>`).join("") || `<p class="sub">Aucun favori : ouvrez la fiche d’un cinéma et touchez « Ajouter aux favoris ».</p>`}</div>
      ${lbBlock()}${alertBlock()}
      <div class="row"><button class="primary" onclick="favSeances()">Séances de mes favoris</button><button class="ghost" onclick="logout()">Se déconnecter</button></div><p class="sub">Vous restez connecté sur cet appareil jusqu’à « Se déconnecter ».</p></div>`);
  } else {
    modal(`<div class="auth"><h2>Mon compte Ciné IDF</h2><p class="sub">${esc(msg || "Créez un compte pour synchroniser vos cinémas favoris et vos billets sur tous vos appareils. Sans compte, ils restent enregistrés sur cet appareil.")}</p>
      <div class="tabs" role="tablist"><button id="tsu" class="primary" onclick="authMode('signup')">Créer un compte</button><button id="tli" class="ghost" onclick="authMode('login')">Se connecter</button></div>
      <form onsubmit="doAuth(event)"><label class="sub" for="aemail">E-mail</label><input id="aemail" type="email" autocomplete="email" required><label class="sub" for="apw">Mot de passe (6 caractères min.)</label><input id="apw" type="password" autocomplete="new-password" required minlength="6">
      <div class="err" id="aerr" role="alert"></div><button class="primary" style="width:100%" id="asub">Créer mon compte</button></form>${lbBlock()}</div>`);
    AMODE = "signup";
  }
};
$("#acct").onclick = () => openAcct();
window.authMode = m => { AMODE = m; $("#tsu").className = m === "signup" ? "primary" : "ghost"; $("#tli").className = m === "login" ? "primary" : "ghost"; $("#asub").textContent = m === "signup" ? "Créer mon compte" : "Se connecter"; $("#apw").autocomplete = m === "signup" ? "new-password" : "current-password"; };
window.doAuth = async e => { e.preventDefault(); $("#aerr").textContent = "";
  try { onAuth(await post("/api/" + AMODE, {email: $("#aemail").value, password: $("#apw").value})); if (PENDING) { const f = PENDING; PENDING = null; return f(); } openAcct(); }
  catch (err) { $("#aerr").textContent = err.message; } };
window.logout = async () => { try { await post("/api/logout"); } catch (e) {} logoutLocal(); LS.set("cineRestore", null); closeModal(); };
window.toggleFav = id => { FAVS.has(id) ? FAVS.delete(id) : FAVS.add(id); sync(); refreshCines(); openCine(id); };
window.favSeances = () => { closeModal(); go("seances"); $("#scope").value = "fav"; loadData(); };

// ---------- Modales ----------
function modal(html) { $("#mcontent").innerHTML = html; $("#modal").classList.remove("hidden"); setTimeout(() => $("#modal .x").focus(), 30); }
window.closeModal = () => { $("#modal").classList.add("hidden"); $("#mcontent").innerHTML = ""; };
window.closeSheet = () => $("#sheet").classList.add("hidden");
$("#modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
$("#sheet").onclick = e => { if (e.target.id === "sheet") closeSheet(); };
addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#sheet").classList.contains("hidden")) closeSheet(); else closeModal(); $("#gres").classList.add("hidden"); } });

// ---------- Jours ----------
const DAYS = [...Array(14)].map((_, i) => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate() + i); return d; });
let SELDATES = [ymd(DAYS[0])], APONLY = false, TONIGHT = false, GRID = LS.get("grid", false);
const fmtDay = d => new Date(d + "T12:00").toLocaleDateString("fr-FR", {weekday: "long", day: "numeric", month: "long"});
function renderDates() {
  $("#dates").innerHTML = DAYS.map((d, i) => { const k = ymd(d); return `<button role="tab" aria-selected="${SELDATES.includes(k)}" data-d="${k}" class="${SELDATES.length === 1 && SELDATES[0] === k ? "on" : ""}">${i === 0 ? "Auj." : i === 1 ? "Demain" : d.toLocaleDateString("fr-FR",{weekday:"short"})}<b>${d.getDate()}</b>${d.toLocaleDateString("fr-FR",{month:"short"})}</button>`; }).join("");
  const t = SELDATES.length > 2 || (SELDATES.length === 2 && new Date(SELDATES[0]+"T12:00").getDay() !== 6) ? `Du <em>${fmtDay(SELDATES[0])}</em> au <em>${fmtDay(SELDATES[SELDATES.length-1])}</em>` : SELDATES.length > 1 ? `Ce week-end · <em>${fmtDay(SELDATES[0])} & ${fmtDay(SELDATES[1])}</em>` : (SELDATES[0] === ymd(DAYS[0]) ? `Aujourd’hui · <em>${fmtDay(SELDATES[0])}</em>` : `<em>${fmtDay(SELDATES[0])}</em>`);
  $(".today").innerHTML = t;
  $$(".qk").forEach(b => b.classList.toggle("on", b.dataset.q === "ap" ? APONLY : b.dataset.q === "today" ? SELDATES.length === 1 && SELDATES[0] === ymd(DAYS[0]) : SELDATES.length > 1));
  $$(".qk[data-q=ap]").forEach(b => b.setAttribute("aria-pressed", APONLY));
  $$(".qk[data-q=tonight]").forEach(b => { b.classList.toggle("on", TONIGHT); b.setAttribute("aria-pressed", TONIGHT); });
  $$(".qk[data-q=tomorrow]").forEach(b => b.classList.toggle("on", SELDATES.length === 1 && SELDATES[0] === ymd(DAYS[1])));
  $(".period").classList.toggle("on", SELDATES.length > 2 || (SELDATES.length === 2 && new Date(SELDATES[0]+"T12:00").getDay() !== 6));
}
$("#dates").onclick = e => { const b = e.target.closest("button"); if (!b) return; SELDATES = [b.dataset.d]; renderDates(); loadData(); };
$(".quick").onclick = e => { const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.q === "today") SELDATES = [ymd(DAYS[0])];
  if (b.dataset.q === "weekend") { const sat = DAYS.find(d => d.getDay() === 6), sun = DAYS.find(d => d.getDay() === 0); SELDATES = DAYS[0].getDay() === 0 ? [ymd(DAYS[0])] : [ymd(sat), ymd(DAYS.find(d => d > sat && d.getDay() === 0) || sun)]; }
  if (b.dataset.q === "ap") { APONLY = !APONLY; renderDates(); return renderAll(); }
  if (b.dataset.q === "tonight") { TONIGHT = !TONIGHT; if (TONIGHT && SELDATES[0] !== ymd(DAYS[0])) { SELDATES = [ymd(DAYS[0])]; renderDates(); loadData(); return; } renderDates(); return renderAll(); }
  if (b.dataset.q === "tomorrow") SELDATES = [ymd(DAYS[1])];
  if (b.closest(".period")) return;
  renderDates(); loadData(); };

// ---------- Géolocalisation ----------
let GEO = LS.get("geo", null);
function locate() { return new Promise((ok, ko) => { if (!navigator.geolocation) return ko(new Error("Géolocalisation indisponible")); navigator.geolocation.getCurrentPosition(p => { GEO = {lat: p.coords.latitude, lng: p.coords.longitude}; LS.set("geo", GEO); ok(GEO); }, e => ko(new Error("Position refusée : autorisez la localisation dans votre navigateur.")), {timeout: 10000, maximumAge: 600000}); }); }
const dist = c => GEO && c.lat != null ? km(GEO, c) : null;
const distTxt = c => { const d = dist(c); return d == null ? "" : ` <small>· ${d < 1 ? Math.round(d*1000) + " m" : d.toFixed(1) + " km"}</small>`; };

// ---------- Données séances ----------
let FILMS = [], FETCHED = 0, LOADING = 0, ERR = "";
function scopeIds() {
  const s = $("#scope").value;
  if (s === "fav") return [...FAVS].filter(id => byId(id)?.allocineId);
  if (s === "near") return CINES.filter(c => c.allocineId && c.lat != null).sort((a, b) => dist(a) - dist(b)).slice(0, 30).map(c => c.id);
  if (s.startsWith("dep:")) return CINES.filter(c => c.allocineId && c.dep === s.slice(4)).sort((a,b) => (a.type === "other") - (b.type === "other")).slice(0, 80).map(c => c.id);
  return null;
}
function skeleton() { const sk = `<div class="sk" aria-hidden="true"><div class="im"></div><i></i></div>`.repeat(8); ["#c-new","#c-sp","#c-retro","#c-all"].forEach(s => $(s).innerHTML = sk); $("#shows").innerHTML = `<div class="empty">Chargement des séances…</div>`; }
async function loadData() {
  const my = ++LOADING; skeleton(); ERR = "";
  if ($("#scope").value === "near" && !GEO) { try { await locate(); } catch (e) { ERR = e.message; $("#scope").value = "core"; } }
  const ids = scopeIds();
  if (ids && !ids.length) { FILMS = []; ERR = $("#scope").value === "fav" ? "Aucun cinéma en favori : ajoutez-en depuis la fiche d’un cinéma (⭐)." : "Aucun cinéma trouvé."; return renderAll(); }
  const q = ids ? "?ids=" + encodeURIComponent(ids.join(",")) : "";
  try {
    const res = await Promise.all(SELDATES.map(d => fetch("/allocine-all/" + d + q).then(j).then(x => ({d, c: x.cinemas}))));
    if (my !== LOADING) return;
    const by = {}; let failed = 0;
    res.forEach(({d, c}) => Object.entries(c).forEach(([cid, films]) => { const cine = byId(cid); if (!films) { failed++; return; } if (!cine) return;
      films.forEach(f => { const k = f.id || norm(f.title); const F = by[k] ||= {...f, times: [], by: []}; F.times.push(...f.times); const ex = F.by.find(x => x.c === cine); ex ? ex.times.push(...f.times) : F.by.push({c: cine, times: [...f.times]}); }); }));
    FILMS = Object.values(by).map(classify); FETCHED = Date.now();
    if (failed) ERR = `Allociné n’a pas répondu pour ${failed} cinéma(s) – les autres séances s’affichent.`;
    LS.set("lastData", {at: FETCHED, dates: SELDATES, films: FILMS.slice(0, 80).map(f => ({...f, by: f.by.map(b => ({cid: b.c.id, times: b.times}))}))});
  } catch (e) {
    if (my !== LOADING) return;
    const L = LS.get("lastData", null);
    if (L) { FILMS = L.films.map(f => ({...f, by: f.by.map(b => ({c: byId(b.cid), times: b.times})).filter(b => b.c)})); FETCHED = L.at; ERR = "Hors ligne ou Allociné indisponible : affichage des dernières séances enregistrées."; }
    else { FILMS = []; ERR = "Impossible de charger les séances (serveur en veille ou Allociné indisponible)."; }
  }
  renderAll(); injectLD();
  if (typeof FILMPATH !== 'undefined' && FILMPATH && !window._fp) { window._fp = 1; openFilm(FILMPATH[1]); }
}
function classify(f) {
  const D = SELDATES[0], Y = +D.slice(0, 4);
  const rel = (f.releases || []).filter(r => r.name === "Released" && r.date).map(r => r.date).sort()[0];
  const evs = new Set(f.times.flatMap(t => t.events || []));
  const ap = !!(f.isPremiere || f.times.some(t => t.preview) || evs.has("Premier") || evs.has("Preview") || (rel && rel > D && (!f.year || f.year >= Y - 1)));
  const special = [...evs].filter(e => !["Premier", "Preview"].includes(e)).map(e => ({Live: "En direct", Opera: "Opéra", Concert: "Concert", Ballet: "Ballet", Marathon: "Marathon"})[e] || "Séance spéciale");
  const retroCines = f.year && f.year < 2026 ? f.by.filter(b => b.c.type !== "pathe") : [];
  const wk = new Date(D + "T12:00"); wk.setDate(wk.getDate() - 7);
  const fresh = !!rel && rel <= D && rel > ymd(wk) && (!f.year || f.year >= Y - 1);
  return {...f, cl: {rel, ap, special, retro: retroCines.length > 0, retroCines, fresh}, dur: rt(f.runtime)};
}
function timeOk(t, f) {
  const v = $("#sver").value, fm = $("#sfmt").value, sp = $("#sspec").value;
  if (v && t.version !== v) return false;
  if (fm && !(t.fmt || []).some(x => x.includes(fm))) return false;
  if (sp === "special" && !(t.events || []).length) return false;
  if (sp === "acc" && !t.acc) return false;
  if (APONLY && !(t.preview || f.cl.ap)) return false;
  if (TONIGHT && new Date(t.time) < new Date()) return false;
  return true;
}
function lev(a, b) { if (Math.abs(a.length - b.length) > 2) return 9; let p = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const c = [i]; for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[b.length]; }
function fuzzy(q, hay) { const H = norm(hay), words = H.split(" ");
  return q.split(" ").every(w => H.includes(w) || (w.length >= 4 && words.some(x => x.length >= 3 && (lev(w, x.slice(0, w.length + 1)) <= (w.length > 6 ? 2 : 1) || lev(w, x) <= (w.length > 6 ? 2 : 1))))); }
window.fuzzy = fuzzy;
function view() {
  const q = norm($("#sfilm").value), age = $("#sage").value, sc = $("#scope").value;
  const g = $("#sgenre").value, du = +$("#sdur").value, ra = +$("#srate").value, lb = $("#slb").value;
  return FILMS.filter(f => (!q || fuzzy(q, [f.title, f.originalTitle, (f.cast||[]).join(" "), f.directors, (f.genres||[]).join(" ")].join(" "))) && (!age || !f.age)
      && (!g || (f.genres||[]).includes(g)) && (!du || (du === 999 ? f.dur > 135 : f.dur && f.dur <= du)) && (!ra || (+f.rating || 0) >= ra)
      && (!lb || (lb === "unseen" ? !lbState(f).seen : lbState(f).watch)))
    .map(f => { const by = f.by.filter(b => sc === "pathe" ? b.c.type === "pathe" : sc === "partner" ? b.c.type === "partner" : true).map(b => ({c: b.c, times: b.times.filter(t => timeOk(t, f))})).filter(b => b.times.length);
      return {...f, vby: by, n: by.reduce((a, b) => a + b.times.length, 0)}; })
    .filter(f => f.n).sort((a, b) => b.n - a.n);
}
function posterCard(f, extra) {
  const t = [f.cl.ap && `<span class="tag g">Avant-première</span>`, f.cl.special[0] && `<span class="tag g">${esc(f.cl.special[0])}</span>`, f.cl.fresh && `<span class="tag">Nouveau</span>`, f.year && f.year < 2026 && f.cl.retro && `<span class="tag">Rétro ${f.year}</span>`].filter(Boolean).join("");
  const L = lbState(f), my = myList(f);
  return `<button class="poster${L.seen ? " seen" : ""}" onclick="openFilm('${f.id}')" aria-label="${esc(f.title)}${L.seen ? " (déjà vu)" : ""}${L.watch ? " (dans ma watchlist)" : ""}">${L.watch ? `<span class="lbw" title="Dans votre watchlist Letterboxd">Watchlist</span>` : ""}${L.seen ? `<span class="lbs">✓ Vu</span>` : my ? `<span class="lbs">${my}</span>` : ""}<div class="im">${f.poster ? `<img src="${esc(f.poster)}" alt="Affiche de ${esc(f.title)}" loading="lazy" decoding="async">` : ""}</div><div class="tags">${t}</div>${f.rating ? `<span class="rating" aria-label="Note spectateurs">★ ${(+f.rating).toFixed(1)}</span>` : ""}<h3>${esc(f.title)}</h3><small>${extra || `${f.vby.length} cinéma${f.vby.length>1?"s":""} · ${f.n} séance${f.n>1?"s":""}`}</small></button>`;
}
function renderAll() {
  const V = view(), none = `<div class="empty">Aucun film pour ces critères.</div>`;
  const rail = (sel, arr, ex) => $(sel).innerHTML = arr.map(f => posterCard(f, ex && ex(f))).join("") || none;
  rail("#c-new", V.filter(f => f.cl.fresh).sort((a, b) => (b.cl.rel||"").localeCompare(a.cl.rel||"") || b.n - a.n), f => "Sortie le " + new Date(f.cl.rel + "T12:00").toLocaleDateString("fr-FR", {day: "numeric", month: "short"}));
  rail("#c-sp", V.filter(f => f.cl.ap || f.cl.special.length));
  rail("#c-retro", V.filter(f => f.year && f.year < 2026 && f.vby.some(b => b.c.type !== "pathe")).sort((a, b) => a.year - b.year), f => `${f.year} · ${f.vby.filter(b => b.c.type !== "pathe").length} cinéma(s) hors Pathé`);
  rail("#c-all", V);
  rail("#c-ev", V.filter(f => f.cl.special.length || f.times.some(t => (t.events||[]).length)));
  const reco = recommend(V); $("#s-reco").hidden = !reco.length; if (reco.length) rail("#c-reco", reco);
  renderShows(V); fresh(); checkAlerts();
  const gsel = $("#sgenre"), cur = gsel.value, gl = [...new Set(FILMS.flatMap(f => f.genres || []))].sort();
  gsel.innerHTML = `<option value="">Tous genres</option>` + gl.map(g => `<option ${g === cur ? "selected" : ""}>${esc(g)}</option>`).join("");
}
let SHOWN = 25;
function renderShows(V) {
  V = V || view(); const now = new Date();
  if (GRID) { $("#shows").innerHTML = `<div class="pgrid">${V.slice(0, SHOWN * 2).map(f => posterCard(f)).join("")}</div>` + (V.length > SHOWN * 2 ? `<div class="pad"><button class="ghost" onclick="SHOWN+=25;renderShows()">Afficher plus</button></div>` : "") || `<div class="empty">Aucune séance.</div>`; return; }
  const html = V.slice(0, SHOWN).map(f => {
    const lines = f.vby.slice().sort((a, b) => (dist(a.c) ?? 0) - (dist(b.c) ?? 0) || a.c.name.localeCompare(b.c.name)).map(({c, times}) => `<div class="cine-line"><b>${FAVS.has(c.id) ? "⭐ " : ""}${esc(c.name)}${distTxt(c)}</b>${times.slice().sort((a,b)=>a.time.localeCompare(b.time)).map(t => timeBtn(f, c, t, now)).join("")}</div>`).join("");
    const L = lbState(f);
    return `<article class="film${L.seen ? " seen" : ""}">${f.poster ? `<img src="${esc(f.poster)}" alt="Affiche de ${esc(f.title)}" loading="lazy" onclick="openFilm('${f.id}')">` : `<div class="noimg"></div>`}<div><h3><a href="#" onclick="openFilm('${f.id}');return false" style="color:inherit;text-decoration:none">${esc(f.title)}</a>${L.watch ? ` <span class="lbw">Watchlist</span>` : ""}${L.seen ? ` <span class="lbs">✓ Vu</span>` : ""}</h3><div class="meta">${meta(f)}</div>${lines}</div></article>`;
  }).join("");
  $("#shows").innerHTML = (html || `<div class="empty">${esc(ERR || "Aucune séance pour ces critères.")}</div>`) + (V.length > SHOWN ? `<div class="pad"><button class="ghost" onclick="SHOWN+=25;renderShows()">Afficher plus de films (${V.length - SHOWN})</button></div>` : "");
}
window.renderShows = renderShows;
const meta = f => [f.cl.ap && "✨ Avant-première", f.year && f.year < 2026 ? "Film de " + f.year : "", (f.genres||[]).slice(0,3).join(", "), f.runtime, f.age, f.rating && `★ ${(+f.rating).toFixed(1)} spectateurs`, f.press && `${(+f.press).toFixed(1)} presse`].filter(Boolean).map(esc).join(" · ");
const TB = {};
function timeBtn(f, c, t, now) {
  const k = Math.random().toString(36).slice(2, 9); TB[k] = {f, c, t};
  const past = new Date(t.time) < now; const fx = (t.fmt || []).concat((t.events||[]).length ? ["★"] : []);
  const cpOn = EXTRA.cp && EXTRA.cp.on && c.cinepass, prem = (t.fmt || []).some(x => /IMAX|4DX|ScreenX|Dolby|3D|Onyx/.test(x)), here = TICKETS.some(x => x.fid == f.id && x.cid === c.id && x.time < new Date().toISOString());
  return `<button class="t${past ? " past" : ""}${cpOn ? (prem ? " cpx" : " cp") : ""}" title="${cpOn ? (prem ? "CinéPass + supplément format" : "Inclus dans votre CinéPass") : ""}${here ? " · déjà vu ici" : ""}" onclick="openTime('${k}')" aria-label="${t.time.slice(11,16)} ${t.version} ${esc(c.name)}"><b>${t.time.slice(11,16)}</b><small class="pill${t.version === "vo" ? " vo" : ""}">${t.version === "vo" ? "VOST" : esc((t.version||"").toUpperCase())}${t.acc ? " ♿" : ""}</small>${here ? `<span class="fx">👁 déjà vu ici</span>` : ""}${fx.length ? `<span class="fx">${esc(fx.join(" "))}</span>` : ""}</button>`;
}
function fresh() {
  const m = FETCHED ? Math.round((Date.now() - FETCHED) / 60000) : null;
  $("#fresh").innerHTML = (FETCHED ? `Source Allociné · mis à jour ${m < 1 ? "à l’instant" : `il y a ${m} min`} · ` : "") + (ERR ? `⚠️ ${esc(ERR)} <button class="ghost" style="padding:2px 8px" onclick="loadData()">Réessayer</button>` : "Places restantes : voir sur le site de réservation.");
}
setInterval(fresh, 60000);
["#sfilm"].forEach(s => $(s).oninput = () => { SHOWN = 25; renderAll(); });
["#sver", "#sfmt", "#sspec", "#sage", "#sgenre", "#sdur", "#srate", "#slb"].forEach(s => $(s).onchange = () => { SHOWN = 25; renderAll(); });
$("#scope").onchange = () => { SHOWN = 25; loadData(); };

// ---------- Séance : réserver, billet, agenda ----------
window.openTime = k => { const {f, c, t} = TB[k]; const when = new Date(t.time);
  $("#sheetc").innerHTML = `<div class="sheet"><h2 style="margin:0">${esc(f.title)}</h2><p class="sub">${esc(c.name)} · ${when.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})} à ${t.time.slice(11,16)} · ${esc((t.version||"").toUpperCase())} ${esc((t.fmt||[]).join(" "))}</p>
   <a class="primary" style="display:block;padding:12px;border-radius:10px;color:#141414" href="${esc(t.url || c.website || "#")}" target="_blank" rel="noopener">🎟️ Réserver / choisir ma place</a>
   <button class="ghost" onclick="addTicket('${k}')">＋ Ajouter à mes billets</button><a class="ghost" href="${gcal(f, c, t)}" target="_blank" rel="noopener">📅 Google Agenda</a><button class="ghost" onclick="ics('${k}')">🍎 Apple / Outlook (.ics)</button><button class="ghost" onclick="closeSheet()">Fermer</button></div>`;
  $("#sheet").classList.remove("hidden"); };
window.addTicket = k => { const {f, c, t} = TB[k]; const id = f.id + "|" + c.id + "|" + t.time; if (!TICKETS.some(x => x.id === id)) TICKETS.push({id, fid: String(f.id), cid: c.id, title: f.title, poster: f.poster || "", cinema: c.name, time: t.time, url: t.url || c.website || "", version: (t.version||"").toUpperCase()}); sync(); closeSheet(); toast("Ajouté à « Mes billets »"); };
window.ics = k => { const {f, c, t} = TB[k]; const s = new Date(t.time), e = new Date(s.getTime() + ((f.dur || 120) + 15) * 60000);
  const z = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const txt = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Cine IDF//FR","BEGIN:VEVENT","UID:" + Date.now() + "@cine-idf","DTSTAMP:" + z(new Date()),"DTSTART:" + z(s),"DTEND:" + z(e),"SUMMARY:" + f.title + " (" + (t.version||"").toUpperCase() + ")","LOCATION:" + c.name + ", " + (c.fullAddress || c.address || ""),"URL:" + (t.url || ""),"END:VEVENT","END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], {type: "text/calendar"})); a.download = "seance.ics"; a.click(); };
function toast(m) { const d = document.createElement("div"); d.textContent = m; d.setAttribute("role", "status"); d.style.cssText = "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:linear-gradient(135deg,#f1d784,#c9a227);color:#141414;padding:10px 16px;border-radius:20px;font-weight:700;z-index:3000"; document.body.append(d); setTimeout(() => d.remove(), 2200); }
function renderTickets() {
  const L = TICKETS.slice().sort((a, b) => a.time.localeCompare(b.time)), now = new Date().toISOString().slice(0, 16);
  $("#tickets").innerHTML = L.map(t => `<a class="ticket" href="${esc(t.url || "#")}" target="_blank" rel="noopener" style="${t.time.slice(0,16) < now ? "opacity:.5" : ""}">${t.poster ? `<img src="${esc(t.poster)}" alt="Affiche de ${esc(t.title)}" loading="lazy">` : `<img alt="">`}<div><div class="when">${new Date(t.time).toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})} · ${t.time.slice(11,16)}</div><h3>${esc(t.title)}</h3><p>${esc(t.cinema)} · ${esc(t.version)}</p><p>Toucher pour ouvrir la réservation / ma place →</p></div><button class="rm" aria-label="Retirer ce billet" onclick="event.preventDefault();event.stopPropagation();rmTicket('${esc(t.id)}')">✕</button></a>`).join("")
    || `<div class="empty">Aucun billet pour l’instant. Dans « Séances », touchez un horaire puis « Ajouter à mes billets ».</div>`;
}
window.rmTicket = id => { TICKETS = TICKETS.filter(t => t.id !== id); sync(); renderTickets(); };

// ---------- Fiche film ----------
window.openFilm = id => {
  const f = FILMS.find(x => String(x.id) === String(id)); if (!f) return;
  const V = view().find(x => String(x.id) === String(id)) || {...f, vby: f.by}; const now = new Date();
  const lines = V.vby.slice().sort((a, b) => (dist(a.c) ?? 0) - (dist(b.c) ?? 0) || (a.c.type === "pathe" ? 0 : 1) - (b.c.type === "pathe" ? 0 : 1) || a.c.name.localeCompare(b.c.name))
    .map(({c, times}) => `<div class="cine-line"><b>${esc(c.name)} <span class="badge b-${c.type}">${TYPE[c.type]}</span>${distTxt(c)}</b>${times.slice().sort((a,b)=>a.time.localeCompare(b.time)).map(t => timeBtn(f, c, t, now)).join("")}</div>`).join("");
  const labs = [f.cl.ap && "Avant-première", ...f.cl.special, f.cl.fresh && "Sortie de la semaine", f.cl.retro && f.year < 2026 && "Séance rétro"].filter(Boolean);
  const sim = FILMS.filter(x => x !== f && (x.genres||[]).some(g => (f.genres||[]).includes(g))).slice(0, 10).map(x => ({...x, vby: x.by, n: x.times.length}));
  const yt = "https://www.youtube.com/results?search_query=" + encodeURIComponent(f.title + " bande annonce " + (f.year || ""));
  modal(`<div class="mbody fd">${f.poster ? `<img class="pl" src="${esc(f.poster)}" alt="Affiche de ${esc(f.title)}">` : ""}<h2>${esc(f.title)}</h2>
   <div>${labs.map(l => `<span class="tag g" style="display:inline-block;margin:0 4px 4px 0">${esc(l)}</span>`).join("")}</div>
   <p class="sub">${meta(f)}${f.directors ? " · de " + esc(f.directors) : ""}</p>${(f.cast||[]).length ? `<p class="sub">Avec ${esc(f.cast.join(", "))}</p>` : ""}
   <p class="syn">${esc(f.synopsis || "")}</p>
   ${lbState(f).watch ? `<p><span class="lbw">Dans votre watchlist Letterboxd</span></p>` : ""}${lbState(f).seen ? `<p><span class="lbs">✓ Déjà vu (Letterboxd)</span></p>` : ""}
   <div class="btns" role="group" aria-label="Mes listes">${[["towatch","📌 À voir"],["seen","✓ Vu"],["rewatch","🔁 À revoir"]].map(([k,l]) => `<button class="ghost${inList(k, f) ? " on" : ""}" aria-pressed="${inList(k, f)}" onclick="toggleList('${k}','${f.id}')">${l}</button>`).join("")}</div>
   <div id="trailer"></div>
   <div class="btns"><a class="ghost" href="${yt}" target="_blank" rel="noopener">▶ Bande-annonce (YouTube)</a><a class="ghost" href="https://www.allocine.fr/film/fichefilm_gen_cfilm=${esc(f.id)}.html" target="_blank" rel="noopener">Plus d’infos (Allociné)</a><button class="ghost" onclick="shareFilm('${f.id}')">↗ Partager</button></div>
   <h3 style="clear:both;color:var(--gold2)">Séances ${SELDATES.length > 1 ? "de la période" : "– " + fmtDay(SELDATES[0])} · ${V.vby.length} cinéma(s)</h3>${lines || `<p class="sub">Aucune séance avec les filtres actuels.</p>`}
   <p class="sub">Touchez un horaire : réserver, ajouter à mes billets ou à l’agenda. ★ = séance spéciale, ♿ = accessible.</p>
   <div id="photos"></div>${sim.length ? `<h3 style="color:var(--gold2)">Films similaires</h3><div class="rail" style="padding-left:0">${sim.map(x => posterCard(x)).join("")}</div>` : ""}</div>`);
  filmExtras(f);
};

// ---------- Carte ----------
const map = L.map("map", {zoomControl: false, zoomSnap: 0.5, preferCanvas: true}).setView([48.8566, 2.3522], 10);
L.control.zoom({position: "bottomright"}).addTo(map);
const TILE = l => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${l ? "Light" : "Dark"}_Gray_Base/MapServer/tile/{z}/{y}/{x}`, TREF = l => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${l ? "Light" : "Dark"}_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const tiles = L.tileLayer(TILE(document.body.classList.contains("light")), {maxZoom: 19, maxNativeZoom: 16, attribution: 'Tuiles © Esri — Esri, HERE, Garmin, © OpenStreetMap'}).addTo(map);
const tref = L.tileLayer(TREF(document.body.classList.contains("light")), {maxZoom: 19, maxNativeZoom: 16, pane: "overlayPane", opacity: .9}).addTo(map);
new MutationObserver(() => { const l = document.body.classList.contains("light"); tiles.setUrl(TILE(l)); tref.setUrl(TREF(l)); }).observe(document.body, {attributes: true, attributeFilter: ["class"]});
const MAPT = new Set(["pathe", "partner"]);
const lg = L.control({position: "bottomleft"}); lg.onAdd = () => { const d = L.DomUtil.create("div", "legend mlegend"); L.DomEvent.disableClickPropagation(d);
  d.innerHTML = [["pathe", "Pathé"], ["partner", "Partenaires"]].map(([k, l]) => `<button class="lgb on" data-k="${k}" aria-pressed="true"><i class="lg-${k}"></i>${l}</button>`).join("");
  d.querySelectorAll("button").forEach(b => b.onclick = () => { const k = b.dataset.k; MAPT.has(k) ? MAPT.delete(k) : MAPT.add(k); b.classList.toggle("on"); b.setAttribute("aria-pressed", MAPT.has(k)); renderMap(); }); return d; }; lg.addTo(map);
const rc = L.control({position: "bottomright"}); rc.onAdd = () => { const b = L.DomUtil.create("button", "mapbtn"); b.title = "Recentrer sur l’Île-de-France"; b.setAttribute("aria-label", b.title); b.textContent = "◎"; L.DomEvent.disableClickPropagation(b); b.onclick = () => map.flyTo([48.8566, 2.3522], 10, {duration: .8}); return b; }; rc.addTo(map);
const icon = t => t === "other" ? L.divIcon({className: "", iconSize: [14,14], iconAnchor: [7,7], popupAnchor: [0,-8], html: '<div class="mk mk-other"></div>'}) : L.divIcon({className: "", iconSize: [30,38], iconAnchor: [15,36], popupAnchor: [0,-34], html: `<div class="mk mk-${t}"><span>${t === "pathe" ? "P" : "C"}</span></div>`});
let layer = L.layerGroup().addTo(map), meLayer = L.layerGroup().addTo(map);
function filtered(q, t, dep) { q = norm(q); return CINES.filter(c => (!t || c.type === t || (t === "fav" && FAVS.has(c.id))) && (!dep || c.dep === dep) && (!q || norm(c.name + " " + c.city + " " + c.zip + " " + c.address).includes(q))); }
function renderMap() {
  layer.clearLayers(); const list = filtered($("#q").value, $("#ftype").value, $("#fdep").value); $("#count").textContent = list.length + " cinémas";
  list.forEach(c => { if (c.lat == null || !MAPT.has(c.type)) return;
    const m = L.marker([c.lat, c.lng], {icon: icon(c.type), title: c.name, zIndexOffset: c.type === "pathe" ? 500 : c.type === "partner" ? 300 : 0, keyboard: true});
    m.bindPopup(() => `<div class="pop">${c.photo ? `<img src="${esc(c.photo.url)}" alt="${esc(c.name)}" loading="lazy">` : ""}<div class="pb"><span class="badge b-${c.type}">${TYPE[c.type]}</span><h4>${FAVS.has(c.id) ? "⭐ " : ""}${esc(c.name)}</h4><div class="addr">${esc(c.fullAddress || c.address)}${distTxt(c)}</div><div class="acts"><button onclick="openCine('${c.id}')">Fiche</button><button class="gold" onclick="openCine('${c.id}',true)">Séances</button></div></div></div>`, {maxWidth: 270, minWidth: 250});
    layer.addLayer(m); });
}
$("#q").oninput = $("#ftype").onchange = $("#fdep").onchange = renderMap;
async function nearMe(btn) { try { btn.textContent = "📍 Localisation…"; await locate(); meLayer.clearLayers(); L.circleMarker([GEO.lat, GEO.lng], {radius: 8, color: "#f1d784", fillColor: "#c9a227", fillOpacity: 1}).addTo(meLayer).bindTooltip("Vous êtes ici");
  map.setView([GEO.lat, GEO.lng], 13); renderMap(); renderGrid(); } catch (e) { alert(e.message); } btn.textContent = "📍 Près de moi"; }
$("#near").onclick = e => nearMe(e.target);
$("#near2").onclick = e => nearMe(e.target).then(() => go("list"));

// ---------- Liste cinémas ----------
let GSHOWN = 60;
function renderGrid() {
  let list = filtered($("#q2").value, $("#ftype2").value, $("#fdep2").value);
  list = list.sort((a, b) => GEO ? (dist(a) ?? 999) - (dist(b) ?? 999) : ({pathe: 0, partner: 1, other: 2}[a.type] - {pathe: 0, partner: 1, other: 2}[b.type]) || a.name.localeCompare(b.name));
  $("#grid").innerHTML = list.slice(0, GSHOWN).map(c => `<button class="card" onclick="openCine('${c.id}')"><div class="ph" style="${c.photo ? `background-image:url('${esc(c.photo.url)}')` : ""}">${c.photo ? "" : "🎬"}</div><span class="badge b-${c.type}">${TYPE[c.type]}</span>${FAVS.has(c.id) ? '<span class="star" aria-label="Favori">⭐</span>' : ""}<div class="b"><h3>${esc(c.name)}</h3><p>${esc(c.zip)} ${esc(c.city)}${distTxt(c)}</p></div></button>`).join("")
    + (list.length > GSHOWN ? `<button class="ghost" onclick="GSHOWN+=60;renderGrid()">Afficher plus (${list.length - GSHOWN})</button>` : "") || `<div class="empty">Aucun résultat.</div>`;
}
window.renderGrid = renderGrid;
$("#q2").oninput = $("#ftype2").onchange = $("#fdep2").onchange = () => { GSHOWN = 60; renderGrid(); };
function refreshCines() { renderMap(); renderGrid(); updAcct(); }
const DEPS = [...new Set(CINES.map(c => c.dep).filter(Boolean))].sort();
["#fdep", "#fdep2"].forEach(s => $(s).innerHTML += DEPS.map(d => `<option>${esc(d)}</option>`).join(""));
$("#depopts").innerHTML = DEPS.map(d => `<option value="dep:${esc(d)}">${esc(d)}</option>`).join("");

// ---------- Fiche cinéma ----------
const gmaps = c => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(c.name + " " + (c.fullAddress || c.address));
const travel = c => { const d = dist(c); if (d == null) return ""; return ` · ≈ ${Math.round(d < 1.2 ? d / 4.5 * 60 : 12 + d / 18 * 60)} min ${d < 1.2 ? "à pied" : "en transports"} (estimation)`; };
window.openCine = async (id, focus, day) => {
  const c = byId(id); if (!c) return; day = day || SELDATES[0];
  modal(`<div class="mhead" style="${c.photo ? `background-image:url('${esc(c.photo.url)}')` : ""}" role="img" aria-label="Photo de ${esc(c.name)}">${c.photo && c.photo.credit ? `<a class="pcred" href="${esc(c.photo.source||"#")}" target="_blank" rel="noopener">📷 ${esc(c.photo.credit)}</a>` : ""}</div><div class="mbody"><span class="badge b-${c.type}">${TYPE[c.type]}</span>${c.cinepass || c.type !== "other" ? ` <span class="badge b-partner">CinéPass</span>` : ""}
   <h2>${esc(c.name)}</h2><button class="favbtn ${FAVS.has(c.id) ? "on" : ""}" onclick="toggleFav('${c.id}')" aria-pressed="${FAVS.has(c.id)}">${FAVS.has(c.id) ? "⭐ Dans mes cinémas" : "☆ Ajouter à mes cinémas"}</button>
   <p>${esc(c.fullAddress || c.address)}${distTxt(c)}<small>${travel(c)}</small></p><div class="btns"><a class="ghost" href="${gmaps(c)}" target="_blank" rel="noopener">Itinéraire</a>${c.website ? `<a class="ghost" href="${esc(c.website)}" target="_blank" rel="noopener">Site du cinéma</a>` : ""}</div>
   <h3 style="color:var(--gold2)">Séances de la semaine</h3><div class="dates cdates" role="tablist" aria-label="Jour des séances">${DAYS.map((d, i) => { const k = ymd(d); return `<button role="tab" aria-selected="${k === day}" class="${k === day ? "on" : ""}" onclick="cineDay('${c.id}','${k}')">${i === 0 ? "Auj." : i === 1 ? "Demain" : d.toLocaleDateString("fr-FR",{weekday:"short"})}<b>${d.getDate()}</b>${d.toLocaleDateString("fr-FR",{month:"short"})}</button>`; }).join("")}</div>
   <div id="cshows">${c.allocineId ? "" : "Séances non disponibles."}</div></div>`);
  cineDay(id, day);
};
window.cineDay = async (id, day) => {
  const c = byId(id); if (!c?.allocineId) return;
  $$(".cdates button").forEach(b => { const on = b.getAttribute("onclick").includes(day); b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
  $("#cshows").innerHTML = `<p class="sub">Chargement des séances du ${fmtDay(day)}…</p>`;
  try {
    const d = await fetch(`/allocine/${c.allocineId}/${day}`).then(j); const now = new Date();
    const films = (d.films || []).map(f => classify({...f, by: [{c, times: f.times}]}));
    films.forEach(f => FILMS.some(x => String(x.id) === String(f.id)) || FILMS.push(f));
    if (!$("#cshows")) return;
    $("#cshows").innerHTML = `<p class="sub">${fmtDay(day)} · ${films.length} film(s)</p>` + (films.map(f => { const L = lbState(f); return `<article class="film${L.seen ? " seen" : ""}" style="margin:0 0 10px">${f.poster ? `<img src="${esc(f.poster)}" alt="Affiche de ${esc(f.title)}" loading="lazy" onclick="openFilm('${f.id}')">` : `<div class="noimg"></div>`}<div><h3>${esc(f.title)}${L.watch ? ` <span class="lbw">Watchlist</span>` : ""}${L.seen ? ` <span class="lbs">✓ Vu</span>` : ""}</h3><div class="meta">${meta(f)}</div>${f.times.slice().sort((a,b)=>a.time.localeCompare(b.time)).map(t => timeBtn(f, c, t, now)).join("")}</div></article>`; }).join("") || `<p class="sub">Aucune séance publiée pour ce jour. Les cinémas publient leurs programmes chaque semaine (nouvelle semaine le mercredi), souvent à partir du lundi ou du mardi précédent.</p>`);
  } catch (e) { if ($("#cshows")) $("#cshows").innerHTML = `<p class="sub">⚠️ Allociné ne répond pas pour ce cinéma. <button class="ghost" onclick="cineDay('${c.id}','${day}')">Réessayer</button> <a href="${esc(c.website || "#")}" target="_blank" rel="noopener">Site du cinéma</a></p>`; }
};

// ---------- Recherche globale ----------
$("#gq").oninput = () => {
  const q = norm($("#gq").value); const R = $("#gres"); if (q.length < 2) return R.classList.add("hidden");
  const fl = FILMS.filter(f => norm(f.title + " " + (f.originalTitle||"")).includes(q)).slice(0, 6);
  const ac = FILMS.filter(f => !fl.includes(f) && norm((f.cast||[]).join(" ") + " " + (f.directors||"")).includes(q)).slice(0, 5);
  const cn = CINES.filter(c => norm(c.name + " " + c.city).includes(q)).slice(0, 6);
  const fb = f => `<button role="option" onclick="gpick();openFilm('${f.id}')">${f.poster ? `<img src="${esc(f.poster)}" alt="">` : `<img alt="">`}<span>${esc(f.title)}<small>${esc([f.year, (f.cast||[]).slice(0,2).join(", ")].filter(Boolean).join(" · "))}</small></span></button>`;
  R.innerHTML = (fl.length ? `<div class="h">Films</div>` + fl.map(fb).join("") : "") + (ac.length ? `<div class="h">Acteurs / réalisateurs</div>` + ac.map(fb).join("") : "")
    + (cn.length ? `<div class="h">Cinémas</div>` + cn.map(c => `<button role="option" onclick="gpick();openCine('${c.id}')"><span>🎬 ${esc(c.name)}<small>${esc(c.zip)} ${esc(c.city)} · ${TYPE[c.type]}</small></span></button>`).join("") : "") || `<div class="empty">Aucun résultat (les films cherchés sont ceux à l’affiche le jour choisi).</div>`;
  R.classList.remove("hidden");
};
window.gpick = () => { $("#gres").classList.add("hidden"); $("#gq").value = ""; };
document.addEventListener("click", e => { if (!e.target.closest(".gsearch")) $("#gres").classList.add("hidden"); });

// ---------- CinéPass / infos ----------
$("#infos").innerHTML = `<h1>✨ CinéPass & infos</h1>
<h2>Le CinéPass Pathé</h2><p>Le <b>CinéPass</b> est l’abonnement cinéma de Pathé : des séances en illimité dans les cinémas Pathé (et Gaumont), et dans un réseau de <b>cinémas partenaires</b> indépendants. Plusieurs formules existent (solo, duo, jeunes…), avec ou sans accès aux salles premium (IMAX, 4DX, Dolby Cinema…) selon l’offre.</p>
<p>Les formules, prix et conditions évoluent : consultez la page officielle <a href="https://www.pathe.fr/cinepass" target="_blank" rel="noopener">pathe.fr/cinepass</a>.</p>
<h2>Cinémas partenaires CinéPass en Île-de-France</h2><div class="cards">${CINES.filter(c => c.type === "partner").sort((a,b)=>a.name.localeCompare(b.name)).map(c => `<button class="box" style="text-align:left;color:inherit;cursor:pointer" onclick="openCine('${c.id}')"><b>${esc(c.name)}</b><br><span class="sub">${esc(c.zip)} ${esc(c.city)}</span></button>`).join("")}</div>
<h2>📲 Télécharger l’application</h2><p>Android : <a href="/download/cine-idf.apk" download>APK Ciné IDF</a> · iPhone : Safari → Partager → « Sur l’écran d’accueil ». <a href="#" onclick="openInstall();return false">Mode d’emploi</a></p><h2>À propos</h2><p>Ciné IDF regroupe les séances de ${CINES.length} cinémas d’Île-de-France : ${CINES.filter(c=>c.type==="pathe").length} Pathé/Gaumont, ${CINES.filter(c=>c.type==="partner").length} partenaires CinéPass et ${CINES.filter(c=>c.type==="other").length} autres salles.</p>
<h2>Sources & mentions légales</h2><p>Horaires, affiches, notes et synopsis : <b>Allociné</b> (méthode de la bibliothèque open source <a href="https://github.com/lefevre-dev/AllocineAPI" target="_blank" rel="noopener">AllocineAPI</a>). Cartographie © OpenStreetMap. Photos : Pathé et Wikimedia Commons (crédits sur chaque fiche).</p>
<p><b>Site non officiel, non affilié à Pathé, Gaumont ni Allociné.</b> Les réservations se font sur le site de chaque cinéma ; vérifiez toujours l’horaire avant de vous déplacer. Les comptes ne stockent qu’une adresse e-mail, un mot de passe chiffré, vos favoris et vos billets enregistrés.</p>
<h2>Contact</h2><p>Une erreur, une suggestion ? Ouvrez un ticket sur <a href="https://github.com/mathislucas887-del/cine-idf/issues" target="_blank" rel="noopener">GitHub</a>.</p>
<p class="sub">État du serveur : <a href="/health" target="_blank" rel="noopener">/health</a>. Hébergement gratuit : le premier chargement peut prendre ~50 s après une période d’inactivité.</p>`;

// ---------- Données structurées (SEO) ----------
function injectLD() {
  const ev = FILMS.slice(0, 20).flatMap(f => f.by.slice(0, 2).map(b => b.times[0] && {"@context": "https://schema.org", "@type": "ScreeningEvent", name: f.title, startDate: b.times[0].time, location: {"@type": "MovieTheater", name: b.c.name, address: b.c.fullAddress || b.c.address}, workPresented: {"@type": "Movie", name: f.title, image: f.poster || undefined, dateCreated: f.year ? String(f.year) : undefined}, inLanguage: "fr", offers: b.times[0].url ? {"@type": "Offer", url: b.times[0].url} : undefined})).filter(Boolean);
  $("#ld-events").textContent = JSON.stringify(ev);
}

// ---------- Démarrage ----------
renderDates(); updAcct(); renderMap(); renderGrid(); loadData(); loadLB();
const setGrid = g => { GRID = g; LS.set("grid", g); $("#vgrid").classList.toggle("on", g); $("#vlist").classList.toggle("on", !g); $("#vgrid").setAttribute("aria-pressed", g); $("#vlist").setAttribute("aria-pressed", !g); renderShows(); };
$("#vgrid").onclick = () => setGrid(true); $("#vlist").onclick = () => setGrid(false); setGrid(GRID);
const pchg = () => { const a = $("#pfrom").value, b = $("#pto").value || a; if (!a) return; const out = []; for (let d = new Date(a + "T12:00"); ymd(d) <= b && out.length < 7; d.setDate(d.getDate() + 1)) out.push(ymd(d)); SELDATES = out; renderDates(); loadData(); };
$("#pfrom").min = $("#pto").min = ymd(DAYS[0]); $("#pfrom").max = $("#pto").max = ymd(DAYS[13]); $("#pfrom").onchange = $("#pto").onchange = pchg;
// géolocalisation automatique si déjà autorisée
if (navigator.permissions) navigator.permissions.query({name: "geolocation"}).then(p => { if (p.state === "granted") locate().then(() => { renderGrid(); renderMap(); }).catch(() => {}); }).catch(() => {});
if (TOKEN) post("/api/me").then(onAuth).catch(async e => { if (/Session/.test(e.message)) { if (await restore()) sync(); } }); // on ne déconnecte jamais sans « Se déconnecter »
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
if (location.hash === "#billets") go("billets");
const FILMPATH = location.pathname.match(/^\/film\/(\d+)/);

// ---------- Installation de l'application ----------
let DEFERRED = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); DEFERRED = e; });
addEventListener("appinstalled", () => toast("Ciné IDF est installée ✅"));
const STANDALONE = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
if (STANDALONE || /CineIDFApp/.test(navigator.userAgent)) $("#install").style.display = "none";
window.openInstall = () => {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  modal(`<div class="mbody prose"><h2>📲 Installer Ciné IDF</h2>
   ${DEFERRED ? `<p><button class="primary" onclick="doInstall()">Installer maintenant</button></p>` : ""}
   <h3 style="color:var(--gold2)">Android</h3><ol><li><a style="display:inline-block;padding:10px 16px;border-radius:10px;color:#141414;background:linear-gradient(135deg,#f1d784,#c9a227);font-weight:700;text-decoration:none" href="/download/cine-idf.apk" download>Télécharger l’APK (Android 7+)</a></li>
   <li>Ouvrez le fichier téléchargé ; si Android le demande, autorisez « Installer des applis inconnues » pour votre navigateur.</li><li>Touchez « Installer » puis ouvrez Ciné IDF.</li></ol>
   <p class="sub">Ou, sans APK : dans Chrome, menu ⋮ → « Installer l’application ».</p>
   <h3 style="color:var(--gold2)">iPhone / iPad</h3><ol><li>Ouvrez ce site dans <b>Safari</b>.</li><li>Touchez le bouton Partager <b>⬆︎</b>.</li><li>Choisissez « <b>Sur l’écran d’accueil</b> » puis « Ajouter ».</li></ol>
   ${ios ? `<p class="sub">Vous êtes sur iOS : suivez les 3 étapes ci-dessus.</p>` : ""}
   <p class="sub">L’app fonctionne aussi hors ligne pour vos favoris, vos billets et les dernières séances consultées.</p></div>`);
};
window.doInstall = async () => { if (!DEFERRED) return; DEFERRED.prompt(); await DEFERRED.userChoice; DEFERRED = null; closeModal(); };
$("#install").onclick = openInstall;
if (location.hash === "#installer") openInstall();
if (location.hash === "#carte") go("map");
