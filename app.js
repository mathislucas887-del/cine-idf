"use strict";
let CINES = window.CINEMAS || [];
let LIVE = false;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
let DIRECT = false;
const j = r => { if (!r.ok) throw new Error(r.status); return r.json(); };
const direct = p => fetch("https://www.pathe.fr/api/" + p + (p.includes("?") ? "&" : "?") + "language=fr").then(j);
const api1 = p => DIRECT ? direct(p) : fetch("/pathe/" + p).then(j).catch(e => direct(p).then(x => { DIRECT = true; return x; }));
const api = p => api1(p).catch(() => new Promise(r => setTimeout(r, 800)).then(() => api1(p)));
let FAILS = 0;

// ---------- Vue ----------
document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + b.dataset.v));
  if (b.dataset.v === "seances" && !lastResult.length) loadShows();
  if (b.dataset.v === "map") setTimeout(() => map.invalidateSize(), 50);
});

// ---------- Carte ----------
const map = L.map("map", {zoomControl: false, zoomSnap: 0.5}).setView([48.8566, 2.3522], 10);
L.control.zoom({position: "bottomright"}).addTo(map);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 19, className: "dark-tiles", attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
const lg = L.control({position: "bottomleft"}); lg.onAdd = () => { const d = L.DomUtil.create("div", "legend"); d.innerHTML = '<i style="background:#c9a227"></i>Pathé <i style="background:#0b0a07;border:1.5px solid #c9a227"></i>Partenaires CinéPass'; return d; }; lg.addTo(map);
const icon = t => L.divIcon({className: "", iconSize: [26,26], iconAnchor: [13,26], popupAnchor: [0,-26], html: `<div class="pin ${t}"><span>${t==="pathe"?"P":"C"}</span></div>`});
let layer = L.layerGroup().addTo(map);

function photoHTML(c, cls) {
  return c.photo ? `<img class="${cls||""}" src="${esc(c.photo.url)}" alt="${esc(c.name)}" loading="lazy">` : "";
}
function credit(c) {
  if (!c.photo) return `<div class="credit">Pas de photo libre trouvée pour ce cinéma.</div>`;
  return `<div class="credit">Photo : ${esc(c.photo.credit || "")} — <a href="${esc(c.photo.source)}" target="_blank" rel="noopener">source</a></div>`;
}
function filtered(q, t) {
  q = norm(q);
  return CINES.filter(c => (!t || c.type === t) && (!q || norm(c.name + " " + c.city + " " + c.zip + " " + c.address).includes(q)));
}
function renderMap() {
  layer.clearLayers();
  const list = filtered($("#q").value, $("#ftype").value);
  $("#count").textContent = list.length + " cinémas";
  list.forEach(c => {
    if (c.lat == null) return;
    const m = L.marker([c.lat, c.lng], {icon: icon(c.type), title: c.name});
    m.bindPopup(`<div class="pop">${c.photo?photoHTML(c):'<div class="noimg"></div>'}<div class="pb"><h4>${esc(c.name)}</h4><div class="addr">${esc(c.fullAddress)}</div>${credit(c)}
      <div class="acts"><a href="#" onclick="openCine('${c.id}');return false">Fiche</a>${c.type==="pathe"&&c.patheSlug?`<a class="gold" href="#" onclick="cineShows('${c.id}');return false">Séances</a>`:`<a href="${allocine(c)}" target="_blank" rel="noopener">Séances</a>`}</div></div></div>`, {maxWidth: 280, minWidth: 250, autoPanPaddingTopLeft: [10, innerWidth < 700 ? 150 : 90], autoPanPaddingBottomRight: [10, 40]});
    m.on("click", () => innerWidth >= 700 && map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 13), {duration: .6}));
    layer.addLayer(m);
  });
}
$("#q").oninput = $("#ftype").onchange = renderMap;

// ---------- Liste ----------
function renderGrid() {
  const list = filtered($("#q2").value, $("#ftype2").value);
  $("#grid").innerHTML = list.map(c => `<div class="card" onclick="openCine('${c.id}')">
    <div class="ph ${c.photo?"":"none"}" style="${c.photo?`background-image:url('${esc(c.photo.url)}')`:""}">${c.photo?"":"Photo indisponible"}
    <span class="badge b-${c.type}">${c.type==="pathe"?"Pathé":"Partenaire CinéPass"}</span></div>
    <div class="b"><h3>${esc(c.name)}</h3><p>${esc(c.zip)} ${esc(c.city)}</p></div></div>`).join("") || `<div class="empty">Aucun résultat.</div>`;
}
$("#q2").oninput = $("#ftype2").onchange = renderGrid;

// ---------- Fiche cinéma ----------
function gmaps(c) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(c.name + " " + c.fullAddress); }
function allocine(c) { return "https://www.allocine.fr/rechercher/theater/?q=" + encodeURIComponent(c.name.replace(/^Pathé /, "")); }
window.openCine = id => {
  const c = CINES.find(x => x.id === id); if (!c) return;
  const links = [
    c.website && `<a href="${esc(c.website)}" target="_blank" rel="noopener">Page Pathé</a>`,
    c.type !== "pathe" && `<a href="${allocine(c)}" target="_blank" rel="noopener">Séances sur Allociné</a>`,
    `<a href="${gmaps(c)}" target="_blank" rel="noopener">Itinéraire</a>`].filter(Boolean).join(" · ");
  $("#mcontent").innerHTML = `<div class="mhead" style="${c.photo?`background-image:url('${esc(c.photo.url)}')`:""}"></div>
   <div class="mbody"><span class="badge b-${c.type}" style="position:static">${c.type==="pathe"?"Pathé":"Partenaire CinéPass"}</span>
   <h2>${esc(c.name)}</h2><p>${esc(c.fullAddress)}</p>${credit(c)}<p>${links}</p>
   <div id="mshows">${c.type==="pathe" ? (c.patheSlug ? `<button class="primary" onclick="cineShows('${c.id}')">Voir les séances du jour</button>` : `<p class="hint">Séances : voir le site de Pathé.</p>`)
     : `<p class="hint">Les séances des cinémas partenaires ne sont pas publiées par l'API Pathé : utilisez le lien Allociné ou le site du cinéma.</p>`}</div></div>`;
  $("#modal").classList.remove("hidden");
};
window.closeModal = () => $("#modal").classList.add("hidden");
$("#modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
window.cineShows = id => {
  closeModal();
  document.querySelector('nav button[data-v="seances"]').click();
  SEL = new Set([id]); syncPicker(); loadShows();
};

// ---------- Séances ----------
const ymd = d => d.toISOString().slice(0, 10);
let SEL = new Set(), DATE = null;
const days = [...Array(8)].map((_, i) => { const d = new Date(); d.setHours(12); d.setDate(d.getDate() + i); return d; });
DATE = ymd(days[0]);
$("#sdates").innerHTML = days.map((d, i) => `<button data-d="${ymd(d)}" class="${i?"":"on"}">${i===0?"Aujourd'hui":i===1?"Demain":d.toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short"})}</button>`).join("");
$("#sdates").onclick = e => { const b = e.target.closest("button"); if (!b) return; DATE = b.dataset.d; document.querySelectorAll("#sdates button").forEach(x => x.classList.toggle("on", x === b)); loadShows(); };
const patheList = () => CINES.filter(c => c.type === "pathe" && (c.patheSlug || c.allocineId)).sort((a,b)=>a.name.localeCompare(b.name));
function syncPicker() {
  document.querySelectorAll("#plist input").forEach(i => i.checked = SEL.has(i.value));
  $("#pbtn").textContent = SEL.size ? `${SEL.size} cinéma${SEL.size>1?"s":""} sélectionné${SEL.size>1?"s":""} ▾` : "Tous les cinémas Pathé ▾";
  $("#chips").innerHTML = [...SEL].map(id => `<span class="chip" data-id="${id}">${esc(CINES.find(c=>c.id===id).name)} ✕</span>`).join("");
}
$("#pbtn").onclick = e => { e.stopPropagation(); $("#pmenu").classList.toggle("hidden"); $("#psearch").focus(); };
document.addEventListener("click", e => { if (!e.target.closest("#picker")) $("#pmenu").classList.add("hidden"); });
$("#psearch").oninput = () => { const q = norm($("#psearch").value); document.querySelectorAll("#plist label").forEach(l => l.style.display = norm(l.textContent).includes(q) ? "" : "none"); };
$("#plist").onchange = e => { e.target.checked ? SEL.add(e.target.value) : SEL.delete(e.target.value); syncPicker(); };
$("#chips").onclick = e => { const c = e.target.closest(".chip"); if (c) { SEL.delete(c.dataset.id); syncPicker(); } };
function fillCineSelect() {
  $("#plist").innerHTML = patheList().map(c => `<label><input type="checkbox" value="${c.id}">${esc(c.name)}</label>`).join("");
  syncPicker();
}
const showInfo = {};
async function getShow(slug) {
  if (!showInfo[slug]) showInfo[slug] = api("show/" + slug).catch(() => ({slug, title: slug.replace(/-\d+$/, "").replace(/-/g, " ")}));
  return showInfo[slug];
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all([...Array(n)].map(async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
let lastResult = [];
async function loadShows() {
  $("#pmenu").classList.add("hidden");
  const date = DATE; const ids = SEL.size ? [...SEL] : patheList().map(c => c.id);
  return loadAllo(ids, date); // horaires via Allociné (pathe.fr bloque les serveurs)
  $("#shows").innerHTML = ""; const films = {}; let done = 0; FAILS = 0;
  for (const id of ids) {
    const c = CINES.find(x => x.id === id);
    $("#progress").textContent = `Chargement… ${c.name} (${++done}/${ids.length})`;
    let shows;
    try { shows = (await api(`cinema/${c.patheSlug}/shows`)).shows || {}; } catch (e) { FAILS++; continue; }
    const slugs = Object.keys(shows).filter(s => shows[s].days && shows[s].days[date]);
    await pool(slugs, 6, async s => {
      try {
        const [info, times] = await Promise.all([getShow(s), api(`show/${s}/showtimes/${c.patheSlug}/${date}`)]);
        if (!Array.isArray(times) || !times.length) return;
        (films[s] ||= {info, by: []}).by.push({c, times});
      } catch (e) { FAILS++; }
    });
  }
  $("#progress").textContent = `Source : pathe.fr – mis à jour à ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`;
  lastResult = Object.values(films).sort((a, b) => (b.info.next24ShowtimesCount||0) - (a.info.next24ShowtimesCount||0));
  renderShows();
}
const rt = r => { const m = String(r||"").match(/(\d+)h\s*(\d+)?/); return m ? +m[1]*60 + +(m[2]||0) : 0; };
async function loadAllo(ids, date) {
  $("#shows").innerHTML = ""; const films = {}; let done = 0; FAILS = 0;
  $("#progress").textContent = "Chargement des séances…";
  let ALL = null;
  if (!SEL.size) { try { ALL = (await fetch("/allocine-all/" + date).then(j)).cinemas; } catch (e) { FAILS++; } }
  await pool(ids, 4, async id => {
    const c = CINES.find(x => x.id === id);
    if (!c.allocineId) { FAILS++; return; }
    let d; if (ALL) d = {films: ALL[id] || []}; else try { d = await fetch(`/allocine/${c.allocineId}/${date}`).then(j); } catch (e) { FAILS++; return; }
    $("#progress").textContent = `Chargement… (${++done}/${ids.length})`;
    (d.films || []).forEach(f => {
      const k = norm(f.title);
      const info = films[k]?.info || {title: f.title, originalTitle: f.originalTitle, posterPath: f.poster ? {md: f.poster} : null, genres: f.genres, duration: rt(f.runtime), directors: f.directors, next24ShowtimesCount: 0};
      info.next24ShowtimesCount += f.times.length;
      const times = f.times.map(t => { const dur = info.duration; const st = new Date(t.time); const en = dur ? new Date(st.getTime() + (dur + 15) * 60000) : null;
        return {time: t.time.replace("T", " "), version: t.version, refCmd: t.url, endTime: en ? "0000-00-00 " + en.toTimeString().slice(0,5) : "", auditoriumName: (t.tags||[]).join(" ")}; });
      if (times.length) (films[k] ||= {info, by: []}).by.push({c, times});
    });
  });
  $("#progress").textContent = `Source : Allociné (horaires Pathé) – mis à jour à ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`;
  lastResult = Object.values(films).sort((a, b) => b.info.next24ShowtimesCount - a.info.next24ShowtimesCount);
  renderShows();
}
function renderShows() {
  const q = norm($("#sfilm").value), ver = $("#sver").value;
  const html = lastResult.filter(f => !q || norm(f.info.title + " " + (f.info.originalTitle||"")).includes(q)).map(f => {
    const lines = f.by.map(({c, times}) => {
      const t = times.filter(s => !ver || (s.version||"").toLowerCase().includes(ver)).sort((a,b)=>a.time.localeCompare(b.time));
      if (!t.length) return "";
      return `<div class="cine-line"><b>${esc(c.name)}</b>${t.map(s => {
        const h = s.time.slice(11, 16), v = (s.version||"").toUpperCase();
        const href = s.refCmd || c.website;
        const past = new Date(s.time.replace(" ", "T")) < new Date() || (s.status && s.status !== "available");
        return `<a class="t${past?" past":""}" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(s.auditoriumName||"")} – réserver sur pathe.fr"><b>${h}</b><small>${esc(v)}</small>${s.endTime?`<span class="end">fin ~${esc(s.endTime.slice(11,16))}</span>`:""}</a>`;
      }).join("")}</div>`;
    }).join("");
    if (!lines) return "";
    const i = f.info;
    return `<div class="film">${i.posterPath ? `<img src="${esc(i.posterPath.md)}" alt="" loading="lazy">` : `<img alt="">`}
      <div><h3>${esc(i.title)}</h3><div class="meta">${[(i.genres||[]).join(", "), i.duration && `${Math.floor(i.duration/60)}h${String(i.duration%60).padStart(2,"0")}`, i.directors && "de " + i.directors].filter(Boolean).map(esc).join(" · ")}</div>${lines}</div></div>`;
  }).join("");
  $("#shows").innerHTML = (FAILS ? `<div class="empty">⚠️ La source des horaires n'a pas répondu pour ${FAILS} requête(s). Touchez « Afficher les séances » pour réessayer.</div>` : "") + (html || (FAILS ? "" : `<div class="empty">Aucune séance trouvée pour ces critères.</div>`));
}
$("#sload").onclick = loadShows;
$("#sfilm").oninput = $("#sver").onchange = renderShows;

// ---------- Films ----------
let FDATE = ymd(days[0]), FILMS = [];
$("#fdates").innerHTML = $("#sdates").innerHTML;
$("#fdates").onclick = e => { const b = e.target.closest("button"); if (!b) return; FDATE = b.dataset.d; document.querySelectorAll("#fdates button").forEach(x => x.classList.toggle("on", x === b)); loadFilms(); };
const EV = {Live: "En direct", Premier: "Avant-première", Preview: "Avant-première", Opera: "Opéra", Concert: "Concert", Ballet: "Ballet", Marathon: "Marathon"};
function classify(f, date) {
  const Y = +date.slice(0, 4), D = new Date(date);
  const rel = (f.releases || []).filter(r => r.name === "Released" && r.date).map(r => r.date).sort()[0];
  const evs = new Set(f.times.flatMap(t => t.events || []));
  const prem = f.isPremiere || f.times.some(t => t.preview) || evs.has("Premier") || evs.has("Preview") || (rel && rel > date && (!f.year || f.year >= Y - 1));
  const retro = !!f.year && f.year <= Y - 3;
  const fresh = !retro && rel && (D - new Date(rel)) / 864e5 <= 14 && rel <= date;
  const special = [...evs].filter(e => e !== "Premier" && e !== "Preview").map(e => EV[e] || "Séance spéciale");
  return {rel, prem, retro, fresh, special};
}
async function loadFilms() {
  const date = FDATE; $("#fprogress").textContent = "Chargement des films à l’affiche…";
  let d; try { d = await fetch("/allocine-all/" + date).then(j); } catch (e) { $("#fprogress").textContent = "⚠️ Impossible de charger les films. Réessayez."; return; }
  if (date !== FDATE) return;
  const by = {};
  Object.entries(d.cinemas).forEach(([cid, films]) => (films || []).forEach(f => {
    const c = CINES.find(x => x.id === cid); const k = f.id || norm(f.title);
    const F = by[k] ||= {...f, times: [], by: []};
    F.times.push(...f.times); F.by.push({c, times: f.times});
    F.isPremiere ||= f.isPremiere;
  }));
  FILMS = Object.values(by).map(f => ({...f, cl: classify(f, date), n: f.times.length})).sort((a, b) => b.n - a.n);
  $("#fprogress").textContent = `${FILMS.length} films à l’affiche ce jour-là · source Allociné · mis à jour à ${new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`;
  renderFilms();
}
function posterHTML(f, i) {
  const t = [f.cl.prem && `<span class="tag g">Avant-première</span>`, ...f.cl.special.slice(0,1).map(s => `<span class="tag g">${esc(s)}</span>`), f.cl.fresh && `<span class="tag">Nouveauté</span>`, f.cl.retro && `<span class="tag">Rétro ${f.year}</span>`].filter(Boolean).join("");
  return `<div class="poster" onclick="openFilm(${i})"><div class="im" style="${f.poster?`background-image:url('${esc(f.poster)}')`:""}"></div><div class="tags">${t}</div><h4>${esc(f.title)}</h4><small>${f.by.length} cinéma${f.by.length>1?"s":""} · ${f.n} séance${f.n>1?"s":""}</small></div>`;
}
function renderFilms() {
  const q = norm($("#ffilm").value); const L = FILMS.map((f, i) => [f, i]).filter(([f]) => !q || norm(f.title + " " + (f.originalTitle||"")).includes(q));
  const sec = (sel, arr) => $(sel).innerHTML = arr.map(([f, i]) => posterHTML(f, i)).join("") || `<div class="empty">Aucun film dans cette catégorie pour ce jour.</div>`;
  sec("#f-new", L.filter(([f]) => f.cl.prem || f.cl.special.length || f.cl.fresh).sort(([a],[b]) => (b.cl.prem + !!b.cl.special.length) - (a.cl.prem + !!a.cl.special.length)));
  sec("#f-retro", L.filter(([f]) => f.cl.retro));
  sec("#f-all", L);
}
$("#ffilm").oninput = renderFilms;
window.openFilm = i => {
  const f = FILMS[i]; const now = new Date();
  const lines = f.by.sort((a,b)=>a.c.name.localeCompare(b.c.name)).map(({c, times}) => `<div class="cine-line"><b>${esc(c.name)}</b>${times.slice().sort((a,b)=>a.time.localeCompare(b.time)).map(t => {
    const past = new Date(t.time) < now; const ev = (t.events||[]).length ? " ★" : "";
    return `<a class="t${past?" past":""}" href="${esc(t.url || c.website)}" target="_blank" rel="noopener"><b>${t.time.slice(11,16)}</b><small>${esc((t.version||"").toUpperCase())}${ev}</small></a>`; }).join("")}</div>`).join("");
  const meta = [f.year && (f.cl.retro ? "Film de " + f.year : f.year), (f.genres||[]).join(", "), f.runtime, f.directors && "de " + f.directors].filter(Boolean).map(esc).join(" · ");
  const lab = [f.cl.prem && "Avant-première", ...f.cl.special, f.cl.fresh && "Nouveauté (sortie le " + new Date(f.cl.rel).toLocaleDateString("fr-FR") + ")", f.cl.retro && "Séance rétro"].filter(Boolean);
  $("#mcontent").innerHTML = `<div class="mbody fd">${f.poster?`<img class="poster-l" src="${esc(f.poster)}" alt="">`:""}<h2>${esc(f.title)}</h2>
    <div class="tags" style="position:static;margin-bottom:8px">${lab.map(l=>`<span class="tag g">${esc(l)}</span>`).join("")}</div><p class="hint">${meta}</p><p class="syn">${esc(f.synopsis||"")}</p>
    <h3 style="clear:both;color:var(--gold2)">Séances – ${new Date(FDATE).toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</h3>${lines}<p class="hint">Touchez un horaire pour réserver sur pathe.fr. ★ = séance spéciale.</p></div>`;
  $("#modal").classList.remove("hidden");
};
loadFilms();

// ---------- Données Pathé en direct (photos, GPS, slugs) ----------
async function live() {
  try {
    const all = await api("cinemas");
    LIVE = true;
    const arr = Array.isArray(all) ? all : Object.values(all);
    const bySlug = {}, byName = {};
    arr.forEach(p => { bySlug[p.slug] = p; byName[norm(p.name)] = p; });
    CINES.forEach(c => {
      if (c.type !== "pathe") return;
      let p = (c.patheSlug && bySlug[c.patheSlug]) || byName[norm(c.name)];
      if (!p) p = arr.find(x => norm(x.name).includes(norm(c.name.replace(/^(Pathé|Gaumont) /, ""))) && /pathe|gaumont/.test(x.slug));
      if (!p) return;
      c.patheSlug = p.slug; c.website = "https://www.pathe.fr/cinemas/" + p.slug;
      const g = p.theaters && p.theaters[0] && p.theaters[0].gpsPosition;
      if (g && g.x && g.y) { c.lat = +g.x; c.lng = +g.y; }
      if (p.backdrop) c.photo = {url: p.backdrop, credit: "Pathé", source: c.website};
    });
  } catch (e) {
    return renderMap(), renderGrid(), fillCineSelect();
    $("#banner").classList.remove("hidden");
  }
  renderMap(); renderGrid(); fillCineSelect();
}
renderMap(); renderGrid(); fillCineSelect();
live();
map.on("popupopen", e => { if (innerWidth < 700) { const px = map.project(e.popup.getLatLng()); map.panTo(map.unproject(px.subtract([0, 170])), {animate: true}); } });
