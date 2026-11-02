// v13 : CinéMatch — découverte de films façon swipe, à partir des vraies séances Allociné (Pathé + partenaires CinéPass)
(function () {
"use strict";
const ELIG = c => c && (c.type === "pathe" || c.type === "partner" || c.cinepass);
const parse = v => { if (Array.isArray(v)) return v; if (typeof v === "string") { try { return JSON.parse(v.replace(/'/g, '"').replace(/\bFalse\b/g, "false").replace(/\bTrue\b/g, "true")); } catch (e) { return []; } } return []; };
const MS = Object.assign({sw: {}, hist: [], once: {}}, LS.get("match", {}));
const saveMS = () => LS.set("match", {sw: MS.sw, hist: MS.hist.slice(-30), once: MS.once});
const OPT = Object.assign({genre: "", sort: "reco", cines: [], replay: false}, LS.get("matchOpt", {}));
const CAT = {films: [], at: 0, loading: false, err: "", days: 0};
window.MATCHCAT = CAT;
// ---------- Catalogue : 7 jours de séances, Pathé + partenaires, dédoublonné par ID Allociné ----------
async function loadCatalog(force) {
  if (CAT.loading || (!force && CAT.films.length && Date.now() - CAT.at < 20 * 6e4)) return;
  CAT.loading = true; CAT.err = "";
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i); return ymd(d); });
  const by = {}; let ok = 0; const now = new Date().toISOString().slice(0, 16);
  for (const d of days) {
    try { const x = await fetch("/allocine-all/" + d).then(j); ok++;
      Object.entries(x.cinemas || {}).forEach(([cid, films]) => { const c = byId(cid); if (!ELIG(c) || !films) return;
        films.forEach(f => { const times = (f.times || []).filter(t => (t.time || "") >= now); if (!times.length) return;
          const k = f.id ? "id:" + f.id : "t:" + norm(f.title) + "|" + (f.year || "");
          const F = by[k] ||= {id: String(f.id || k), title: f.title, poster: f.poster, year: f.year, runtime: f.runtime, genres: parse(f.genres), directors: f.directors, rating: +f.rating || 0, press: +f.press || 0, synopsis: f.synopsis || "", releases: parse(f.releases), cast: parse(f.cast), age: f.age, by: {}, n: 0};
          (F.by[cid] ||= []).push(...times); F.n += times.length; }); });
      if (ok === 1 || d === days[days.length - 1]) { publish(by); if (document.querySelector("#v-match.on")) renderMatch(); }
    } catch (e) {}
  }
  CAT.loading = false; CAT.days = ok;
  if (!ok) CAT.err = "Allociné ne répond pas pour le moment. Réessaie dans un instant.";
  else publish(by);
  if (document.querySelector("#v-match.on")) renderMatch();
}
function publish(by) { CAT.films = Object.values(by).map(f => { f.cines = Object.keys(f.by); f.rel = (f.releases.find(r => r.name === "Released") || {}).date || ""; return f; }); CAT.at = Date.now(); }
setInterval(() => { if (!document.hidden) loadCatalog(true); }, 30 * 6e4);
// ---------- Classement ----------
const lbk = t => lbKey(t || "");
function ranked() {
  const S = new Set([...(LISTS.seen || []).map(x => lbk(x.title)), ...(LB.seen || []).map(x => lbk(x.n))]);
  const W = new Set((LB.watch || []).map(x => lbk(x.n)));
  const GG = (window.GAME && GAME.genres) || {}, PG = {};
  Object.entries(MS.sw).forEach(([id, v]) => { if (v.d !== "pass") return; const f = CAT.films.find(x => x.id === id); (f ? f.genres : []).forEach(g => PG[g] = (PG[g] || 0) + 1); });
  (LISTS.towatch || []).forEach(x => { const f = CAT.films.find(y => y.id === x.id); f && f.genres.forEach(g => GG[g] = (GG[g] || 0)); });
  const likedG = {}; Object.entries(MS.sw).forEach(([id, v]) => { if (v.d !== "like") return; const f = CAT.films.find(x => x.id === id); f && f.genres.forEach(g => likedG[g] = (likedG[g] || 0) + 1); });
  let L = CAT.films.filter(f => (!OPT.genre || f.genres.includes(OPT.genre)) && (!OPT.cines.length || f.cines.some(c => OPT.cines.includes(c))));
  L = L.filter(f => { const s = MS.sw[f.id]; return !s || (OPT.replay && s.d === "pass"); }).filter(f => !(LISTS.towatch || []).some(x => x.id === f.id));
  const score = f => { const k = lbk(f.title); let s = Math.log2(1 + f.n) * 1.5 + f.cines.length * .35 + f.rating * 1.2 + f.press * .6;
    f.genres.forEach(g => s += Math.min(6, (GG[g] || 0) * .6 + (likedG[g] || 0) * 1.5) - Math.min(4, (PG[g] || 0) * .8));
    if (W.has(k)) s += 25; if (S.has(k)) s -= 40; if (f.cines.some(c => FAVS.has(c))) s += 4; return s; };
  const sorters = {reco: (a, b) => score(b) - score(a), pop: (a, b) => b.n - a.n || b.cines.length - a.cines.length, date: (a, b) => (b.rel || "").localeCompare(a.rel || ""), note: (a, b) => b.rating - a.rating || b.press - a.press};
  return L.sort(sorters[OPT.sort] || sorters.reco);
}
// ---------- Badges & XP ----------
const likesN = () => Object.values(MS.sw).filter(v => v.d === "like").length;
window.MATCH_BADGES = [
  {id: "m1", ic: "💘", t: "CinéMatch · Premier Match", d: "Premier swipe", cur: () => Object.keys(MS.sw).length, goal: 1},
  {id: "m10", ic: "🔎", t: "CinéMatch · Curieux", d: "10 films ajoutés", cur: likesN, goal: 10},
  {id: "m25", ic: "🗂️", t: "CinéMatch · Collectionneur", d: "25 films ajoutés", cur: likesN, goal: 25},
  {id: "m50", ic: "🎓", t: "CinéMatch · Cinéphile averti", d: "50 films ajoutés", cur: likesN, goal: 50}];
const badgeCheck = before => window.MATCH_BADGES.forEach(b => { if (b.cur() >= b.goal && !before.includes(b.id)) toast(`${b.ic} Badge débloqué : ${b.t}`); });
const earned = () => window.MATCH_BADGES.filter(b => b.cur() >= b.goal).map(b => b.id);
// ---------- Actions ----------
const film = id => CAT.films.find(f => f.id === String(id));
function addToWatch(f) { if ((LISTS.towatch || []).some(x => x.id === f.id)) { toast("Déjà enregistré dans ta watchlist"); return false; }
  LISTS.towatch = [...(LISTS.towatch || []), {id: f.id, title: f.title, poster: f.poster || "", year: String(f.year || ""), at: new Date().toISOString().slice(0, 10)}];
  LS.set("lists", LISTS); try { lbCache.clear(); } catch (e) {} sync(); return true; }
function localGain(f, dir) { if (MS.once[f.id]) return 0; MS.once[f.id] = 1; return dir === "like" ? 5 : 1; }
async function swipe(dir, viaKey) {
  const f = CUR(); if (!f || BUSY) return; BUSY = true;
  const card = $("#mcard"); if (card) { card.style.transition = "transform .35s ease, opacity .35s"; card.style.transform = `translate(${dir === "like" ? 140 : -140}%, -10px) rotate(${dir === "like" ? 18 : -18}deg)`; card.style.opacity = "0"; }
  const before = earned(); let added = false;
  if (dir === "like") { added = addToWatch(f); if (added) toast("Ajouté à ta watchlist !"); }
  FORCE = null; MS.sw[f.id] = {d: dir, at: Date.now()}; MS.hist.push({id: f.id, d: dir, added}); saveMS();
  let gain = 0;
  if (TOKEN) { try { const r = await post("/api/match", {op: "swipe", fid: f.id, dir}); gain = r.gain || 0; (r.once || []).forEach(k => MS.once[k] = 1); saveMS(); } catch (e) { gain = localGain(f, dir); } }
  else gain = localGain(f, dir);
  if (gain && window.cineAward) cineAward("match", f.id + ":" + dir, gain);
  if (added && window.cineAward) cineAward("watch", f.id);
  badgeCheck(before); saveMS();
  setTimeout(() => { BUSY = false; renderMatch(); }, 300);
}
window.matchSwipe = swipe;
window.matchUndo = async () => { const h = MS.hist.pop(); if (!h) return toast("Rien à annuler");
  delete MS.sw[h.id]; if (h.added) { LISTS.towatch = LISTS.towatch.filter(x => x.id !== h.id); LS.set("lists", LISTS); sync(); }
  saveMS(); if (TOKEN) post("/api/match", {op: "undo", fid: h.id}).catch(() => {}); FORCE = h.id; toast("Dernière action annulée"); renderMatch(); };
window.matchRemove = id => { LISTS.towatch = LISTS.towatch.filter(x => x.id !== String(id)); LS.set("lists", LISTS); sync(); toast("Retiré de ta watchlist"); renderMatch(); };
// ---------- Bande-annonce ----------
window.matchTrailer = async id => { const f = film(id) || {title: ""};
  modal(`<div class="mbody mtrail"><h2>▶ ${esc(f.title)}</h2><div class="trailer" id="mtr"><div class="sk" style="height:100%"><div class="im" style="height:100%"></div></div></div><p class="sub" id="mtrm">Chargement de la bande-annonce…</p></div>`);
  try { const x = await fetch("/film-extra/" + encodeURIComponent(id)).then(j);
    if (!document.getElementById("mtr")) return;
    if (x.trailer) { $("#mtr").innerHTML = `<iframe src="${esc(x.trailer)}" title="Bande-annonce de ${esc(f.title)}" allow="fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`; $("#mtrm").textContent = "Source : Allociné. Lance la lecture depuis le lecteur."; }
    else { $("#mtr").remove(); $("#mtrm").textContent = "Bande-annonce indisponible pour ce film."; }
  } catch (e) { const m = $("#mtrm"); if (m) { $("#mtr")?.remove(); m.textContent = "Bande-annonce indisponible pour le moment."; } } };
// ---------- Fiche & séances (catalogue 7 jours) ----------
window.matchFilm = id => { const f = film(id); if (!f) { if (FILMS.some(x => String(x.id) === String(id))) return openFilm(id); return toast("Ce film n’a plus de séance à venir"); }
  if (FILMS.some(x => String(x.id) === String(id))) return openFilm(id);
  const rows = f.cines.map(cid => { const c = byId(cid); const ts = f.by[cid].slice().sort((a, b) => a.time.localeCompare(b.time)); const days = {}; ts.forEach(t => (days[t.time.slice(0, 10)] ||= []).push(t));
    return `<div class="mrow"><b>${esc(c.name)}</b>${Object.entries(days).slice(0, 4).map(([d, l]) => `<div class="mday"><small>${new Date(d + "T12:00").toLocaleDateString("fr-FR", {weekday: "short", day: "numeric", month: "short"})}</small>${l.slice(0, 8).map(t => `<span class="chip">${t.time.slice(11, 16)} ${t.version === "vo" ? "VOST" : esc((t.version || "").toUpperCase())}</span>`).join("")}</div>`).join("")}</div>`; }).join("");
  modal(`<div class="mbody"><div class="mfh">${f.poster ? `<img src="${esc(f.poster)}" alt="Affiche de ${esc(f.title)}">` : ""}<div><h2>${esc(f.title)}</h2><p class="sub">${[f.year, f.genres.join(", "), f.runtime, f.directors && "de " + f.directors].filter(Boolean).map(esc).join(" · ")}</p>${f.rating ? `<p>★ ${f.rating.toFixed(1)} spectateurs Allociné</p>` : ""}<button class="ghost" onclick="matchTrailer('${esc(f.id)}')">▶ Bande-annonce</button></div></div><p>${esc(f.synopsis)}</p><h3>Séances des 7 prochains jours · ${f.cines.length} cinéma${f.cines.length > 1 ? "s" : ""}</h3>${rows}<p class="sub">Horaires Allociné. Réservation sur le site du cinéma.</p></div>`); };
window.matchSeances = id => { const f = film(id) || (LISTS.towatch || []).find(x => x.id === String(id)); if (!f) return;
  if (film(id)) return matchFilm(id); closeModal(); go("seances"); const g = $("#gq"); if (g) { g.value = f.title; g.dispatchEvent(new Event("input", {bubbles: true})); } };
// ---------- Rendu ----------
let BUSY = false, FORCE = null, TAB = "deck";
function CUR() { const L = ranked(); if (FORCE) { const f = film(FORCE); if (f) return f; } return L[0]; }
const NEXT = () => { const L = ranked(); const c = CUR(); return L.find(f => f !== c); };
function cardHTML(f, top) { const g = f.genres.slice(0, 3).join(" · ");
  return `<article class="mc${top ? " top" : " next"}" ${top ? `id="mcard" tabindex="0" aria-label="${esc(f.title)}. Glisse à droite pour ajouter à ta watchlist, à gauche pour passer."` : `aria-hidden="true"`}>
   <div class="mcp" ${top ? `onclick="if(!window.__drag)matchTrailer('${esc(f.id)}')"` : ""}>${f.poster ? `<img src="${esc(f.poster)}" alt="Affiche de ${esc(f.title)}" draggable="false" ${top ? "" : 'loading="eager"'}>` : `<div class="noimg">🎬</div>`}
   <span class="stamp like" aria-hidden="true">J’AIME</span><span class="stamp pass" aria-hidden="true">PASSER</span>${f.rating ? `<span class="mrate">★ ${f.rating.toFixed(1)}</span>` : ""}</div>
   <div class="mci"><h2>${esc(f.title)}</h2><p class="meta">${[f.year, g, f.runtime].filter(Boolean).map(esc).join(" · ")}</p>
   <p class="syn">${esc(f.synopsis || "")}</p>
   <div class="mcf"><span class="chip on">📍 Disponible dans ${f.cines.length} cinéma${f.cines.length > 1 ? "s" : ""}</span>${top ? `<button class="ghost sm" onclick="matchTrailer('${esc(f.id)}')">▶ Bande-annonce</button><button class="ghost sm" onclick="matchFilm('${esc(f.id)}')">Séances</button>` : ""}</div></div></article>`; }
function filtersHTML() { const G2 = [...new Set(CAT.films.flatMap(f => f.genres))].sort((a, b) => a.localeCompare(b, "fr")); const CS = [...new Set(CAT.films.flatMap(f => f.cines))].map(byId).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return `<div class="mfil"><select aria-label="Genre" onchange="matchOpt('genre',this.value)"><option value="">Tous les genres</option>${G2.map(g => `<option ${g === OPT.genre ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
  <select aria-label="Trier" onchange="matchOpt('sort',this.value)">${[["reco", "Pour toi"], ["pop", "Popularité"], ["date", "Date de sortie"], ["note", "Note"]].map(([k, l]) => `<option value="${k}" ${k === OPT.sort ? "selected" : ""}>${l}</option>`).join("")}</select>
  <details class="mcin"><summary>${OPT.cines.length ? OPT.cines.length + " cinéma(s)" : "Tous les cinémas"}</summary><div>${CS.map(c => `<label><input type="checkbox" ${OPT.cines.includes(c.id) ? "checked" : ""} onchange="matchCine('${esc(c.id)}',this.checked)"> ${esc(c.name)}</label>`).join("")}${OPT.cines.length ? `<button class="ghost sm" onclick="matchOpt('cines',[])">Réinitialiser</button>` : ""}</div></details>
  <label class="mrep"><input type="checkbox" ${OPT.replay ? "checked" : ""} onchange="matchOpt('replay',this.checked)"> Revoir les films passés</label></div>`; }
window.matchOpt = (k, v) => { OPT[k] = v; LS.set("matchOpt", OPT); FORCE = null; renderMatch(); };
window.matchCine = (id, on) => { OPT.cines = on ? [...new Set([...OPT.cines, id])] : OPT.cines.filter(x => x !== id); LS.set("matchOpt", OPT); renderMatch(); };
window.matchTab = t => { TAB = t; renderMatch(); };
function watchHTML() { const L = (LISTS.towatch || []).slice().reverse();
  return L.length ? `<div class="mwl">${L.map(x => { const f = film(x.id); return `<div class="mwi">${x.poster ? `<img src="${esc(x.poster)}" alt="Affiche de ${esc(x.title)}" loading="lazy">` : `<div class="noimg">🎬</div>`}<div><b>${esc(x.title)}</b><span class="sub">${esc(x.year || "")}${f ? ` · ${f.cines.length} cinéma${f.cines.length > 1 ? "s" : ""}` : " · pas de séance cette semaine"}</span>
   <div class="row2"><button class="ghost sm" onclick="matchFilm('${esc(x.id)}')">Fiche</button>${f ? `<button class="primary sm" onclick="matchSeances('${esc(x.id)}')">Voir les séances</button>` : ""}<button class="ghost sm" aria-label="Retirer ${esc(x.title)} de la watchlist" onclick="matchRemove('${esc(x.id)}')">✕ Retirer</button></div></div></div>`; }).join("")}</div>` : `<p class="empty">Ta watchlist est vide. Glisse des films vers la droite pour les ajouter.</p>`; }
window.renderMatch = function () { const el = $("#v-match"); if (!el) return; if (!CAT.films.length && !CAT.loading && !CAT.err) loadCatalog();
  const L = CAT.films.length ? ranked() : [], c = CUR(), n = c && NEXT();
  el.innerHTML = `<div class="match"><div class="mhd"><h1>💘 CinéMatch</h1><div class="subnav mtabs" role="tablist"><button role="tab" aria-selected="${TAB === "deck"}" class="${TAB === "deck" ? "on" : ""}" onclick="matchTab('deck')">Découvrir</button><button role="tab" aria-selected="${TAB === "list"}" class="${TAB === "list" ? "on" : ""}" onclick="matchTab('list')">Ma watchlist (${(LISTS.towatch || []).length})</button></div></div>
  ${TAB === "list" ? watchHTML() : `${CAT.films.length ? filtersHTML() : ""}
  <p class="sub mcount" aria-live="polite">${CAT.films.length ? `${CAT.films.length} films à l’affiche dans les Pathé et cinémas partenaires CinéPass${CAT.loading ? " (chargement des prochains jours…)" : ""} · ${L.length} à découvrir` : CAT.err ? esc(CAT.err) : "Chargement des films à l’affiche…"}</p>
  <div class="deck" id="deck">${c ? (n ? cardHTML(n, false) : "") + cardHTML(c, true) : CAT.films.length ? `<div class="mend"><b>Tu as tout vu ✨</b><p class="sub">Plus aucun film à découvrir avec ces filtres.</p><button class="ghost" onclick="matchOpt('replay',true)">Revoir les films passés</button></div>` : CAT.err ? `<div class="mend"><button class="primary" onclick="loadCatalogX()">Réessayer</button></div>` : `<div class="mc top sk"><div class="im" style="height:100%"></div></div>`}</div>
  <div class="mbtns"><button class="mb undo" onclick="matchUndo()" aria-label="Annuler la dernière action" ${MS.hist.length ? "" : "disabled"}>↶</button><button class="mb pass" onclick="matchSwipe('pass')" aria-label="Passer" ${c ? "" : "disabled"}>✕</button><button class="mb like" onclick="matchSwipe('like')" aria-label="Ajouter à ma watchlist" ${c ? "" : "disabled"}>♥</button></div>
  <p class="sub mhint">Glisse ou utilise ← / → · touche la carte pour la bande-annonce</p>`}</div>`;
  if (n && n.poster) { const i = new Image(); i.src = n.poster; } const nn = L[2]; if (nn && nn.poster) { const i = new Image(); i.src = nn.poster; }
  bindDrag(); };
window.loadCatalogX = () => loadCatalog(true);
function bindDrag() { const card = $("#mcard"); if (!card) return; let x0 = 0, y0 = 0, dx = 0, dy = 0, on = false, id = null;
  const like = card.querySelector(".stamp.like"), pass = card.querySelector(".stamp.pass");
  card.addEventListener("pointerdown", e => { if (e.target.closest("button")) return; on = true; id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; window.__drag = false; card.setPointerCapture(id); card.style.transition = "none"; });
  card.addEventListener("pointermove", e => { if (!on || e.pointerId !== id) return; dx = e.clientX - x0; dy = e.clientY - y0; if (Math.abs(dx) > 6) window.__drag = true;
    card.style.transform = `translate(${dx}px, ${dy * .3}px) rotate(${dx / 18}deg)`; const p = Math.min(1, Math.abs(dx) / 110); like.style.opacity = dx > 0 ? p : 0; pass.style.opacity = dx < 0 ? p : 0;
    card.classList.toggle("glike", dx > 40); card.classList.toggle("gpass", dx < -40); });
  const end = e => { if (!on) return; on = false; const w = card.offsetWidth || 300;
    if (Math.abs(dx) > Math.min(110, w * .3)) swipe(dx > 0 ? "like" : "pass");
    else { card.style.transition = "transform .25s ease"; card.style.transform = ""; like.style.opacity = pass.style.opacity = 0; card.classList.remove("glike", "gpass"); }
    setTimeout(() => window.__drag = false, 50); };
  card.addEventListener("pointerup", end); card.addEventListener("pointercancel", end); }
document.addEventListener("keydown", e => { if (!document.querySelector("#v-match.on") || TAB !== "deck" || !$("#modal").classList.contains("hidden") || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === "ArrowRight") { e.preventDefault(); swipe("like", 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); swipe("pass", 1); } else if ((e.key === "z" && (e.ctrlKey || e.metaKey)) || e.key === "Backspace") { e.preventDefault(); matchUndo(); } });
// ---------- Synchronisation serveur ----------
async function pull() { if (!TOKEN) return; try { const r = await post("/api/match", {op: "get"}); Object.entries(r.sw || {}).forEach(([k, v]) => { if (!MS.sw[k]) MS.sw[k] = {d: v.d, at: v.at * 1000}; }); (r.once || []).forEach(k => MS.once[k] = 1);
  const loc = Object.entries(MS.sw).filter(([k]) => !(r.sw || {})[k]); for (const [k, v] of loc.slice(0, 200)) await post("/api/match", {op: "swipe", fid: k, dir: v.d}).catch(() => {});
  saveMS(); if (document.querySelector("#v-match.on")) renderMatch(); } catch (e) {} }
if (typeof onAuth === "function") { const o = onAuth; onAuth = function () { const r = o.apply(this, arguments); setTimeout(pull, 500); return r; }; }
// ---------- Section ----------
$("#main").insertAdjacentHTML("beforeend", `<section id="v-match" class="view" aria-label="CinéMatch"></section>`);
setTimeout(() => loadCatalog(), 4000); setTimeout(pull, 2500);
if (new URLSearchParams(location.search).get("v") === "match") go("match");
})();
