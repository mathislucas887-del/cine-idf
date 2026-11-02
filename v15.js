// v15 : Accueil simplifié — tous les films de la semaine (Pathé + partenaires CinéPass) + choix du jour
(function () {
"use strict";
const ST = Object.assign({day: "all", q: ""}, LS.get("homeDay", {}));
const days = () => [...Array(7)].map((_, i) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i); return {k: ymd(d), l: i === 0 ? "Aujourd’hui" : i === 1 ? "Demain" : d.toLocaleDateString("fr-FR", {weekday: "long", day: "numeric"}).replace(/^./, c => c.toUpperCase())}; });
if (ST.day !== "all" && !days().some(d => d.k === ST.day)) ST.day = "all";
const C = () => (window.MATCHCAT || {films: []});
const onDay = (f, d) => d === "all" ? f.by : Object.fromEntries(Object.entries(f.by).map(([c, ts]) => [c, ts.filter(t => t.time.slice(0, 10) === d)]).filter(([, ts]) => ts.length));
const nT = by => Object.values(by).reduce((a, ts) => a + ts.length, 0);
function list() { const q = norm(ST.q || "");
  return C().films.map(f => { const by = onDay(f, ST.day); return {f, by, n: nT(by), c: Object.keys(by).length}; })
    .filter(x => x.n && (!q || norm(x.f.title).includes(q) || norm(x.f.directors || "").includes(q) || (x.f.cast || []).some(a => norm(a).includes(q))))
    .sort((a, b) => b.c - a.c || b.n - a.n || a.f.title.localeCompare(b.f.title, "fr")); }
function card(x) { const f = x.f; let L = {}; try { L = lbState(f); } catch (e) {} let my = ""; try { my = myList(f); } catch (e) {}
  return `<button class="poster hp${L.seen ? " seen" : ""}" onclick="homeFilm('${esc(f.id)}')" aria-label="${esc(f.title)}, ${x.c} cinéma${x.c > 1 ? "s" : ""}${L.seen ? " (déjà vu)" : ""}${L.watch ? " (dans ma watchlist Letterboxd)" : ""}">${L.watch ? `<span class="lbw" title="Dans votre watchlist Letterboxd">Watchlist</span>` : ""}${L.seen ? `<span class="lbs">✓ Vu</span>` : my ? `<span class="lbs">${my}</span>` : ""}<div class="im">${f.poster ? `<img src="${esc(f.poster)}" alt="Affiche de ${esc(f.title)}" loading="lazy" decoding="async">` : `<span class="noimg">🎬</span>`}</div><b>${esc(f.title)}</b><small>${x.c} cinéma${x.c > 1 ? "s" : ""} · ${x.n} séance${x.n > 1 ? "s" : ""}</small></button>`; }
let SHOWN = 60;
window.renderHome15 = function () { const el = $("#v-home"); if (!el) return; const cat = C(), D = days(), L = cat.films.length ? list() : [];
  const head = el.querySelector(".h15");
  const chips = `<div class="dayp" role="tablist" aria-label="Choisir le jour"><button role="tab" aria-selected="${ST.day === "all"}" class="${ST.day === "all" ? "on" : ""}" onclick="homeDay('all')">Toute la semaine</button>${D.map(d => `<button role="tab" aria-selected="${ST.day === d.k}" class="${ST.day === d.k ? "on" : ""}" onclick="homeDay('${d.k}')">${esc(d.l)}</button>`).join("")}</div>`;
  const dl = ST.day === "all" ? "cette semaine" : (D.find(d => d.k === ST.day) || {}).l.toLowerCase();
  const body = !cat.films.length ? (cat.err ? `<p class="empty">${esc(cat.err)} <button class="ghost" onclick="loadCatalogX()">Réessayer</button></p>` : `<div class="hgrid">${`<div class="sk" aria-hidden="true"><div class="im"></div><i></i></div>`.repeat(12)}</div>`)
    : L.length ? `<div class="hgrid">${L.slice(0, SHOWN).map(card).join("")}</div>${L.length > SHOWN ? `<button class="ghost hmore" onclick="homeMore()">Afficher les ${L.length - SHOWN} autres films</button>` : ""}`
    : `<p class="empty">Aucun film ${ST.q ? "ne correspond à « " + esc(ST.q) + " » " : ""}${esc(dl)}.</p>`;
  const info = cat.films.length ? `${L.length} film${L.length > 1 ? "s" : ""} ${esc(dl)} · Pathé et partenaires CinéPass${cat.loading ? " · chargement des jours suivants…" : ""}` : "Chargement des films de la semaine…";
  if (head) { el.querySelector(".dayw").innerHTML = chips; el.querySelector(".hinfo").textContent = info.replace(/&[^;]+;/g, "’"); el.querySelector(".hbody").innerHTML = body; return; }
  el.innerHTML = `<div class="home15"><div class="h15"><h1>Cette semaine au cinéma</h1><input id="hq15" type="search" placeholder="Rechercher un film…" aria-label="Rechercher un film de la semaine" value="${esc(ST.q)}" oninput="homeQ(this.value)"></div><div class="dayw">${chips}</div><p class="sub hinfo" aria-live="polite">${info}</p><div class="hbody">${body}</div></div>`; };
window.homeDay = d => { ST.day = d; SHOWN = 60; LS.set("homeDay", {day: d}); renderHome15(); const b = $(".dayp .on"); b && b.scrollIntoView({inline: "center", block: "nearest", behavior: "smooth"}); };
let qT; window.homeQ = v => { clearTimeout(qT); qT = setTimeout(() => { ST.q = v; SHOWN = 60; renderHome15(); }, 150); };
window.homeMore = () => { SHOWN += 120; renderHome15(); };
window.homeFilm = id => { const f = C().films.find(x => x.id === String(id)); if (!f) return;
  const D = days(), by = onDay(f, ST.day), dl = ST.day === "all" ? "Cette semaine" : D.find(d => d.k === ST.day).l;
  const rows = Object.entries(by).sort((a, b) => b[1].length - a[1].length).map(([cid, ts]) => { const c = byId(cid) || {name: cid}; const g = {}; ts.slice().sort((a, b) => a.time.localeCompare(b.time)).forEach(t => (g[t.time.slice(0, 10)] ||= []).push(t));
    return `<div class="mrow"><b>${esc(c.name)}</b>${c.type === "pathe" ? ` <span class="tag">Pathé</span>` : c.type === "partner" || c.cinepass ? ` <span class="tag g">CinéPass</span>` : ""}${Object.entries(g).map(([d, l]) => `<div class="mday">${ST.day === "all" ? `<small>${new Date(d + "T12:00").toLocaleDateString("fr-FR", {weekday: "short", day: "numeric"})}</small>` : ""}${l.map(t => `<span class="chip">${t.time.slice(11, 16)}${t.version === "vo" ? " VOST" : ""}</span>`).join("")}</div>`).join("")}</div>`; }).join("");
  const inW = (LISTS.towatch || []).some(x => x.id === f.id), inT = FILMS.some(x => String(x.id) === f.id);
  modal(`<div class="mbody"><div class="mfh">${f.poster ? `<img src="${esc(f.poster)}" alt="Affiche de ${esc(f.title)}">` : ""}<div><h2>${esc(f.title)}</h2><p class="sub">${[f.year, (f.genres || []).join(", "), f.runtime, f.directors && "de " + f.directors].filter(Boolean).map(esc).join(" · ")}</p>${f.rating ? `<p>★ ${f.rating.toFixed(1)} spectateurs Allociné</p>` : ""}
   <div class="row2"><button class="ghost sm" onclick="matchTrailer('${esc(f.id)}')">▶ Bande-annonce</button><button class="ghost sm" id="hw15" onclick="homeWatch('${esc(f.id)}')">${inW ? "✓ Dans ma watchlist" : "📌 À voir"}</button>${inT ? `<button class="ghost sm" onclick="closeModal();openFilm('${esc(f.id)}')">Fiche complète</button>` : ""}</div></div></div>
   <p>${esc(f.synopsis || "")}</p><h3>🎟️ Séances · ${esc(dl)} · ${Object.keys(by).length} cinéma${Object.keys(by).length > 1 ? "s" : ""}</h3>${rows || `<p class="sub">Aucune séance ce jour-là.</p>`}<p class="sub">Horaires Allociné. Réservation sur le site du cinéma.</p></div>`); };
window.homeWatch = id => { const f = C().films.find(x => x.id === String(id)); if (!f) return; const has = (LISTS.towatch || []).some(x => x.id === f.id);
  LISTS.towatch = has ? LISTS.towatch.filter(x => x.id !== f.id) : [...(LISTS.towatch || []), {id: f.id, title: f.title, poster: f.poster || "", year: String(f.year || ""), at: ymd(new Date())}];
  LS.set("lists", LISTS); try { lbCache.clear(); } catch (e) {} sync(); toast(has ? "Retiré de ta watchlist" : "Ajouté à ta watchlist !"); const b = $("#hw15"); if (b) b.textContent = has ? "📌 À voir" : "✓ Dans ma watchlist"; };
let rT; window.addEventListener("cinecat", () => { clearTimeout(rT); rT = setTimeout(() => { if (document.querySelector("#v-home.on")) renderHome15(); }, 120); });
if (!C().films.length && !C().loading && window.loadCatalogX) loadCatalogX();
if (document.querySelector("#v-home.on")) renderHome15();
// Letterboxd : rafraîchir toutes les grilles après liaison / import / déliaison
const reLB = () => { try { lbCache.clear(); } catch (e) {} const v = (document.querySelector(".view.on") || {}).id; if (v === "v-home") renderHome15(); if (v === "v-match" && window.renderMatch) renderMatch(); if (v === "v-profil" && window.cineRefresh) cineRefresh(); };
["lbLink", "lbCsv", "lbUnlink"].forEach(k => { const o = window[k]; if (typeof o === "function") window[k] = async function () { const sig = () => [LB.user, LB.at, LB.seen.length, LB.watch.length].join("|"), b = sig(); const r = await o.apply(this, arguments); if (sig() !== b) reLB(); return r; }; });
})();
