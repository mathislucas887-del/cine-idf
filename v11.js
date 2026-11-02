// v11 : 4 espaces (Accueil / Explorer / Collection / Profil), Ciné XP, défis, badges, collections, social
(function () {
"use strict";
const today = () => ymd(new Date());
const isoWeek = d => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - n); const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return x.getUTCFullYear() + "-W" + String(Math.ceil(((x - y) / 864e5 + 1) / 7)).padStart(2, "0"); };
const WEEK = () => isoWeek(new Date()), MONTH = () => today().slice(0, 7);
// ---------- Moteur Ciné XP ----------
const PTS = {watch: 10, cine: 20, fiche: 5, ticket: 25, seen: 30, challenge: 50, lb: 100, mission: 30, match: 5};
const CAP = {fiche: 10, watch: 10, cine: 3, ticket: 5, seen: 5, mission: 3, match: 30};
const LABEL = {watch: "Ajout à la watchlist", cine: "Nouveau cinéma", fiche: "Fiche film découverte", ticket: "Billet ajouté", seen: "Film vu", challenge: "Défi réussi", lb: "Watchlist Letterboxd importée", mission: "Mission du jour", match: "CinéMatch"};
const LEVELS = [[0, "Curieux", "🌱"], [250, "Amateur", "🎟️"], [750, "Cinéphile", "🎬"], [1750, "Passionné", "🔥"], [3500, "Expert", "🏆"], [7000, "Légende du cinéma", "👑"]];
function G() { GAME.xp = GAME.xp || 0; GAME.done = GAME.done || {}; GAME.days = GAME.days || {}; GAME.wk = GAME.wk || {}; GAME.mo = GAME.mo || {}; GAME.seen = GAME.seen || {}; GAME.cines = GAME.cines || {}; GAME.hist = GAME.hist || []; GAME.genres = GAME.genres || {}; GAME.cinefiche = GAME.cinefiche || {}; return GAME; }
let syncT; const saveGame = () => { LS.set("game", GAME); clearTimeout(syncT); syncT = setTimeout(() => { sync(); autoPublish(); }, 1500); };
function level(xp) { let i = 0; while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++; const [min, name, ic] = LEVELS[i], next = LEVELS[i + 1]; return {i, name, ic, min, next: next ? next[0] : null, nextName: next ? next[1] : null, pct: next ? Math.round((xp - min) / (next[0] - min) * 100) : 100}; }
function award(type, key, pts) {
  const g = G(), id = type + ":" + key; if (g.done[id]) return 0;
  const d = g.days[today()] = g.days[today()] || {xp: 0, n: {}};
  if (CAP[type] && (d.n[type] || 0) >= CAP[type]) { d.n[type + "_capped"] = 1; return 0; }
  const p = pts || PTS[type] || 0, before = level(g.xp).i;
  g.done[id] = today(); d.n[type] = (d.n[type] || 0) + 1; d.xp += p; g.xp += p; g.wk[WEEK()] = (g.wk[WEEK()] || 0) + p; g.mo[MONTH()] = (g.mo[MONTH()] || 0) + p;
  g.hist.unshift({t: type, k: String(key).slice(0, 60), p, at: Date.now()}); g.hist.length = Math.min(g.hist.length, 40);
  const pruneBefore = ymd(Date.now() - 120 * 864e5); Object.keys(g.days).forEach(k => k < pruneBefore && delete g.days[k]);
  saveGame(); const lv = level(g.xp);
  toast(lv.i > before ? `${lv.ic} Niveau ${lv.name} atteint ! (+${p} XP)` : `+${p} XP · ${LABEL[type] || ""}`);
  refresh(); return p; }
window.cineAward = award;
const dayN = (t, day) => ((G().days[day || today()] || {}).n || {})[t] || 0;
// ---------- Données dérivées ----------
const seenKeys = () => { const s = new Set(); (LISTS.seen || []).forEach(x => s.add(lbKey(x.title))); (LB.seen || []).forEach(x => s.add(lbKey(x.n))); return s; };
const seenCount = () => seenKeys().size;
const watchCount = () => new Set([...(LISTS.towatch || []).map(x => lbKey(x.title)), ...(LB.watch || []).map(x => lbKey(x.n))]).size;
const tH = t => +String(t.time || "").slice(11, 13);
const isVO = t => /VO|VOST/i.test(t.version || "");
const inPeriod = (t, p) => String(t.time || "").startsWith(p);
const ticketsWeek = () => TICKETS.filter(t => t.time && isoWeek(new Date(t.time)) === WEEK());
// ---------- Défis ----------
const CH = [
  {id: "nuit", per: "jour", ic: "🌙", t: "Oiseau de nuit", d: "Ajoute un billet pour une séance après 22 h aujourd’hui ou demain.", xp: 50, goal: 1, cur: () => TICKETS.filter(t => tH(t) >= 22 && (inPeriod(t, today()) || inPeriod(t, ymd(Date.now() + 864e5)))).length},
  {id: "marathon", per: "semaine", ic: "🏃", t: "Marathon", d: "Vois 3 films cette semaine (confirmés « Vu »).", xp: 150, goal: 3, view: 1, cur: () => Object.values(G().seen).filter(d => isoWeek(new Date(d)) === WEEK()).length},
  {id: "explo", per: "semaine", ic: "🧭", t: "Explorateur IDF", d: "Va dans 2 nouveaux cinémas cette semaine.", xp: 100, goal: 2, cur: () => Object.values(G().cines).filter(d => isoWeek(new Date(d)) === WEEK()).length},
  {id: "vo", per: "mois", ic: "🌍", t: "Voyageur VO", d: "Réserve 2 séances en VO ce mois-ci.", xp: 75, goal: 2, cur: () => TICKETS.filter(t => isVO(t) && inPeriod(t, MONTH())).length},
  {id: "mois8", per: "mois", ic: "🎞️", t: "Cinéphile du mois", d: "Vois 8 films ce mois-ci (confirmés « Vu »).", xp: 200, goal: 8, view: 1, cur: () => Object.values(G().seen).filter(d => String(d).startsWith(MONTH())).length}];
const perKey = p => p === "jour" ? today() : p === "semaine" ? WEEK() : MONTH();
window.claimCh = id => { const c = CH.find(x => x.id === id); if (!c || c.cur() < c.goal) return;
  if (c.view && !confirm(`Défi « ${c.t} » : confirmes-tu avoir réellement vu ces films ?`)) return;
  award("challenge", id + ":" + perKey(c.per), c.xp); };
// ---------- Missions du jour ----------
const MPOOL = [
  {id: "decouvre", t: "Découvre un nouveau film aujourd’hui", d: "Explore les sorties et enrichis ta watchlist.", ok: () => dayN("watch") >= 1},
  {id: "fiches", t: "Explore 3 fiches films", d: "Bandes-annonces, notes, où le voir.", ok: () => dayN("fiche") >= 3},
  {id: "salle", t: "Repère une salle", d: "Ouvre la fiche d’un cinéma près de chez toi.", go: "list", ok: () => (G().cinefiche[today()] || 0) >= 1},
  {id: "plan", t: "Planifie une séance", d: "Ajoute un billet à ta collection.", go: "seances", ok: () => dayN("ticket") >= 1},
  {id: "vu", t: "Fais le bilan", d: "Marque un film que tu as vu.", go: "billets", ok: () => dayN("seen") >= 1}];
function missions() { const d = today(), h = [...d].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 7); const arr = [...MPOOL]; const out = [];
  for (let i = 0; i < 3; i++) out.push(arr.splice((h >> (i * 3)) % arr.length, 1)[0]); return out; }
window.claimMission = id => { const m = MPOOL.find(x => x.id === id); if (m && m.ok()) award("mission", today() + ":" + id); };
// ---------- Badges & collections ----------
// ---------- Badges géographiques (visites confirmées « J’y suis allé », 1 par cinéma) ----------
const ARR = c => /^75\d{3}$/.test(c.zip || "") ? (+String(c.zip).slice(3) || 0) : 0;
const ELIG = c => c.type === "pathe" || c.type === "partner" || c.cinepass;
const PARIS = () => CINES.filter(c => ELIG(c) && ARR(c) >= 1 && ARR(c) <= 20);
const ARRS = () => [...new Set(PARIS().map(ARR))].sort((a, b) => a - b);
const VIS = () => new Set(Object.keys(G().cines));
const arrDone = () => { const v = VIS(); return new Set(PARIS().filter(c => v.has(c.id)).map(ARR)); };
const parisDone = () => { const v = VIS(); return PARIS().filter(c => v.has(c.id)).length; };
const cities = () => { const v = VIS(), m = {}; CINES.filter(c => ELIG(c) && !ARR(c) && c.city).forEach(c => { const k = c.city; (m[k] ||= {city: k, n: 0, d: 0}).n++; if (v.has(c.id)) m[k].d++; }); return Object.values(m); };
const BADGES = [
  {id: "cent", ic: "💯", t: "100 films vus", cur: seenCount, goal: 100},
  {id: "nuit", ic: "🦉", t: "Oiseau de nuit", d: "5 séances après 22 h", cur: () => TICKETS.filter(t => tH(t) >= 22).length, goal: 5},
  {id: "festi", ic: "🎪", t: "Festivalier", d: "3 avant-premières ou événements", cur: () => TICKETS.filter(t => t.ev).length, goal: 3},
  {id: "vo", ic: "🌍", t: "Explorateur VO", d: "10 séances en VO", cur: () => TICKETS.filter(isVO).length, goal: 10},
  {id: "idf", ic: "🗺️", t: "Explorateur IDF", d: "10 cinémas différents", cur: () => Object.keys(G().cines).length, goal: 10},
  {id: "coll", ic: "📌", t: "Collectionneur", d: "50 films en watchlist", cur: watchCount, goal: 50},
  {id: "tour", ic: "🗼", t: "Tour de Paris", d: "Une séance dans chaque arrondissement ayant un Pathé ou un partenaire", cur: () => arrDone().size, get goal() { return ARRS().length || 1; }},
  {id: "legende", ic: "👑", t: "Légende de Paris", d: "Tous les Pathé et partenaires CinéPass de Paris", gold: 1, cur: parisDone, get goal() { return PARIS().length || 1; }},
  {id: "assidu", ic: "📅", t: "Assidu", d: "30 jours actifs", cur: () => Object.values(G().days).filter(x => x.xp > 0).length, goal: 30}];
const ALLB = () => [...BADGES, ...(window.MATCH_BADGES || [])];
const C = (...a) => a.map(x => x.split("|"));
const COLLS = [
  {id: "classiques", ic: "🏛️", t: "Grands classiques", f: C("Citizen Kane", "Le Parrain|The Godfather", "Casablanca", "Sueurs froides|Vertigo", "2001 : l'odyssée de l'espace|2001: A Space Odyssey", "Les Quatre Cents Coups|The 400 Blows", "À bout de souffle|Breathless", "Les Enfants du paradis|Children of Paradise", "La Grande Illusion|Grand Illusion", "Psychose|Psycho", "Chantons sous la pluie|Singin' in the Rain", "Lawrence d'Arabie|Lawrence of Arabia", "Les Sept Samouraïs|Seven Samurai", "Taxi Driver", "Apocalypse Now", "Le Bon, la Brute et le Truand|The Good, the Bad and the Ugly", "Il était une fois dans l'Ouest|Once Upon a Time in the West", "Metropolis", "Fenêtre sur cour|Rear Window", "Les Temps modernes|Modern Times")},
  {id: "horreur", ic: "🩸", t: "Horreur", f: C("Shining|The Shining", "Psychose|Psycho", "L'Exorciste|The Exorcist", "Halloween", "Alien, le 8ème passager|Alien", "The Thing", "Get Out", "Hérédité|Hereditary", "Massacre à la tronçonneuse|The Texas Chain Saw Massacre", "Rosemary's Baby", "It Follows", "Scream", "Les Dents de la mer|Jaws", "La Nuit des morts-vivants|Night of the Living Dead", "Grave|Raw")},
  {id: "sf", ic: "🚀", t: "Science-fiction", f: C("2001 : l'odyssée de l'espace|2001: A Space Odyssey", "Blade Runner", "Alien, le 8ème passager|Alien", "Matrix|The Matrix", "Interstellar", "Dune", "La Guerre des étoiles|Star Wars", "Terminator 2", "Retour vers le futur|Back to the Future", "E.T. l'extra-terrestre|E.T. the Extra-Terrestrial", "Inception", "Premier contact|Arrival", "Ex Machina", "Bienvenue à Gattaca|Gattaca", "Metropolis")},
  {id: "palmes", ic: "🌴", t: "Palmes d’or à Cannes", f: C("Anatomie d'une chute|Anatomy of a Fall", "Sans filtre|Triangle of Sadness", "Titane", "Parasite", "Une affaire de famille|Shoplifters", "The Square", "Moi, Daniel Blake|I, Daniel Blake", "Dheepan", "Winter Sleep", "La Vie d'Adèle|Blue Is the Warmest Colour", "Amour", "The Tree of Life", "Entre les murs|The Class", "Pulp Fiction", "Apocalypse Now", "Taxi Driver", "Anora", "Un simple accident|It Was Just an Accident")},
  {id: "fr", ic: "🇫🇷", t: "Films français", f: C("Le Fabuleux Destin d'Amélie Poulain|Amélie", "La Haine", "Intouchables|The Intouchables", "Les Quatre Cents Coups|The 400 Blows", "À bout de souffle|Breathless", "Le Dîner de cons|The Dinner Game", "La Grande Vadrouille", "Jules et Jim|Jules and Jim", "Portrait de la jeune fille en feu|Portrait of a Lady on Fire", "Anatomie d'une chute|Anatomy of a Fall", "Les Visiteurs", "Cléo de 5 à 7|Cléo from 5 to 7", "Le Mépris|Contempt", "Un prophète|A Prophet", "Les Choristes|The Chorus")},
  {id: "kubrick", ic: "🎩", t: "Réalisateur : Stanley Kubrick", f: C("2001 : l'odyssée de l'espace|2001: A Space Odyssey", "Shining|The Shining", "Orange mécanique|A Clockwork Orange", "Barry Lyndon", "Full Metal Jacket", "Docteur Folamour|Dr. Strangelove", "Eyes Wide Shut", "Les Sentiers de la gloire|Paths of Glory")},
  {id: "nolan", ic: "⏳", t: "Réalisateur : Christopher Nolan", f: C("Memento", "The Dark Knight", "Inception", "Interstellar", "Dunkerque|Dunkirk", "Tenet", "Oppenheimer", "Le Prestige|The Prestige")},
  {id: "indes", ic: "🎦", t: "Cinémas indépendants d’IDF", indep: 1, goal: 20}];
function collProg(c) {
  if (c.indep) { const n = Object.keys(G().cines).filter(id => (byId(id) || {}).type === "other").length; return {n, g: c.goal, pct: Math.min(100, Math.round(n / c.goal * 100))}; }
  const S = seenKeys(); const n = c.f.filter(v => v.some(t => S.has(lbKey(t)))).length; return {n, g: c.f.length, pct: Math.round(n / c.f.length * 100), items: c.f.map(v => ({t: v[0], ok: v.some(t => S.has(lbKey(t)))}))}; }
// ---------- Accroches sur les actions existantes ----------
const fid = id => (FILMS.find(x => String(x.id) === String(id)) || {});
const noteGenres = f => { let g = f.genres; if (typeof g === "string") try { g = JSON.parse(g.replace(/'/g, '"')); } catch (e) { g = []; } (g || []).forEach(x => G().genres[x] = (G().genres[x] || 0) + 1); };
const oTL = window.toggleList; window.toggleList = (k, id) => { const f = fid(id), had = f.id && inList(k, f);
  if (k === "seen" && !had && f.id && !confirm(`Confirmes-tu avoir vu « ${f.title} » ? (nécessaire pour les défis)`)) return;
  oTL(k, id); if (!f.id || had) return;
  if (k === "towatch") { noteGenres(f); award("watch", f.id); }
  if (k === "seen") { G().seen[f.id] = today(); noteGenres(f); award("seen", f.id) || saveGame(); } };
const oAT = window.addTicket; window.addTicket = k => { const x = (window.TB || TB)[k]; oAT(k); if (!x) return;
  const t = TICKETS.find(y => y.id === x.f.id + "|" + x.c.id + "|" + x.t.time); if (t && !t.ev && (x.f.cl?.ap || (x.t.events || []).length || x.t.preview)) { t.ev = "1"; sync(); }
  award("ticket", x.f.id + "|" + x.c.id + "|" + x.t.time); };
function visitCine(cid, quiet) { if (!cid || G().cines[cid]) return; G().cines[cid] = today(); award("cine", cid) || saveGame(); }
window.iWasThere = cid => { const c = byId(cid); if (!c || G().cines[cid]) return; if (!confirm(`Confirmes-tu être allé au ${c.name} ?`)) return; visitCine(cid); openCine(cid); };
const oOF = openFilm; openFilm = function (id) { const r = oOF.apply(this, arguments); const f = fid(id); if (f.id) { noteGenres(f); award("fiche", f.id); }
  setTimeout(() => { const mb = document.querySelector("#mcontent .mbody"); if (!mb || mb.querySelector(".gbar") || !SOC.friends.length) return;
    mb.insertAdjacentHTML("afterbegin", `<div class="gbar">${SOC.friends.length ? `<button class="ghost" onclick="recoFilm('${esc(id)}')">💌 Recommander à un ami</button>` : ""}</div>`); }, 60); return r; };
window.openFilm = openFilm;
const oOC = window.openCine; window.openCine = async (id, focus, day) => { const r = await oOC(id, focus, day); const g = G(); g.cinefiche[today()] = (g.cinefiche[today()] || 0) + 1; Object.keys(g.cinefiche).forEach(k => k < today() && delete g.cinefiche[k]); saveGame();
  const mb = document.querySelector("#mcontent .mbody"); if (mb && !mb.querySelector(".gbar")) mb.insertAdjacentHTML("afterbegin", `<div class="gbar">${g.cines[id] ? `<span class="chip on">✓ Cinéma visité le ${new Date(g.cines[id]).toLocaleDateString("fr-FR")}</span>` : `<button class="ghost" onclick="iWasThere('${esc(id)}')">📍 J’y suis allé (+20 XP)</button>`}</div>`);
  refresh(); return r; };
function checkLB() { if ((LB.watch || []).length && !G().done["lb:import"]) award("lb", "import"); }
// ---------- Social ----------
const SOC = {me: "", friends: [], board: [], inbox: [], at: 0};
async function loadSocial(force) { if (!TOKEN) return; if (!force && Date.now() - SOC.at < 60000) return; try { Object.assign(SOC, await post("/api/board", {}), {at: Date.now()}); } catch (e) {} refresh(); }
function pubPayload(ps) { const lv = level(G().xp); return {pseudo: ps, xp: G().xp, level: lv.name, week: WEEK(), weekXp: G().wk[WEEK()] || 0,
  stats: {vus: seenCount(), watchlist: watchCount(), cinemas: Object.keys(G().cines).length, billets: TICKETS.length},
  badges: ALLB().filter(b => b.cur() >= b.goal).map(b => b.ic + " " + b.t), collections: COLLS.map(c => ({t: c.ic + " " + c.t, pct: collProg(c).pct}))}; }
let pubT; function autoPublish() { if (!TOKEN || !G().pub) return; clearTimeout(pubT); pubT = setTimeout(() => post("/api/public", pubPayload(G().pub)).catch(() => {}), 2000); }
window.publishProfile = async () => { const ps = ($("#pseudo")?.value || "").trim(); if (!TOKEN) return openAcct();
  try { const r = await post("/api/public", pubPayload(ps)); G().pub = r.pseudo; saveGame(); toast("Profil public publié : @" + r.pseudo); loadSocial(true); } catch (e) { toast(e.message); } };
window.addFriend = async () => { const ps = ($("#fpseudo")?.value || "").trim(); try { await post("/api/friend", {pseudo: ps}); toast("Ami ajouté : @" + ps); loadSocial(true); } catch (e) { toast(e.message); } };
window.rmFriend = async ps => { await post("/api/friend", {pseudo: ps, remove: 1}).catch(() => {}); loadSocial(true); };
window.shareProfile = () => { const u = location.origin + "/?u=" + encodeURIComponent(G().pub || ""); navigator.share ? navigator.share({title: "Mon profil Ciné IDF", text: "Viens comparer nos stats ciné !", url: u}).catch(() => {}) : (navigator.clipboard.writeText(u), toast("Lien copié")); };
window.recoFilm = id => { const f = fid(id); if (!f.id) return; const opts = SOC.friends.map(p => `<option>${esc(p)}</option>`).join("");
  modal(`<div class="mbody"><h2>💌 Recommander « ${esc(f.title)} »</h2><select id="rto">${opts}</select><input id="rmsg" placeholder="Un petit mot (facultatif)" maxlength="200" style="width:100%;margin:8px 0"><button class="primary" onclick="sendReco('${esc(id)}')">Envoyer</button></div>`); };
window.sendReco = async id => { const f = fid(id); try { await post("/api/reco", {to: $("#rto").value, film: {id: f.id, title: f.title, poster: f.poster}, msg: $("#rmsg").value}); toast("Recommandation envoyée"); closeModal(); } catch (e) { toast(e.message); } };
window.openPublic = async ps => { try { const p = await (await fetch("/u/" + encodeURIComponent(ps) + ".json")).json(); if (p.error) throw new Error(p.error);
  modal(`<div class="mbody pubp"><h2>@${esc(p.pseudo)}</h2><p class="lvl">${esc(p.level)} · <b>${p.xp} XP</b></p><div class="stats">${Object.entries(p.stats || {}).map(([k, v]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("")}</div>
  <h3>Badges</h3><p>${(p.badges || []).map(b => `<span class="chip on">${esc(b)}</span>`).join(" ") || "<span class='sub'>Aucun badge pour l’instant</span>"}</p>
  <h3>Collections publiques</h3>${(p.collections || []).map(c => `<div class="cbar"><span>${esc(c.t)}</span><i style="--p:${+c.pct || 0}%"></i><b>${+c.pct || 0}%</b></div>`).join("")}
  ${TOKEN && p.pseudo !== SOC.me && !SOC.friends.includes(p.pseudo) ? `<button class="primary" onclick="document.getElementById('fpseudo')||0;post('/api/friend',{pseudo:'${esc(p.pseudo)}'}).then(()=>{toast('Ami ajouté');loadSocialX()}).catch(e=>toast(e.message))">➕ Ajouter en ami</button>` : ""}</div>`); } catch (e) { toast("Profil introuvable"); } };
window.loadSocialX = () => loadSocial(true);
// ---------- Navigation 4 espaces ----------
const TABS = {home: ["🏠", "Accueil"], explorer: ["🔍", "Explorer"], match: ["💘", "CinéMatch"], collection: ["🎞️", "Collection"], profil: ["👤", "Profil"]};
const TABOF = {match: "match", home: "home", seances: "explorer", map: "explorer", list: "explorer", billets: "collection", coll: "collection", profil: "profil", infos: "profil"};
const SUB = {explorer: [["seances", "Séances"], ["map", "Carte"], ["list", "Cinémas"]], collection: [["billets", "Mes films & billets"], ["coll", "Badges & collections"]], profil: [["profil", "Progression & amis"], ["infos", "CinéPass & Pathé"]]};
const LASTSUB = {explorer: "seances", collection: "billets", profil: "profil"};
const nav = $("#nav"); nav.innerHTML = Object.entries(TABS).map(([k, [ic, l]]) => `<button data-t="${k}"><span class="ic" aria-hidden="true">${ic}</span>${l}</button>`).join("");
nav.querySelectorAll("button").forEach(b => b.onclick = () => { const t = b.dataset.t; go(t === "home" || t === "match" ? t : LASTSUB[t]); });
const sub = document.createElement("div"); sub.id = "subnav"; sub.className = "subnav"; sub.setAttribute("role", "tablist"); $("#main").prepend(sub);
const main = $("#main");
main.insertAdjacentHTML("afterbegin", `<section id="v-home" class="view" aria-label="Accueil"></section>`);
main.insertAdjacentHTML("beforeend", `<section id="v-coll" class="view" aria-label="Badges et collections"><div class="pad" id="collc"></div></section><section id="v-profil" class="view" aria-label="Profil"><div class="pad" id="profc"></div></section>`);
const oGo = go; let POP = 0; go = function (v) { const prev = (document.querySelector('.view.on') || {}).id; oGo(v); if (!POP && prev && prev !== 'v-' + v) history.pushState({v}, ''); window.scrollTo(0, 0); const t = TABOF[v] || "explorer"; if (SUB[t]) LASTSUB[t] = v;
  nav.querySelectorAll("button").forEach(b => { const on = b.dataset.t === t; b.classList.toggle("on", on); on ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"); });
  sub.innerHTML = SUB[t] ? SUB[t].map(([k, l]) => `<button role="tab" aria-selected="${k === v}" class="${k === v ? "on" : ""}" onclick="go('${k}')">${l}</button>`).join("") : ""; sub.classList.toggle("hidden", !SUB[t]);
  document.body.dataset.tab = t; if (v === "home") renderHome(); if (v === "coll") renderColl(); if (v === "profil") { renderProfil(); loadSocial(); } if (v === "match" && window.renderMatch) renderMatch(); };
window.go = go;
history.replaceState({v: 'home'}, '');
addEventListener('popstate', e => { const m = document.getElementById('modal'); if (m && !m.classList.contains('hidden')) { closeModal(); return; } POP = 1; go((e.state && e.state.v) || 'home'); POP = 0; });
const hdr = document.querySelector('header'); const setHH = () => document.documentElement.style.setProperty('--hh', hdr ? hdr.offsetHeight + 'px' : '0px'); setHH(); addEventListener('resize', setHH);
// ---------- Rendus ----------
function greet() { const h = new Date().getHours(); return h < 5 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir"; }
function progressCard() { const g = G(), lv = level(g.xp); return `<div class="gcard prog"><div class="ph"><span class="lvic">${lv.ic}</span><div><b>${lv.name}</b><span class="sub">${g.xp} XP${lv.next ? ` · encore ${lv.next - g.xp} XP pour « ${lv.nextName} »` : " · niveau maximum"}</span></div><span class="wk">+${g.wk[WEEK()] || 0} XP<small>cette semaine</small></span></div><div class="xpbar"><i style="width:${lv.pct}%"></i></div></div>`; }
function recos() { // recommandations réelles : d'abord celles des amis, puis vos goûts (genres consultés / aimés), puis les mieux notés
  const S = seenKeys(), out = [], ids = new Set(); const parse = g => { if (typeof g === "string") try { return JSON.parse(g.replace(/'/g, '"')); } catch (e) { return []; } return g || []; };
  (SOC.inbox || []).slice().reverse().forEach(r => { const f = FILMS.find(x => String(x.id) === String(r.id)); if (f && !ids.has(f.id)) { ids.add(f.id); out.push([f, "💌 @" + r.from]); } });
  const GG = G().genres, gs = Object.keys(GG).length; const liked = new Set((LB.liked || []).flatMap(x => x.genres || []));
  FILMS.filter(f => !ids.has(f.id) && !S.has(lbKey(f.title)) && f.poster).map(f => { const gen = parse(f.genres); const s = gen.reduce((a, x) => a + (GG[x] || 0) * 2 + (liked.has(x) ? 3 : 0), 0) + (+f.rating || 0) * 2 + (+f.press || 0); return [f, s, gen]; })
    .sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([f, s, gen]) => out.push([f, gs && gen.some(x => GG[x]) ? "Tes goûts : " + gen.find(x => GG[x]) : (+f.rating ? "★ " + (+f.rating).toFixed(1) + " spectateurs" : "")]));
  return out.slice(0, 12); }
function homeRails() { // mêmes données et règles que l'onglet Films (Sorties / Séances spéciales / Tous les films)
  let V = []; try { V = view(); } catch (e) { V = FILMS; }
  const sk = `<div class="sk" aria-hidden="true"><div class="im"></div><i></i></div>`.repeat(6);
  const box = (ic, t, arr, ex, more) => `<div class="hsec"><h2>${ic} ${t}${arr.length ? ` <small>${arr.length}</small>` : ""}</h2>${arr.length ? `<div class="rail" role="list">${arr.slice(0, 30).map(f => `<div class="rw" role="listitem">${posterCard(f, ex && ex(f))}</div>`).join("")}${arr.length > 30 || more ? `<button class="rmore" onclick="go('seances')">Voir tout<br>→</button>` : ""}</div>` : !FILMS.length && !ERR ? `<div class="rail">${sk}</div>` : `<p class="sub">${esc(FILMS.length ? "Aucun film dans cette catégorie pour l’instant." : ERR || "Séances indisponibles pour le moment, réessayez dans un instant.")}</p>`}</div>`;
  const rel = f => f.cl.rel ? "Sortie le " + new Date(f.cl.rel + "T12:00").toLocaleDateString("fr-FR", {day: "numeric", month: "short"}) : "";
  return box("🆕", "Sorties de la semaine", V.filter(f => f.cl.fresh).sort((a, b) => (b.cl.rel || "").localeCompare(a.cl.rel || "") || b.n - a.n), rel)
    + box("✨", "Séances spéciales", V.filter(f => f.cl.ap || f.cl.special.length || f.times.some(t => (t.events || []).length || t.preview)), f => f.cl.ap ? "Avant-première" : esc(f.cl.special[0] || "Événement"))
    + (window.newWeek ? (() => { const N = newWeek(); return N.length ? box("🔔", "Nouvelles séances de la semaine", N.map(x => x[0]), f => { const x = N.find(y => y[0] === f); return x[1] + " nouvelle" + (x[1] > 1 ? "s" : "") + " séance" + (x[1] > 1 ? "s" : ""); }) : ""; })() : "")
    + box("🎬", "Tous les films", V, null, 1); }
function renderHome() { if (window.renderHome15) return window.renderHome15(); renderHomeOld($("#v-home")); }
window.renderDash = el => renderHomeOld(el);
function renderHomeOld(el) { if (!el) return; const ms = missions(), m = ms.find(x => !G().done["mission:" + today() + ":" + x.id]) || ms[0], mdone = G().done["mission:" + today() + ":" + m.id], R = recos();
  el.innerHTML = `<div class="home"><h1 class="hello">${greet()}, ${esc((SOC.me && "@" + SOC.me) || (EMAIL ? EMAIL.split("@")[0] : "cinéphile"))} !</h1><p class="sub">Prêt pour ta prochaine découverte ?</p>
  <form class="hsearch" onsubmit="event.preventDefault();homeSearch()"><input id="hq" type="search" placeholder="Quel film veux-tu découvrir ?" aria-label="Rechercher un film, un cinéma, un acteur"></form>
  <div class="quick"><button class="q1" onclick="go('seances')"><span>🎟️</span>Séances</button><button onclick="go('map')"><span>📍</span>Cinémas</button><button onclick="go('billets')"><span>🎞️</span>Mes films</button></div>
  <div class="hsec"><h2>🎯 Ton défi du jour <small>+${PTS.mission} XP</small></h2><div class="gcard mission ${mdone ? "done" : ""}"><b>${esc(m.t)}</b><span class="sub">${esc(m.d)}</span>${mdone ? `<span class="chip on">✓ Validé</span>` : m.ok() ? `<button class="primary" onclick="claimMission('${m.id}')">Récupérer +${PTS.mission} XP</button>` : `<button class="ghost" onclick="go('${m.go || "seances"}')">C’est parti →</button>`}</div></div>
  <div class="hsec"><h2>🔥 Recommandé pour toi</h2>${R.length ? `<div class="rail">${R.map(([f, why]) => `<div class="rw">${posterCard(f, `<span class="why">${esc(why || "À l’affiche")}</span>`)}</div>`).join("")}</div>` : `<p class="sub">Chargement des films à l’affiche…</p>`}</div>
  ${homeRails()}
  <div class="hsec"><button class="gcard row" onclick="go('seances')"><span class="bi">🗓️</span><span><b>Trouver une séance</b><span class="sub">Cinémas, horaires et itinéraires</span></span><span>›</span></button>
  <button class="gcard row" onclick="typeof tonightNear==='function'?tonightNear():go('seances')"><span class="bi">🌙</span><span><b>Ce soir près de moi</b><span class="sub">Les prochaines séances autour de toi</span></span><span>›</span></button></div>
  <div class="hsec"><h2>📈 Ta progression</h2>${progressCard()}<button class="ghost" onclick="go('profil')">Défis, badges et amis →</button></div></div>`; }
window.homeSearch = () => { const q = $("#hq").value.trim(), g = $("#gq"); if (!g) return; g.value = q; g.focus(); g.dispatchEvent(new Event("input", {bubbles: true})); };
function chCard(c) { const cur = Math.min(c.cur(), c.goal), k = "challenge:" + c.id + ":" + perKey(c.per), done = G().done[k];
  return `<div class="gcard ch ${done ? "done" : ""}"><div class="chh"><span class="bi">${c.ic}</span><span><b>${c.t}</b> <span class="tagp">${c.per}</span><span class="sub">${c.d}</span></span><span class="xp">+${c.xp} XP</span></div><div class="xpbar"><i style="width:${Math.round(cur / c.goal * 100)}%"></i></div><div class="chf"><span class="sub">${cur} / ${c.goal}</span>${done ? `<span class="chip on">✓ Réussi</span>` : cur >= c.goal ? `<button class="primary" onclick="claimCh('${c.id}')">Valider</button>` : ""}</div></div>`; }
function geoBadges() { const A = arrDone(), v = VIS(), P = PARIS(), C2 = cities().sort((a, b) => (b.d >= b.n) - (a.d >= a.n) || b.d / b.n - a.d / a.n || a.city.localeCompare(b.city));
  const done = C2.filter(c => c.d >= c.n).length, started = C2.filter(c => c.d && c.d < c.n), rest = C2.filter(c => !c.d);
  const city = c => `<div class="badge2 ${c.d >= c.n ? "ok" : ""}"><span class="bic">🏙️</span><b>${esc(c.city)}</b><div class="xpbar"><i style="width:${Math.round(c.d / c.n * 100)}%"></i></div><small>${c.d} / ${c.n} cinéma${c.n > 1 ? "s" : ""}</small></div>`;
  return `<h1 style="margin-top:26px">🗼 Paris</h1><p class="sub">Pathé et partenaires CinéPass uniquement. Un badge par arrondissement dès votre première séance confirmée (« J’y suis allé » sur la fiche du cinéma). Chaque cinéma ne compte qu’une fois.</p>
  <div class="bgrid arr">${ARRS().map(n => { const cs = P.filter(c => ARR(c) === n), d = cs.filter(c => v.has(c.id)).length; return `<div class="badge2 ${A.has(n) ? "ok" : ""}"><span class="bic">${n}<sup>${n === 1 ? "er" : "e"}</sup></span><small>${cs.length ? d + " / " + cs.length + " cinéma" + (cs.length > 1 ? "s" : "") : "aucun cinéma"}</small></div>`; }).join("")}</div>
  <h1 style="margin-top:26px">🏙️ Villes d’Île-de-France</h1><p class="sub">Badge de la ville obtenu quand vous avez vu une séance dans <b>tous</b> ses cinémas Pathé et partenaires CinéPass. ${done} ville${done > 1 ? "s" : ""} complétée${done > 1 ? "s" : ""} sur ${C2.length}.</p>
  <div class="bgrid">${C2.filter(c => c.d).map(city).join("") || `<p class="sub">Aucune ville commencée pour l’instant.</p>`}</div>
  <details class="coll"><summary><b>Toutes les villes (${rest.length} à découvrir)</b></summary><div class="bgrid" style="margin-top:10px">${rest.map(city).join("")}</div></details>`; }
function renderColl() { const el = $("#collc"); if (!el) return;
  el.innerHTML = `<h1>🏅 Badges</h1><div class="bgrid">${ALLB().map(b => { const n = b.cur(), ok = n >= b.goal; return `<div class="badge2 ${ok ? "ok" : ""}${b.gold ? " gold" : ""}"><span class="bic">${b.ic}</span><b>${b.t}</b><span class="sub">${b.d || ""}</span><div class="xpbar"><i style="width:${Math.min(100, Math.round(n / b.goal * 100))}%"></i></div><small>${Math.min(n, b.goal)} / ${b.goal}</small></div>`; }).join("")}</div>
  ${geoBadges()}
  <h1 style="margin-top:26px">🎞️ Collections</h1><p class="sub">Progression calculée sur vos films « Vu » (liste Ciné IDF + historique Letterboxd) et vos cinémas visités.</p>
  ${COLLS.map(c => { const p = collProg(c); return `<details class="coll"><summary><span class="bic">${c.ic}</span><b>${c.t}</b><span class="cbar"><i style="--p:${p.pct}%"></i></span><b>${p.pct}%</b><small>${p.n}/${p.g}</small></summary>${p.items ? `<ul>${p.items.map(i => `<li class="${i.ok ? "ok" : ""}">${i.ok ? "✓" : "○"} ${esc(i.t)}</li>`).join("")}</ul>` : `<p class="sub">Cinémas indépendants visités : ${p.n}. Utilisez « J’y suis allé » sur la fiche d’un cinéma ou ajoutez un billet.</p>`}</details>`; }).join("")}`; }
function renderProfil() { renderProfil0(); const el = $("#profc"); if (!el) return; const h = el.querySelector("h1"); h && h.insertAdjacentHTML("afterend", lbProfileBlock()); if (!window.renderHome15) return;
  el.insertAdjacentHTML("beforeend", `<details class="coll dash" ${window.__dashOpen ? "open" : ""} ontoggle="window.__dashOpen=this.open"><summary><span class="bic">🏠</span><b>Mon tableau de bord</b><small>défi du jour, recommandations, sélections</small></summary><div id="dashc"></div></details>`);
  renderHomeOld($("#dashc")); }
window.lbProfileBlock = () => `<div class="gcard lbprof" id="lbprof">${lbBlock().replace('<div class="lbbox">', "").replace(/<\/div>$/, "")}</div>`;
function renderProfil0() { const el = $("#profc"); if (!el) return; const g = G(), ms = missions();
  const board = (SOC.board || []), lead = board[0];
  el.innerHTML = `<h1>👤 Mon profil</h1>${progressCard()}
  <div class="row2"><button class="primary" onclick="openAcct()">${EMAIL ? "⚙️ Mon compte · " + esc(EMAIL) : "🔐 Connexion / créer un compte"}</button><button class="ghost" onclick="document.getElementById('theme').click()">◐ Thème clair / sombre</button></div>
  <h2>📋 Missions du jour</h2>${ms.map(m => { const d = g.done["mission:" + today() + ":" + m.id]; return `<div class="gcard mission ${d ? "done" : ""}"><b>${m.t}</b><span class="sub">${m.d}</span>${d ? `<span class="chip on">✓ +${PTS.mission} XP</span>` : m.ok() ? `<button class="primary" onclick="claimMission('${m.id}')">Récupérer +${PTS.mission} XP</button>` : `<span class="chip">À faire</span>`}</div>`; }).join("")}
  <h2>🏆 Défis</h2><div class="chgrid">${CH.map(chCard).join("")}</div>
  <details class="gcard"><summary><b>Barème Ciné XP</b> (anti-triche : chaque action ne compte qu’une fois, plafonds quotidiens)</summary><ul class="sub">${Object.entries(PTS).map(([k, v]) => `<li>${LABEL[k]} : <b>+${v} XP</b>${CAP[k] ? ` (max ${CAP[k]}/jour)` : ""}</li>`).join("")}</ul><p class="sub">Niveaux : ${LEVELS.map(l => l[2] + " " + l[1] + " (" + l[0] + ")").join(" · ")}</p></details>
  <h2>👥 Amis</h2>${!TOKEN ? `<p class="sub">Connectez-vous pour créer votre profil public, ajouter des amis et comparer vos stats.</p>` : `
  <div class="gcard"><b>Profil public</b><span class="sub">${g.pub ? `Publié : <a href="#" onclick="openPublic('${esc(g.pub)}');return false">@${esc(g.pub)}</a> · stats, badges et collections visibles par vos amis.` : "Choisissez un pseudo pour apparaître dans le classement de vos amis."}</span>
   <div class="row2"><input id="pseudo" placeholder="pseudo" value="${esc(g.pub || "")}" maxlength="24" autocapitalize="none"><button class="primary" onclick="publishProfile()">${g.pub ? "Mettre à jour" : "Publier"}</button>${g.pub ? `<button class="ghost" onclick="shareProfile()">📤 Partager</button>` : ""}</div></div>
  <div class="gcard"><b>Ajouter un ami</b><div class="row2"><input id="fpseudo" placeholder="pseudo de votre ami" autocapitalize="none"><button class="primary" onclick="addFriend()">Ajouter</button></div></div>
  <div class="gcard"><b>🏁 Défi entre amis · semaine ${WEEK().slice(-2)}</b><span class="sub">Celui qui gagne le plus d’XP cette semaine remporte le défi.${lead ? ` En tête : <b>@${esc(lead.pseudo)}</b> (${lead.weekXp || 0} XP).` : ""}</span>
   <ol class="board">${board.length ? board.map((r, i) => `<li class="${r.pseudo === SOC.me ? "me" : ""}"><span class="rk">${["🥇", "🥈", "🥉"][i] || i + 1}</span><a href="#" onclick="openPublic('${esc(r.pseudo)}');return false">@${esc(r.pseudo)}</a><small>${esc(r.level || "")}</small><b>${r.week === WEEK() ? r.weekXp || 0 : 0} XP</b>${r.pseudo !== SOC.me ? `<button class="x2" aria-label="Retirer" onclick="rmFriend('${esc(r.pseudo)}')">✕</button>` : ""}</li>`).join("") : "<li class='sub'>Publiez votre profil et ajoutez des amis pour lancer le classement.</li>"}</ol></div>
  ${(SOC.inbox || []).length ? `<div class="gcard"><b>💌 Recommandations reçues</b>${SOC.inbox.slice().reverse().map(r => `<div class="inb">${r.poster ? `<img src="${esc(r.poster)}" alt="">` : ""}<span><b>${esc(r.title)}</b><span class="sub">de @${esc(r.from)}${r.msg ? " · « " + esc(r.msg) + " »" : ""}</span></span>${FILMS.some(f => String(f.id) === r.id) ? `<button class="ghost" onclick="openFilm('${esc(r.id)}')">Voir</button>` : ""}</div>`).join("")}</div>` : ""}`}
  <h2>🕘 Dernières actions</h2><ul class="hist">${g.hist.slice(0, 10).map(h => `<li><b>+${h.p}</b> ${LABEL[h.t] || h.t}<small>${new Date(h.at).toLocaleDateString("fr-FR")}</small></li>`).join("") || "<li class='sub'>Aucune action pour l’instant : ouvrez une fiche film pour gagner vos premiers XP.</li>"}</ul>
  ${recoveryBox()}`; }
// ---------- Clé de récupération (sauvegarde durable) ----------
function recoveryBox() { return EMAIL ? `<details class="gcard"><summary><b>🔑 Clé de récupération du compte</b></summary><p class="sub">Vos données (favoris, XP, badges, listes, billets, Letterboxd, Pathé) sont enregistrées sur cet appareil (IndexedDB), sur le serveur, et restaurées automatiquement si le serveur redémarre. Gardez cette clé pour retrouver votre compte sur un autre appareil sans mot de passe.</p><div class="row2"><button class="ghost" onclick="copyKey()">📋 Copier ma clé</button><button class="ghost" onclick="useKey()">⤵️ Utiliser une clé</button><button class="ghost" onclick="backup()">💾 Fichier de sauvegarde</button></div></details>` : `<details class="gcard"><summary><b>🔑 J’ai une clé de récupération</b></summary><button class="ghost" onclick="useKey()">⤵️ Utiliser une clé</button></details>`; }
window.copyKey = () => { const k = "CIDF1." + btoa(unescape(encodeURIComponent(JSON.stringify({e: EMAIL, t: TOKEN, r: LS.get("cineRestore", null)})))); navigator.clipboard ? navigator.clipboard.writeText(k).then(() => toast("Clé copiée : gardez-la en lieu sûr (elle donne accès au compte)")) : prompt("Votre clé :", k); };
window.useKey = async () => { const k = prompt("Collez votre clé de récupération (CIDF1.…)"); if (!k) return; try { const x = JSON.parse(decodeURIComponent(escape(atob(k.trim().replace(/^CIDF1\./, ""))))); if (!x.e || !x.t || !x.r) throw 0;
  TOKEN = x.t; EMAIL = x.e; LS.set("cineToken", TOKEN); LS.set("cineEmail", EMAIL); LS.set("cineRestore", x.r);
  const p = await post("/api/restore", {email: EMAIL, restore: x.r, data: profileData()}); applyProfile(p, true); sync(); toast("Compte restauré"); refresh(); } catch (e) { toast("Clé invalide"); } };
// ---------- Divers ----------
function refresh() { const v = (document.querySelector(".view.on") || {}).id; if (v === "v-home") renderHome(); if (v === "v-coll") renderColl(); if (v === "v-profil") renderProfil(); }
window.cineRefresh = refresh;
const oRA = renderAll; renderAll = function () { const r = oRA.apply(this, arguments); checkLB(); if (document.querySelector("#v-home.on")) renderHome(); return r; };
const oUA = updAcct; updAcct = function () { oUA(); document.body.classList.toggle("logged", !!EMAIL); };
document.body.classList.toggle("logged", !!EMAIL);
// logo dans l'en-tête
const br = $(".brand"); if (br && !br.querySelector("img")) br.insertAdjacentHTML("afterbegin", `<img src="/logo-96.png" alt="" width="34" height="34">`);
// démarrage
const PQ2 = new URLSearchParams(location.search);
if (!location.hash && !PQ2.get("v") && !PQ2.get("soir") && !PQ2.get("agenda") && !PQ2.get("retro")) go("home"); else go((document.querySelector(".view.on") || {id: "v-seances"}).id.slice(2));
if (PQ2.get("u")) setTimeout(() => openPublic(PQ2.get("u")), 400);
loadSocial(); setInterval(() => { checkLB(); }, 30000);
})();
