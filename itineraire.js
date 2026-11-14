"use strict";
/* Pathé & co v25 : itinéraires à pied, à vélo et en transports sur la carte existante (OSRM + IDFM). */
const OSRM_BASE = {foot: "https://routing.openstreetmap.de/routed-foot/route/v1/driving/", bike: "https://routing.openstreetmap.de/routed-bike/route/v1/driving/"};
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const ROUTE_CACHE = new Map();
const MODIF_FR = {"left": "à gauche", "right": "à droite", "sharp left": "franchement à gauche", "sharp right": "franchement à droite", "slight left": "légèrement à gauche", "slight right": "légèrement à droite", "straight": "tout droit", "uturn": "demi-tour"};
let routeLayer, routeState = null;

function routeEl() { return document.getElementById("route-sheet"); }
function ensureRouteLayer() { if (!routeLayer) routeLayer = L.layerGroup().addTo(map); return routeLayer; }
function routeKey(mode, o, d) { return mode + ":" + o.lat.toFixed(5) + "," + o.lng.toFixed(5) + ":" + d.lat.toFixed(5) + "," + d.lng.toFixed(5); }
function fmtMin(sec) { const m = Math.round((+sec || 0) / 60); if (m < 1) return "moins d’1 min"; if (m < 60) return m + " min"; const h = Math.floor(m / 60), r = m % 60; return r ? h + " h " + r + " min" : h + " h"; }
function fmtDist(m) { m = Math.round(+m || 0); if (m < 1000) return m + " m"; return (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace(".", ",") + " km"; }
function fmtClock(iso) { if (!iso) return ""; const d = new Date(iso.length === 19 ? iso : iso); return isNaN(d) ? "" : d.toLocaleTimeString("fr-FR", {hour: "2-digit", minute: "2-digit"}); }
function nthFr(n) { return n === 1 ? "1re" : n + "e"; }

function osrmInstruction(step) {
  const man = step.maneuver || {}, type = man.type || "", mod = man.modifier || "", name = (step.name || "").trim();
  const sur = name ? " sur " + name : "", dir = MODIF_FR[mod] || "";
  if (type === "depart") return "Partez" + sur;
  if (type === "arrive") return "Vous arrivez à destination" + (name ? " (" + name + ")" : "");
  if (type === "turn" || type === "end of road") {
    if (mod === "uturn") return "Faites demi-tour" + sur;
    if (mod === "straight") return "Continuez tout droit" + sur;
    return (type === "end of road" ? "Au bout de la route, tournez " : "Tournez ") + (dir || "à droite") + sur;
  }
  if (type === "new name" || type === "continue") return (mod && mod !== "straight" ? "Continuez " + dir : "Continuez") + sur;
  if (type === "merge") return "Rejoignez" + (name ? " " + name : dir ? " " + dir : "");
  if (type === "on ramp") return "Prenez la bretelle" + (dir ? " " + dir : "") + sur;
  if (type === "off ramp" || type === "exit") return "Sortez" + (dir ? " " + dir : "") + sur;
  if (type === "fork") return "Prenez " + (dir || "tout droit") + " à la bifurcation" + sur;
  if (type === "roundabout" || type === "rotary" || type === "roundabout turn") return (man.exit ? "Au rond-point, prenez la " + nthFr(man.exit) + " sortie" : "Prenez le rond-point") + sur;
  if (type === "exit roundabout" || type === "exit rotary") return "Sortez du rond-point" + sur;
  if (type === "notification") return name ? "Continuez sur " + name : "Continuez";
  return name ? "Continuez sur " + name : (dir ? "Continuez " + dir : "Continuez");
}

function transitLabel(sec) {
  const mode = sec.mode || "", line = sec.line ? " " + sec.line : "";
  const from = sec.from || "", to = sec.to || "";
  if (mode === "waiting") return "Attente" + (sec.duration ? " (" + fmtMin(sec.duration) + ")" : "");
  if (mode === "transfer") return "Correspondance" + (from || to ? " — " + [from, to].filter(Boolean).join(" → ") : "");
  if (mode === "walking") return "Marche à pied" + (to ? " jusqu’à " + to : from ? " depuis " + from : "");
  if (mode === "bike") return "Vélo" + (to ? " jusqu’à " + to : "");
  const kind = {metro: "Métro", rer: "RER", tram: "Tram", bus: "Bus", train: "Train", transit: "Transport"}[mode] || "Transport";
  const trip = from && to ? from + " → " + to : (to || from);
  return kind + line + (trip ? " — " + trip : "");
}

function drawMe(o) {
  const layer = ensureRouteLayer();
  L.circleMarker([o.lat, o.lng], {radius: 8, color: "#f1d784", fillColor: "#c9a227", fillOpacity: 1, weight: 2}).addTo(layer).bindTooltip("Départ");
}

function fitRoute(b) {
  if (!b || !b.isValid()) return;
  const sheet = routeEl(), h = sheet && !sheet.hidden ? Math.min(sheet.offsetHeight || 280, 360) : 120;
  map.fitBounds(b, {paddingTopLeft: [24, 88], paddingBottomRight: [24, h + 16], maxZoom: 16, animate: true});
}

function drawOsrm(routes, selected) {
  const layer = ensureRouteLayer();
  layer.clearLayers();
  const o = routeState.origin, d = routeState.dest;
  if (o) drawMe(o);
  if (d) L.circleMarker([d.lat, d.lng], {radius: 9, color: "#fff", fillColor: "#c9a227", fillOpacity: 1, weight: 2}).addTo(layer).bindTooltip(d.name || "Cinéma");
  const bounds = L.latLngBounds([]);
  routes.forEach((r, i) => {
    const coords = ((r.geometry || {}).coordinates || []).map(p => [p[1], p[0]]);
    if (coords.length < 2) return;
    const main = i === selected;
    const line = L.polyline(coords, {color: "#c9a227", weight: main ? 6 : 4, opacity: main ? 0.95 : 0.35, lineJoin: "round", interactive: true});
    line.on("click", e => { L.DomEvent.stopPropagation(e); selectAlt(i); });
    line.addTo(layer);
    coords.forEach(c => bounds.extend(c));
  });
  if (o) bounds.extend([o.lat, o.lng]);
  if (d) bounds.extend([d.lat, d.lng]);
  fitRoute(bounds);
}

function drawTransit(journey) {
  const layer = ensureRouteLayer();
  layer.clearLayers();
  const o = routeState.origin, d = routeState.dest;
  if (o) drawMe(o);
  if (d) L.circleMarker([d.lat, d.lng], {radius: 9, color: "#fff", fillColor: "#c9a227", fillOpacity: 1, weight: 2}).addTo(layer).bindTooltip(d.name || "Cinéma");
  const bounds = L.latLngBounds([]);
  (journey.sections || []).forEach(sec => {
    const coords = ((sec.geojson || {}).coordinates || []).map(p => [p[1], p[0]]);
    if (coords.length < 2) return;
    const walk = sec.mode === "walking" || sec.mode === "transfer" || sec.mode === "bike";
    const color = walk ? "#c9a227" : (sec.color || "#6b8afd");
    L.polyline(coords, {color, weight: walk ? 4 : 6, opacity: walk ? 0.75 : 0.95, dashArray: walk ? "7 8" : null, lineJoin: "round"}).addTo(layer);
    coords.forEach(c => bounds.extend(c));
  });
  if (o) bounds.extend([o.lat, o.lng]);
  if (d) bounds.extend([d.lat, d.lng]);
  fitRoute(bounds);
}

function selectAlt(i) {
  if (!routeState || !routeState.routes) return;
  routeState.selected = i;
  if (routeState.mode === "transit") {
    const j = routeState.routes[i];
    if (j) drawTransit(j);
  } else drawOsrm(routeState.routes, i);
  renderRouteBody();
}

async function fetchOsrm(mode, o, d) {
  const key = routeKey(mode, o, d);
  if (ROUTE_CACHE.has(key)) return ROUTE_CACHE.get(key);
  const url = OSRM_BASE[mode] + o.lng + "," + o.lat + ";" + d.lng + "," + d.lat + "?overview=full&geometries=geojson&alternatives=true&steps=true";
  const res = await fetch(url, {headers: {Accept: "application/json"}});
  if (!res.ok) throw new Error("osrm");
  const data = await res.json();
  if (data.code !== "Ok" || !(data.routes || []).length) throw new Error("osrm");
  const routes = data.routes.map(r => ({
    duration: r.duration, distance: r.distance, geometry: r.geometry,
    steps: (r.legs || []).flatMap(leg => (leg.steps || []).map(s => ({instruction: osrmInstruction(s), distance: s.distance, duration: s.duration, name: s.name || ""})))
  }));
  ROUTE_CACHE.set(key, routes);
  return routes;
}

async function fetchTransit(o, d) {
  const key = routeKey("transit", o, d);
  if (ROUTE_CACHE.has(key)) return ROUTE_CACHE.get(key);
  const q = "from=" + encodeURIComponent(o.lat + "," + o.lng) + "&to=" + encodeURIComponent(d.lat + "," + d.lng);
  const res = await fetch("/api/transit?" + q, {headers: {Accept: "application/json"}});
  const data = await res.json().catch(() => ({}));
  if (res.status === 503 && data.error === "no_key") { const v = {noKey: true}; ROUTE_CACHE.set(key, v); return v; }
  if (!res.ok) throw new Error(data.error || "transit");
  ROUTE_CACHE.set(key, data);
  return data;
}

function originLine() {
  const o = routeState.origin, typed = routeState.originLabel;
  if (o && typed) return "Départ : " + typed;
  if (o) return "Départ : votre position";
  return "Indiquez un point de départ";
}

function renderRouteShell() {
  const el = routeEl(), s = routeState, c = s.cinema;
  const mode = s.mode || "foot";
  el.hidden = false; el.classList.remove("hidden");
  el.innerHTML = `<div class="grab" aria-hidden="true"></div>
    <div class="rs-hd"><div><h2>Itinéraire</h2><p class="sub">${esc(c.name)}${c.city ? " · " + esc(c.city) : ""}</p></div>
    <button type="button" class="rs-x" onclick="closeRoute()" aria-label="Fermer l’itinéraire">✕</button></div>
    <p class="rs-from" id="rs-from">${esc(originLine())}</p>
    <div id="rs-origin"></div>
    <div class="rs-modes" role="tablist" aria-label="Mode de déplacement">
      <button type="button" role="tab" data-m="foot" aria-selected="${mode === "foot"}" class="${mode === "foot" ? "on" : ""}">À pied</button>
      <button type="button" role="tab" data-m="bike" aria-selected="${mode === "bike"}" class="${mode === "bike" ? "on" : ""}">À vélo</button>
      <button type="button" role="tab" data-m="transit" aria-selected="${mode === "transit"}" class="${mode === "transit" ? "on" : ""}">Transports</button>
    </div>
    <div id="rs-body" class="rs-body"></div>
    <p class="rs-attr">Itinéraires à pied et à vélo © <a href="https://routing.openstreetmap.de/" target="_blank" rel="noopener">OSRM</a> — données © les contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>. Transports : Île-de-France Mobilités.</p>`;
  el.querySelectorAll(".rs-modes button").forEach(b => b.onclick = () => setRouteMode(b.dataset.m));
  renderOriginBox();
  renderRouteBody();
}

function renderOriginBox() {
  const box = document.getElementById("rs-origin");
  if (!box) return;
  if (routeState.origin && !routeState.needOrigin) { box.innerHTML = `<button type="button" class="rs-chg" onclick="routeChangeOrigin()">Changer le départ</button>`; return; }
  box.innerHTML = `<form id="rs-form" class="rs-form">
      <label for="rs-addr">Adresse de départ</label>
      <div class="rs-row"><input id="rs-addr" type="search" enterkeyhint="search" autocomplete="street-address" placeholder="Adresse, ville…" aria-label="Adresse de départ">
      <button type="submit" class="primary">Valider</button></div>
      <button type="button" class="ghost rs-geo" id="rs-geo">Utiliser ma position</button>
      <p class="sub" id="rs-oerr" hidden></p>
      <div id="rs-sugg" class="rs-sugg" hidden></div>
    </form>`;
  document.getElementById("rs-form").onsubmit = e => { e.preventDefault(); geocodeOrigin(); };
  document.getElementById("rs-geo").onclick = () => askLocate(true);
}

function renderRouteBody() {
  const body = document.getElementById("rs-body");
  if (!body || !routeState) return;
  if (routeState.needOrigin && !routeState.origin) { body.innerHTML = `<p class="sub">Autorisez la localisation ou saisissez une adresse pour calculer l’itinéraire.</p>`; return; }
  if (routeState.loading) { body.innerHTML = `<p class="sub">Calcul de l’itinéraire…</p>`; return; }
  if (routeState.error === "no_key") { body.innerHTML = `<p class="sub">Itinéraires en transports indisponibles pour le moment.</p>`; return; }
  if (routeState.error) { body.innerHTML = `<p class="sub">${esc(routeState.error)}</p>`; return; }
  const routes = routeState.routes || [], i = routeState.selected || 0, mode = routeState.mode;
  if (!routes.length) { body.innerHTML = `<p class="sub">Aucun itinéraire trouvé.</p>`; return; }
  if (mode === "transit") {
    body.innerHTML = routes.map((j, k) => {
      const on = k === i, dep = fmtClock(j.departure), arr = fmtClock(j.arrival);
      const when = [dep && ("Départ " + dep), arr && ("arrivée " + arr)].filter(Boolean).join(" · ");
      const tr = j.transfers ? (j.transfers + (j.transfers > 1 ? " correspondances" : " correspondance")) : "Sans correspondance";
      const steps = (j.sections || []).filter(s => s.mode !== "waiting" || s.duration >= 60).map(s => {
        const col = s.color ? ` style="--lc:${esc(s.color)}"` : "";
        const badge = s.line ? `<span class="rs-line"${col}>${esc(s.line)}</span>` : "";
        return `<li>${badge}<span>${esc(transitLabel(s))}${s.duration ? " · " + fmtMin(s.duration) : ""}</span></li>`;
      }).join("");
      return `<button type="button" class="rs-alt${on ? " on" : ""}" data-i="${k}" aria-pressed="${on}"><b>${esc(fmtMin(j.duration))}</b> · ${esc(tr)}${when ? `<small>${esc(when)}</small>` : ""}</button>
        ${on ? `<details class="rs-steps" open><summary>Étapes</summary><ol>${steps}</ol></details>` : ""}`;
    }).join("");
  } else {
    body.innerHTML = routes.map((r, k) => {
      const on = k === i;
      const steps = (r.steps || []).map(s => `<li>${esc(s.instruction)}${s.distance ? " <small>" + esc(fmtDist(s.distance)) + "</small>" : ""}</li>`).join("");
      const label = routes.length > 1 ? (k === 0 ? "Itinéraire recommandé" : "Variante " + k) : "Itinéraire";
      return `<button type="button" class="rs-alt${on ? " on" : ""}" data-i="${k}" aria-pressed="${on}"><b>${esc(fmtMin(r.duration))}</b> · ${esc(fmtDist(r.distance))}<small>${esc(label)}</small></button>
        ${on ? `<details class="rs-steps"><summary>Étapes</summary><ol>${steps}</ol></details>` : ""}`;
    }).join("");
  }
  body.querySelectorAll(".rs-alt").forEach(b => b.onclick = () => selectAlt(+b.dataset.i));
}

async function loadMode() {
  const s = routeState; if (!s || !s.origin || !s.dest) return;
  s.loading = true; s.error = ""; s.routes = []; renderRouteBody();
  try {
    if (s.mode === "transit") {
      const data = await fetchTransit(s.origin, s.dest);
      if (data.noKey) { s.error = "no_key"; s.routes = []; ensureRouteLayer().clearLayers(); if (s.origin) { ensureRouteLayer(); drawMe(s.origin); } }
      else {
        s.routes = data.journeys || [];
        s.selected = 0;
        if (s.routes[0]) drawTransit(s.routes[0]);
      }
    } else {
      const routes = await fetchOsrm(s.mode, s.origin, s.dest);
      s.routes = routes; s.selected = 0; drawOsrm(routes, 0);
    }
  } catch (e) {
    s.routes = [];
    s.error = s.mode === "transit" ? "Itinéraires en transports indisponibles pour le moment." : "Itinéraire indisponible pour le moment.";
    ensureRouteLayer().clearLayers();
  }
  s.loading = false; renderRouteBody();
}

function setRouteMode(mode) {
  if (!routeState || routeState.mode === mode) return;
  routeState.mode = mode; routeState.selected = 0; routeState.error = "";
  renderRouteShell();
  if (routeState.origin) loadMode();
}

window.routeChangeOrigin = () => { if (!routeState) return; routeState.needOrigin = true; renderOriginBox(); renderRouteBody(); const inp = document.getElementById("rs-addr"); if (inp) inp.focus(); };

async function geocodeOrigin() {
  const inp = document.getElementById("rs-addr"), err = document.getElementById("rs-oerr"), sugg = document.getElementById("rs-sugg");
  const q = (inp && inp.value || "").trim();
  if (err) { err.hidden = true; err.textContent = ""; }
  if (sugg) { sugg.hidden = true; sugg.innerHTML = ""; }
  if (q.length < 3) { if (err) { err.hidden = false; err.textContent = "Saisissez une adresse plus précise."; } return; }
  try {
    const url = NOMINATIM + "?format=json&limit=5&addressdetails=0&countrycodes=fr&accept-language=fr&q=" + encodeURIComponent(q);
    const res = await fetch(url, {headers: {Accept: "application/json"}});
    if (!res.ok) throw new Error("geo");
    const hits = await res.json();
    if (!Array.isArray(hits) || !hits.length) { if (err) { err.hidden = false; err.textContent = "Adresse introuvable, essayez une autre saisie."; } return; }
    if (hits.length === 1) return applyOrigin({lat: +hits[0].lat, lng: +hits[0].lon}, hits[0].display_name);
    sugg.hidden = false;
    sugg.innerHTML = hits.map((h, i) => `<button type="button" data-i="${i}">${esc(h.display_name)}</button>`).join("");
    sugg.querySelectorAll("button").forEach(b => b.onclick = () => applyOrigin({lat: +hits[+b.dataset.i].lat, lng: +hits[+b.dataset.i].lon}, hits[+b.dataset.i].display_name));
  } catch (e) {
    if (err) { err.hidden = false; err.textContent = "La recherche d’adresse est indisponible pour le moment."; }
  }
}

function applyOrigin(o, label) {
  if (!routeState || o.lat == null || o.lng == null || Number.isNaN(o.lat) || Number.isNaN(o.lng)) return;
  routeState.origin = {lat: o.lat, lng: o.lng};
  routeState.originLabel = label || "";
  routeState.needOrigin = false;
  const from = document.getElementById("rs-from"); if (from) from.textContent = originLine();
  renderOriginBox();
  loadMode();
}

async function askLocate(force) {
  const err = document.getElementById("rs-oerr");
  try {
    const g = await locate();
    applyOrigin({lat: g.lat, lng: g.lng}, "");
  } catch (e) {
    routeState.needOrigin = true;
    renderOriginBox();
    const box = document.getElementById("rs-oerr");
    if (box) { box.hidden = false; box.textContent = force || !GEO ? "Position refusée : autorisez la localisation, ou saisissez une adresse." : e.message; }
    else if (err) { err.hidden = false; err.textContent = e.message; }
    if (!force && GEO) applyOrigin(GEO, "");
  }
}

window.openRoute = async id => {
  const c = typeof byId === "function" ? byId(id) : (window.CINES || []).find(x => x.id === id);
  if (!c) return;
  if (c.lat == null || c.lng == null) { if (typeof toast === "function") toast("Position du cinéma inconnue."); else alert("Position du cinéma inconnue."); return; }
  if (typeof closeModal === "function") closeModal();
  if (typeof closeSheet === "function") closeSheet();
  if (typeof map.closePopup === "function") map.closePopup();
  if (typeof go === "function") go("map");
  routeState = {cinema: c, dest: {lat: +c.lat, lng: +c.lng, name: c.name}, origin: GEO || null, originLabel: "", mode: "foot", selected: 0, routes: [], loading: false, error: "", needOrigin: !GEO};
  ensureRouteLayer().clearLayers();
  renderRouteShell();
  setTimeout(() => map.invalidateSize(), 80);
  if (GEO) applyOrigin(GEO, routeState.originLabel);
  else await askLocate(false);
};

window.closeRoute = () => {
  const el = routeEl();
  if (el) { el.classList.add("hidden"); el.hidden = true; el.innerHTML = ""; }
  if (routeLayer) routeLayer.clearLayers();
  routeState = null;
};

document.getElementById("nav") && document.getElementById("nav").addEventListener("click", ev => {
  const b = ev.target.closest("button[data-v]");
  if (b && b.dataset.v !== "map" && routeState) closeRoute();
});
