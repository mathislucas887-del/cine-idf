"use strict";
/* Ciné IDF – fonctionnalités v8 : ce soir près de moi, comparateur, plan de soirée, filtres enregistrés, CinéPass,
   agenda avant-premières, rétro du week-end, watchlist commune, rappels, billets enrichis, statut serveur. */
const hm = d => new Date(d).toLocaleTimeString("fr-FR", {hour: "2-digit", minute: "2-digit"});
const trav = d => d == null ? null : d < 1.2 ? Math.round(d * 13) : Math.round(10 + d * 3.6); // marche ~4,5 km/h sinon transports ~17 km/h + 10 min
const travelTxt = d => { const m = trav(d); return m == null ? "" : `${d < 1.2 ? "🚶" : "🚇"} ~${m} min`; };
const saveExtra = () => { LS.set("extra", EXTRA); sync(); };
const nowISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 19); };
const TODAY = () => ymd(new Date());
async function nearest(n, pred) {
  if (!GEO) await locate();
  return CINES.filter(c => c.allocineId && c.lat != null && (!pred || pred(c))).sort((a, b) => dist(a) - dist(b)).slice(0, n);
}
async function fetchDay(d, cines) {
  const x = await fetch("/allocine-all/" + d + "?ids=" + encodeURIComponent(cines.map(c => c.id).join(","))).then(j);
  const out = []; Object.entries(x.cinemas || {}).forEach(([cid, films]) => { const c = byId(cid); (films || []).forEach(f => out.push({c, f})); }); return out;
}
const loading = t => modal(`<div class="mbody"><h2>${t}</h2><p class="sub">Chargement…</p></div>`);

// ---------- 1. Ce soir près de moi ----------
window.tonightNear = async () => {
  loading("📍 Ce soir près de moi");
  try {
    const cs = await nearest(10), rows = await fetchDay(TODAY(), cs), now = Date.now();
    const list = [];
    rows.forEach(({c, f}) => f.times.forEach(t => { const arr = now + (trav(dist(c)) || 20) * 60000; if (new Date(t.time) > arr && new Date(t.time) - now < 6 * 3600000) list.push({c, f, t}); }));
    list.sort((a, b) => a.t.time.localeCompare(b.t.time) || dist(a.c) - dist(b.c));
    const fv = $("#sver").value; const L = list.filter(x => !fv || x.t.version === fv).slice(0, 40);
    $("#mcontent").innerHTML = `<div class="mbody"><h2>📍 Ce soir près de moi</h2><p class="sub">Prochaines séances atteignables dans les ${cs.length} cinémas les plus proches (temps de trajet estimé).</p>
      ${L.map(({c, f, t}) => { const k = Math.random().toString(36).slice(2, 9); TB[k] = {f: FILMS.find(x => x.id == f.id) || classify({...f, by: [{c, times: f.times}]}), c, t};
        const leave = new Date(new Date(t.time) - (trav(dist(c)) + 10) * 60000);
        return `<div class="nrow" onclick="openTime('${k}')" role="button" tabindex="0">${f.poster ? `<img src="${esc(f.poster)}" alt="">` : ""}<div><b>${t.time.slice(11, 16)}</b> · ${esc(f.title)} <small class="pill${t.version === "vo" ? " vo" : ""}">${t.version === "vo" ? "VOST" : "VF"}</small><br><small>${esc(c.name)} · ${dist(c).toFixed(1)} km · ${travelTxt(dist(c))} · partir vers ${hm(leave)}</small></div></div>`; }).join("") || `<p class="sub">Plus de séance atteignable ce soir près de vous.</p>`}</div>`;
  } catch (e) { $("#mcontent").innerHTML = `<div class="mbody"><h2>📍 Ce soir près de moi</h2><p>⚠️ ${esc(e.message)}</p></div>`; }
};

// ---------- 2. Comparateur « où le voir ce soir ? » + notes ----------
const _openFilm = window.openFilm;
window.openFilm = id => {
  _openFilm(id); const f = FILMS.find(x => String(x.id) === String(id)); if (!f) return;
  const now = Date.now(), rows = f.by.map(({c, times}) => { const tt = trav(dist(c)); const nx = times.filter(t => new Date(t.time) > now + (tt || 0) * 60000).sort((a, b) => a.time.localeCompare(b.time))[0]; return nx && {c, t: nx, tt}; }).filter(Boolean)
    .sort((a, b) => a.t.time.localeCompare(b.t.time) || (a.tt || 0) - (b.tt || 0)).slice(0, 8);
  const L = (LB.seen || []).find(x => lbKey(x.n) === lbKey(f.title) || lbKey(x.n) === lbKey(f.originalTitle || ""));
  const box = document.createElement("div");
  box.innerHTML = `<div class="ratings">${f.rating ? `<div><b>★ ${(+f.rating).toFixed(1)}</b><small>Spectateurs Allociné</small></div>` : ""}${f.press ? `<div><b>${(+f.press).toFixed(1)}</b><small>Presse</small></div>` : ""}${L && L.r ? `<div><b>${L.r}</b><small>Votre note Letterboxd</small></div>` : ""}<a class="ghost" href="https://www.allocine.fr/film/fichefilm-${esc(f.id)}/critiques/spectateurs/" target="_blank" rel="noopener">Lire les avis spectateurs →</a></div>
   ${SELDATES[0] === TODAY() && rows.length ? `<h3 style="color:var(--gold2)">📍 Où le voir ce soir ?</h3><p class="sub">${GEO ? "Prochaine séance atteignable par cinéma, avec trajet estimé." : "Activez « Près de moi » pour les distances."}</p>
   ${rows.map(({c, t, tt}) => { const k = Math.random().toString(36).slice(2, 9); TB[k] = {f, c, t}; return `<div class="nrow" role="button" tabindex="0" onclick="openTime('${k}')"><div><b>${t.time.slice(11, 16)}</b> · ${esc(c.name)} <small class="pill${t.version === "vo" ? " vo" : ""}">${t.version === "vo" ? "VOST" : "VF"}</small>${tt != null ? `<br><small>${dist(c).toFixed(1)} km · ${travelTxt(dist(c))} · partir vers ${hm(new Date(t.time) - (tt + 10) * 6e4)}</small>` : ""}</div></div>`; }).join("")}` : ""}`;
  const syn = $("#mcontent .syn"); syn && syn.after(box);
};

// ---------- 3. Séance : plan de soirée, partage, signalement, places ----------
const _openTime = window.openTime;
window.openTime = k => {
  _openTime(k); const {f, c, t} = TB[k]; const s = new Date(t.time), end = new Date(s.getTime() + ((f.dur || rt(f.runtime) || 120) + 15) * 60000), d = dist(c), tt = trav(d);
  const box = document.createElement("div"); box.className = "plan";
  box.innerHTML = `<h3>🌙 Plan de soirée</h3><ul>${tt != null ? `<li>Départ conseillé : <b>${hm(s - (tt + 15) * 60000)}</b> (${travelTxt(d)}, ${d.toFixed(1)} km)</li>` : `<li><a href="#" onclick="locate().then(()=>openTime('${k}')).catch(e=>toast(e.message));return false">📍 Calculer mon trajet</a></li>`}
    <li>Séance <b>${t.time.slice(11, 16)}</b> · publicité ~15 min · fin vers <b>${hm(end)}</b></li><li>Places restantes : <i>non communiquées par la source</i> — visibles sur la page de réservation.</li>
    ${EXTRA.cp && EXTRA.cp.on ? `<li>${c.cinepass ? ((t.fmt || []).some(x => /IMAX|4DX|ScreenX|Dolby|3D|Onyx/.test(x)) ? "🎫 CinéPass : supplément format probable" : "🎫 Inclus dans votre CinéPass") : "🎫 Hors CinéPass"}</li>` : ""}</ul>
    <div class="btns"><a class="ghost" href="https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=${encodeURIComponent(c.name + " " + (c.fullAddress || c.address || ""))}" target="_blank" rel="noopener">🧭 Itinéraire</a><button class="ghost" onclick="shareShow('${k}')">↗ Partager la séance</button><button class="ghost" onclick="reportShow('${k}')">⚠️ Signaler un horaire faux</button></div>`;
  const sh = $("#sheetc .sheet"); sh && sh.insertBefore(box, sh.querySelector("button.ghost:last-child"));
};
window.shareShow = async k => { const {f, c, t} = TB[k]; const txt = `🎬 ${f.title} – ${new Date(t.time).toLocaleDateString("fr-FR", {weekday: "long", day: "numeric", month: "long"})} à ${t.time.slice(11, 16)} (${t.version === "vo" ? "VOST" : "VF"}) au ${c.name}`;
  const url = t.url || location.origin + "/film/" + f.id;
  try { if (navigator.share) await navigator.share({title: f.title, text: txt, url}); else { await navigator.clipboard.writeText(txt + "\n" + url); toast("Séance copiée"); } } catch (e) {} };
window.reportShow = async k => { const {f, c, t} = TB[k]; const reason = prompt("Qu’est-ce qui ne va pas ? (ex. horaire annulé, mauvaise version, salle fermée)", "Horaire incorrect"); if (reason == null) return;
  try { await post("/api/report", {film: f.title, cinema: c.name, time: t.time, reason, url: t.url || ""}); toast("Merci, signalement envoyé"); } catch (e) { toast("Échec de l’envoi : " + e.message); } };

// ---------- 4. Filtres enregistrés ----------
const FKEYS = ["scope", "sver", "sfmt", "sspec", "sgenre", "sdur", "srate", "slb", "sage"];
window.saveFilters = () => { EXTRA.filters = Object.fromEntries(FKEYS.map(k => [k, $("#" + k).value])); saveExtra(); toast("Filtres enregistrés : ils s’appliqueront à chaque ouverture"); qbar(); };
window.clearFilters = () => { delete EXTRA.filters; saveExtra(); FKEYS.forEach(k => { const e = $("#" + k); e.value = k === "scope" ? "core" : ""; }); loadData(); qbar(); toast("Filtres réinitialisés"); };
function applyFilters() { const F = EXTRA.filters; if (!F) return; let reload = false;
  FKEYS.forEach(k => { const e = $("#" + k); if (!e || F[k] == null) return; if (k === "sgenre" && F[k] && ![...e.options].some(o => o.value === F[k])) e.append(new Option(F[k], F[k])); if (e.value !== F[k]) { e.value = F[k]; if (k === "scope") reload = true; } });
  reload ? loadData() : FILMS.length && renderAll(); }

// ---------- 5. Barre d'actions rapides ----------
function qbar() {
  let q = $("#qbar"); if (!q) { q = document.createElement("div"); q.id = "qbar"; q.className = "qbar"; $(".filters").before(q); }
  q.innerHTML = `<button class="act" onclick="tonightNear()">📍 Ce soir près de moi</button><button class="act" onclick="openAgenda()">🗓️ Agenda avant-premières</button><button class="act" onclick="retroWeekend()">🎞️ Rétro ce week-end</button><button class="act" onclick="commonWatch()">🤝 Watchlist commune</button>
    ${EXTRA.filters ? `<button class="act on" onclick="clearFilters()" title="Filtres enregistrés actifs">💾 Mes filtres ✓ (réinitialiser)</button>` : `<button class="act" onclick="saveFilters()">💾 Enregistrer mes filtres</button>`}`;
}

// ---------- 6. Agenda avant-premières (4 semaines) ----------
window.openAgenda = async () => { loading("🗓️ Agenda des avant-premières");
  try { const A = await fetch("/agenda").then(j); const byDay = {};
    A.films.forEach(f => Object.entries(f.dates).forEach(([d, ts]) => (byDay[d] ||= []).push({f, ts})));
    const days = Object.keys(byDay).sort();
    $("#mcontent").innerHTML = `<div class="mbody"><h2>🗓️ Avant-premières & événements – 4 semaines</h2><p class="sub">Grands Pathé d’Île-de-France · ${A.at ? "mis à jour " + new Date(A.at * 1000).toLocaleString("fr-FR", {weekday: "short", hour: "2-digit", minute: "2-digit"}) : "en cours de constitution (quelques minutes après le réveil du serveur)"}. Au-delà d’une semaine, seules les avant-premières déjà annoncées apparaissent.</p>
      ${days.map(d => `<h3 style="color:var(--gold2)">${fmtDay(d)}</h3>${byDay[d].map(({f, ts}) => `<div class="nrow">${f.poster ? `<img src="${esc(f.poster)}" alt="">` : ""}<div><b>${esc(f.title)}</b>${ts[0].ev.length ? ` <span class="tag g">${esc(ts[0].ev.join(", "))}</span>` : ""}<br><small>${ts.slice(0, 4).map(t => `<a href="${esc(t.url || "#")}" target="_blank" rel="noopener">${t.time.slice(11, 16)} ${esc(byId(t.c)?.name || "")}</a>`).join(" · ")}</small></div></div>`).join("")}`).join("") || `<p class="sub">Aucune avant-première annoncée pour l’instant (ou agenda en cours de chargement : réessayez dans quelques minutes).</p>`}
      <p><button class="ghost" onclick="ALERTS.ap=true;LS.set('alerts',ALERTS);sync();toast('Alertes avant-premières activées')">🔔 M’alerter des nouvelles avant-premières</button></p></div>`;
  } catch (e) { $("#mcontent").innerHTML = `<div class="mbody"><p>⚠️ ${esc(e.message)}</p></div>`; } };

// ---------- 7. Rétro ce week-end près de chez moi ----------
window.retroWeekend = async () => { loading("🎞️ Rétro ce week-end");
  const d = new Date(); const sat = new Date(d); sat.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
  const days = d.getDay() === 0 ? [ymd(d)] : [ymd(sat), ymd(sun)];
  try { let cs; try { cs = await nearest(25, c => c.type !== "pathe"); } catch (e) { cs = CINES.filter(c => c.allocineId && c.type !== "pathe" && c.dep === "Paris").slice(0, 25); }
    const all = (await Promise.all(days.map(dd => fetchDay(dd, cs)))).flat().filter(({f}) => f.year && f.year <= 2016);
    const by = {}; all.forEach(({c, f}) => { const e = by[f.id] ||= {f, cs: new Map()}; const s = e.cs.get(c.id) || {c, times: []}; s.times.push(...f.times); e.cs.set(c.id, s); });
    const L = Object.values(by).sort((a, b) => a.f.year - b.f.year);
    $("#mcontent").innerHTML = `<div class="mbody"><h2>🎞️ Rétro ce week-end ${GEO ? "près de toi" : "à Paris"}</h2><p class="sub">Films sortis en 2016 ou avant, ${days.map(fmtDay).join(" et ")}, dans ${cs.length} salles${GEO ? " proches" : ""}.</p>
     ${L.map(({f, cs}) => `<div class="nrow">${f.poster ? `<img src="${esc(f.poster)}" alt="">` : ""}<div><b>${esc(f.title)}</b> <span class="tag">${f.year}</span>${lbState({...f, title: f.title}).seen ? ` <span class="lbs">✓ Vu</span>` : ""}<br>${[...cs.values()].slice(0, 3).map(({c, times}) => `<small>${esc(c.name)}${GEO ? " · " + dist(c).toFixed(1) + " km" : ""} : ${times.slice(0, 4).map(t => `<a href="${esc(t.url || c.website || "#")}" target="_blank" rel="noopener">${new Date(t.time).toLocaleDateString("fr-FR", {weekday: "short"})} ${t.time.slice(11, 16)}</a>`).join(", ")}</small>`).join("<br>")}</div></div>`).join("") || `<p class="sub">Pas encore de séance rétro publiée pour ce week-end.</p>`}
     <p><label class="sub"><input type="checkbox" ${EXTRA.retroSub ? "checked" : ""} onchange="EXTRA.retroSub=this.checked;saveExtra()"> 🔔 M’alerter des séances rétro de la semaine à l’ouverture de l’app</label></p></div>`;
  } catch (e) { $("#mcontent").innerHTML = `<div class="mbody"><p>⚠️ ${esc(e.message)}</p></div>`; } };

// ---------- 8. Watchlist commune / listes partagées ----------
window.commonWatch = () => modal(`<div class="mbody"><h2>🤝 Watchlist commune</h2><p class="sub">Comparez votre watchlist Letterboxd (et votre liste « À voir ») avec celle d’un·e ami·e : on vous montre les films que vous voulez voir tous les deux, en priorité ceux à l’affiche.</p>
  <form class="row" onsubmit="event.preventDefault();doCommon()"><input id="fruser" placeholder="Nom d’utilisateur Letterboxd de l’ami·e" autocapitalize="off" value="${esc(EXTRA.friend || "")}"><button class="primary">Comparer</button></form><div id="common"></div>
  <h3 style="color:var(--gold2)">Partager ma liste « À voir »</h3><p class="sub">Envoyez ce lien : votre ami·e pourra l’ouvrir et l’importer dans sa propre liste.</p><button class="ghost" onclick="shareToWatch()">↗ Partager le lien de ma liste</button></div>`);
window.doCommon = async () => { const u = $("#fruser").value.trim(); if (!u) return; EXTRA.friend = u; saveExtra(); $("#common").innerHTML = `<p class="sub">Chargement…</p>`;
  try { const x = await fetch("/letterboxd/" + encodeURIComponent(u)).then(async r => { const y = await r.json(); if (!r.ok) throw new Error(y.error); return y; });
    const mine = new Set([...(LB.watch || []), ...LISTS.towatch.map(i => ({n: i.title}))].map(i => lbKey(i.n)));
    const both = x.watch.filter(i => mine.has(lbKey(i.n))); const showing = FILMS.filter(f => both.some(i => lbKey(i.n) === lbKey(f.title) || lbKey(i.n) === lbKey(f.originalTitle || "")));
    $("#common").innerHTML = `<p><b>${both.length}</b> film(s) en commun${showing.length ? `, dont <b>${showing.length}</b> à l’affiche` : ""}.</p>${showing.length ? `<div class="rail" style="padding-left:0">${showing.map(f => posterCard(f)).join("")}</div>` : ""}<p class="sub">${both.slice(0, 60).map(i => esc(i.n) + (i.y ? ` (${i.y})` : "")).join(" · ")}</p>`;
  } catch (e) { $("#common").innerHTML = `<p>⚠️ ${esc(e.message)}</p>`; } };
window.shareToWatch = async () => { const data = btoa(unescape(encodeURIComponent(JSON.stringify(LISTS.towatch.map(i => [i.id, i.title, i.year]))))).replace(/=+$/, "");
  const url = location.origin + "/?liste=" + data; try { if (navigator.share) await navigator.share({title: "Ma liste Ciné IDF", url}); else { await navigator.clipboard.writeText(url); toast("Lien copié"); } } catch (e) {} };
function openSharedList(s) { try { const L = JSON.parse(decodeURIComponent(escape(atob(s)))); modal(`<div class="mbody"><h2>📌 Liste partagée (${L.length} films)</h2>${L.map(([id, t, y]) => `<p>${esc(t)} ${y ? `<small>(${esc(y)})</small>` : ""} ${FILMS.some(f => f.id == id) ? `<a href="#" onclick="openFilm('${esc(id)}');return false">· à l’affiche →</a>` : ""}</p>`).join("")}
  <button class="primary" onclick='importShared(${JSON.stringify(JSON.stringify(L))})'>Ajouter à ma liste « À voir »</button></div>`); } catch (e) { toast("Lien de liste invalide"); } }
window.importShared = s => { const L = JSON.parse(s), ids = new Set(LISTS.towatch.map(i => i.id)); L.forEach(([id, title, year]) => ids.has(String(id)) || LISTS.towatch.push({id: String(id), title, poster: "", year: String(year || ""), at: TODAY()})); LS.set("lists", LISTS); sync(); closeModal(); toast("Liste importée"); };

// ---------- 9. Recommandations « si tu as aimé X » ----------
const GMAP = {drama: "Drame", comedy: "Comédie", thriller: "Thriller", horror: "Epouvante-horreur", "science-fiction": "Science Fiction", animation: "Animation", action: "Action", romance: "Romance", crime: "Policier", documentary: "Documentaire", fantasy: "Fantastique", adventure: "Aventure", mystery: "Thriller", family: "Famille", war: "Guerre", history: "Historique", music: "Musical", western: "Western"};
function likedRails() {
  let s = $("#s-liked"); if (!s) { s = document.createElement("div"); s.id = "s-liked"; $("#home").prepend(s); }
  const V = view(); const out = (LB.liked || []).slice(0, 3).map(x => { const gs = (x.genres || []).map(g => norm(GMAP[g] || "")).filter(Boolean);
    const m = V.filter(f => !lbState(f).seen && (x.dir && norm(f.directors || "").includes(norm(x.dir)) || (f.cast || []).some(a => (x.cast || []).map(norm).includes(norm(a))) || (f.genres || []).filter(g => gs.includes(norm(g))).length >= Math.min(2, gs.length || 9)))
      .sort((a, b) => (+b.rating || 0) - (+a.rating || 0)).slice(0, 12);
    return m.length ? `<section class="fsec"><h2>❤️ Si tu as aimé « ${esc(x.n)} » <small class="sub">(${x.r}★ sur Letterboxd)</small></h2><div class="rail">${m.map(f => posterCard(f)).join("")}</div></section>` : ""; }).join("");
  s.innerHTML = out;
}

// ---------- 10. Événements : filtres par type ----------
let EVF = "";
function evRail() { const V = view(); const ev = V.filter(f => f.cl.special.length || f.cl.ap || f.times.some(t => (t.events || []).length));
  const types = ["Avant-première", ...new Set(ev.flatMap(f => f.cl.special))];
  let bar = $("#evbar"); if (!bar) { bar = document.createElement("div"); bar.id = "evbar"; bar.className = "chips"; $("#c-ev").before(bar); }
  bar.innerHTML = ["", ...types].map(t => `<button class="chip${EVF === t ? " on" : ""}" onclick="EVSET('${esc(t)}')">${t || "Tous"}</button>`).join("");
  const L = ev.filter(f => !EVF || (EVF === "Avant-première" ? f.cl.ap : f.cl.special.includes(EVF)));
  $("#c-ev").innerHTML = L.map(f => posterCard(f)).join("") || `<div class="empty">Aucun événement pour ces critères.</div>`; }
window.EVSET = t => { EVF = t; evRail(); };
const _renderAll = renderAll;
renderAll = function () { _renderAll(); try { evRail(); likedRails(); } catch (e) { console.error(e); } };

// ---------- 11. CinéPass : formule, solde, validité, règles ----------
function cpBlock() { const C = EXTRA.cp || {}; const left = C.until ? Math.ceil((new Date(C.until) - new Date()) / 864e5) : null;
  return `<div class="lbbox" id="cpbox"><h2>🎫 Mon CinéPass</h2><p class="sub">Saisie manuelle (Pathé ne publie pas d’API pour le solde) : on met en évidence les séances incluses et on vous rappelle l’échéance.</p>
   <div class="row"><select id="cpf" aria-label="Formule"><option value="">Pas d’abonnement</option>${["CinéPass", "CinéPass -26 ans", "CinéPass Duo", "Carte 5 places", "Le Pass (ancien)"].map(x => `<option ${C.f === x ? "selected" : ""}>${x}</option>`).join("")}</select>
   <label class="sub">Séances restantes <input id="cpn" type="number" min="0" placeholder="illimité" value="${esc(C.n ?? "")}" style="width:90px"></label><label class="sub">Valable jusqu’au <input id="cpu" type="date" value="${esc(C.until || "")}"></label>
   <label class="sub"><input id="cpo" type="checkbox" ${C.on ? "checked" : ""}> Surligner les séances incluses</label><button class="primary" onclick="saveCp()">Enregistrer</button></div>
   ${C.f ? `<p>${esc(C.f)}${C.n !== "" && C.n != null ? ` · <b>${esc(C.n)}</b> séance(s) restante(s)` : ""}${left != null ? ` · ${left >= 0 ? `expire dans <b>${left} j</b>` : "<b>expiré</b>"}` : ""}</p>` : ""}
   <p class="legend sub"><span class="t cp" style="display:inline-block;padding:2px 8px">20:00</span> inclus · <span class="t cpx" style="display:inline-block;padding:2px 8px">20:00</span> inclus avec supplément (IMAX, 4DX, ScreenX, Dolby, 3D)</p>
   <details><summary><b>Règles CinéPass & partenaires</b></summary><ul class="sub"><li>Valable dans tous les cinémas Pathé (ex-Gaumont) et dans les cinémas <b>partenaires</b> (badge « Partenaire CinéPass »).</li><li>Formats premium (IMAX, 4DX, ScreenX, Dolby Cinema, 3D) : <b>supplément</b> à payer selon la formule.</li><li>Chez les partenaires : réservation souvent au guichet, certaines séances spéciales/événements exclues.</li><li>Séances spéciales (opéra, concerts, live) : généralement hors abonnement.</li><li>Règles exactes et tarifs : <a href="https://www.pathe.fr/cinepass" target="_blank" rel="noopener">pathe.fr/cinepass</a>.</li></ul></details></div>`; }
window.saveCp = () => { EXTRA.cp = {f: $("#cpf").value, n: $("#cpn").value, until: $("#cpu").value, on: $("#cpo").checked}; saveExtra(); toast("CinéPass enregistré"); renderInfosPlus(); FILMS.length && renderAll(); };
function renderInfosPlus() { const i = $("#infos"); if (!i) return; $("#cpbox")?.remove(); i.insertAdjacentHTML("afterbegin", cpBlock());
  if (!$("#trustlinks")) i.insertAdjacentHTML("beforeend", `<p id="trustlinks" class="btns"><a class="ghost" href="/comment-ca-marche.html">ℹ️ Comment ça marche</a><a class="ghost" href="/confidentialite.html">🔒 Confidentialité & mentions légales</a><a class="ghost" href="/statut.html">🟢 Statut du service</a></p>`); }

// ---------- 12. Rappels et alertes ----------
function reminders() { const done = LS.get("reminded", {}), now = Date.now();
  TICKETS.forEach(t => { const dt = new Date(t.time) - now; if (dt > 0 && dt <= 3600000 && !done[t.id]) { done[t.id] = 1; const m = `⏰ Ta séance dans ${Math.round(dt / 60000)} min : ${t.title} au ${t.cinema} (${t.time.slice(11, 16)})`;
    toast(m); try { if (Notification.permission === "granted") navigator.serviceWorker?.ready.then(r => r.showNotification("Ciné IDF", {body: m, icon: "/icon-192.png", tag: t.id})).catch(() => new Notification("Ciné IDF", {body: m})); } catch (e) {} } });
  LS.set("reminded", done);
  const wk = "retro" + ymd(new Date()).slice(0, 8) + Math.floor(new Date().getDate() / 7);
  if (EXTRA.retroSub && !done[wk] && new Date().getDay() >= 4) { done[wk] = 1; LS.set("reminded", done); toast("🎞️ Le programme rétro du week-end est en ligne : bouton « Rétro ce week-end »"); }
  const C = EXTRA.cp; if (C && C.until) { const left = Math.ceil((new Date(C.until) - new Date()) / 864e5); const key = "cpwarn" + C.until + (left <= 3 ? "a" : "b");
    if (left >= 0 && left <= 7 && !done[key]) { done[key] = 1; LS.set("reminded", done); toast(`🎫 Votre ${C.f || "CinéPass"} expire dans ${left} j`); } }
  if (C && C.n !== "" && C.n != null && +C.n <= 1 && !done["cpn" + C.n]) { done["cpn" + C.n] = 1; LS.set("reminded", done); toast(`🎫 Plus que ${C.n} séance(s) sur votre ${C.f || "carte"}`); } }
setInterval(reminders, 60000);

// ---------- 13. Billets enrichis : QR, place, export semaine ----------
const _renderTickets = renderTickets;
renderTickets = function () { _renderTickets();
  $$("#tickets .ticket").forEach((a, i) => { const L = TICKETS.slice().sort((x, y) => x.time.localeCompare(y.time)); const t = L[i]; if (!t) return;
    const b = document.createElement("button"); b.className = "ghost tdet"; b.textContent = t.seat ? `💺 ${t.seat}${t.room ? " · salle " + t.room : ""}` : "🎟️ Billet / QR"; b.onclick = e => { e.preventDefault(); e.stopPropagation(); ticketCard(t.id); }; a.querySelector("div")?.append(b); });
  if (!$("#wkics")) $("#tickets").insertAdjacentHTML("beforebegin", `<p id="wkics" class="btns"><button class="ghost" onclick="weekIcs()">📅 Exporter mes séances des 7 prochains jours (.ics)</button><button class="ghost" onclick="askNotif()">⏰ Activer les rappels « ta séance dans 1 h »</button></p>`); };
window.ticketCard = id => { const t = TICKETS.find(x => x.id === id); if (!t) return; const qr = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=" + encodeURIComponent(t.url || `${t.title} ${t.cinema} ${t.time}`);
  modal(`<div class="mbody tcard"><h2>${esc(t.title)}</h2><p><b>${new Date(t.time).toLocaleDateString("fr-FR", {weekday: "long", day: "numeric", month: "long"})} · ${t.time.slice(11, 16)}</b><br>${esc(t.cinema)} · ${esc(t.version)}</p>
   <img src="${qr}" alt="QR code de la réservation" width="220" height="220" style="background:#fff;border-radius:12px"><p class="sub">QR du lien de réservation. Le QR d’entrée officiel reste celui envoyé par le cinéma (e-mail / app Pathé).</p>
   <div class="row"><label class="sub">Salle <input id="troom" value="${esc(t.room || "")}" style="width:70px"></label><label class="sub">Place(s) <input id="tseat" value="${esc(t.seat || "")}" placeholder="ex. G12, G13" style="width:120px"></label><button class="primary" onclick="saveSeat('${esc(id)}')">Enregistrer</button></div>
   <p class="btns"><a class="ghost" href="${esc(t.url || "#")}" target="_blank" rel="noopener">Ouvrir la réservation</a></p></div>`); };
window.saveSeat = id => { const t = TICKETS.find(x => x.id === id); t.seat = $("#tseat").value.trim(); t.room = $("#troom").value.trim(); sync(); closeModal(); renderTickets(); toast("Billet mis à jour"); };
window.weekIcs = () => { const now = new Date(), lim = new Date(now.getTime() + 7 * 864e5); const L = TICKETS.filter(t => new Date(t.time) > now && new Date(t.time) < lim);
  if (!L.length) return toast("Aucune séance enregistrée dans les 7 prochains jours");
  const z = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ev = L.map(t => { const s = new Date(t.time), e = new Date(s.getTime() + 150 * 60000); return ["BEGIN:VEVENT", "UID:" + encodeURIComponent(t.id) + "@cine-idf", "DTSTAMP:" + z(new Date()), "DTSTART:" + z(s), "DTEND:" + z(e), "SUMMARY:🎬 " + t.title, "LOCATION:" + t.cinema, "DESCRIPTION:" + [t.version, t.room && "Salle " + t.room, t.seat && "Place " + t.seat, t.url].filter(Boolean).join(" · "), "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Séance dans 1 h", "END:VALARM", "END:VEVENT"].join("\r\n"); });
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Cine IDF//FR", ...ev, "END:VCALENDAR"].join("\r\n")], {type: "text/calendar"})); a.download = "mes-seances-semaine.ics"; a.click(); };

// ---------- 14. Compte : sauvegarde / restauration ----------
const _openAcct = window.openAcct;
window.openAcct = msg => { _openAcct(msg); const m = $("#mcontent .mbody") || $("#mcontent"); m && m.insertAdjacentHTML("beforeend", `<div class="lbbox"><h3>💾 Sauvegarde</h3><p class="sub">Vos données sont synchronisées avec votre compte et restaurées automatiquement si le serveur redémarre. Vous pouvez aussi garder une copie :</p>
  <div class="btns"><button class="ghost" onclick="backup()">Télécharger ma sauvegarde</button><label class="ghost" style="cursor:pointer">Restaurer… <input type="file" accept=".json" hidden onchange="restoreFile(this.files[0])"></label></div></div>`); };
window.backup = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify({app: "cine-idf", v: 1, at: new Date().toISOString(), email: EMAIL, ...profileData(), lbData: LB}, null, 1)], {type: "application/json"})); a.download = "cine-idf-sauvegarde.json"; a.click(); };
window.restoreFile = async file => { try { const x = JSON.parse(await file.text()); if (x.app !== "cine-idf") throw 0; applyProfile(x, true); if (x.lbData) { LB = {...LB, ...x.lbData}; LS.set("lb", LB); LBIDX = null; } sync(); renderAll(); toast("Sauvegarde restaurée"); closeModal(); } catch (e) { toast("Fichier de sauvegarde invalide"); } };

// ---------- 15. Statut serveur (réveil) ----------
(async () => { const t0 = Date.now(); const slow = setTimeout(() => { const b = $("#banner"); b.innerHTML = "😴 Le serveur gratuit se réveille (jusqu’à ~50 s)… les dernières séances enregistrées s’affichent en attendant. <a href='/statut.html'>Statut</a>"; b.classList.remove("hidden"); }, 3500);
  try { await fetch("/status.json", {cache: "no-store"}); } catch (e) {} clearTimeout(slow); if (Date.now() - t0 > 3500) setTimeout(() => $("#banner").classList.add("hidden"), 4000); })();

// ---------- Démarrage ----------
qbar(); applyFilters(); renderInfosPlus(); reminders();
const PQ = new URLSearchParams(location.search);
if (PQ.get("liste")) { const s = PQ.get("liste"); const t = setInterval(() => { if (FILMS.length || Date.now() - window._t0 > 8000) { clearInterval(t); openSharedList(s); } }, 400); window._t0 = Date.now(); }
if (PQ.get("soir")) tonightNear(); if (PQ.get("agenda")) openAgenda(); if (PQ.get("retro")) retroWeekend(); if (PQ.get("v")) go(PQ.get("v"));
