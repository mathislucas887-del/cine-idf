// v10 : liaison compte Pathé (sans mot de passe) — import de billets + CinéPass
(function () {
let LASTMSG = '';
const MOIS = {janvier:1,"février":2,fevrier:2,mars:3,avril:4,mai:5,juin:6,juillet:7,"août":8,aout:8,septembre:9,octobre:10,novembre:11,"décembre":12,decembre:12};
const pad = n => String(n).padStart(2, "0");
function parseTicket(txt) {
  const T = txt.replace(/\s+/g, " ");
  const nt = norm(T);
  let cine = null, best = 0;
  CINES.forEach(c => { const n = norm(c.name).replace(/^(cinema|pathe|gaumont) /, ""); if (n.length > 3 && nt.includes(n) && n.length > best) { best = n.length; cine = c; } });
  let d = null, m;
  if ((m = T.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/))) d = [m[3].length === 2 ? "20" + m[3] : m[3], pad(m[2]), pad(m[1])];
  else if ((m = T.match(/(\d{1,2})(?:er)? (janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)(?: (\d{4}))?/i))) {
    const mo = MOIS[m[2].toLowerCase()] || MOIS[norm(m[2])]; let y = m[3] || new Date().getFullYear(); d = [y, pad(mo), pad(m[1])]; }
  const tm = T.match(/\b([01]?\d|2[0-3])\s?[h:]\s?([0-5]\d)\b/i);
  let film = null; best = 0;
  (window.FILMS || []).forEach(f => { const n = norm(f.title); if (n.length > 2 && nt.includes(n) && n.length > best) { best = n.length; film = f; } });
  let title = film ? film.title : ((m = T.match(/(?:film|titre)\s*:?\s*([^\n|•·]{2,60}?)(?:\s+(?:le|du|date|séance|salle|cin)\b|$)/i)) ? m[1].trim() : "");
  const seat = (T.match(/(?:si[eè]ge|place|fauteuil|seat)s?\s*:?\s*(?:n[°o]\s*)?([A-Z]{1,2}\s?\d{1,3}(?:\s?[,et]+\s?[A-Z]{1,2}\s?\d{1,3})*)/i) || [])[1] || "";
  const room = (T.match(/salle\s*:?\s*(\w{1,6})/i) || [])[1] || "";
  const ref = (T.match(/(?:r[ée]f[ée]rence|commande|r[ée]servation|booking)\s*(?:n[°o])?\s*:?\s*([A-Z0-9-]{5,20})/i) || [])[1] || "";
  if (!d || !tm) return {err: "Date ou heure introuvable dans le texte."};
  return {title: title || "Séance Pathé", cine, time: `${d[0]}-${d[1]}-${d[2]}T${pad(tm[1])}:${tm[2]}`, seat, room, ref, film};
}
window.patheImport = () => {
  const r = parseTicket($("#ptxt").value || "");
  if (r.err) { LASTMSG = `<span style="color:var(--danger)">${r.err} Collez le contenu complet de l’e-mail de confirmation Pathé.</span>`; renderPathe(); return; }
  const c = r.cine || {id: "", name: "Pathé", website: "https://www.pathe.fr"};
  const id = "pathe|" + (r.ref || (r.title + c.id + r.time));
  if (TICKETS.some(x => x.id === id)) { toast("Billet déjà importé"); return; }
  TICKETS.push({id, fid: r.film ? String(r.film.id) : "", cid: c.id, title: r.title, poster: r.film?.poster || "", cinema: c.name, time: r.time,
    url: "https://www.pathe.fr/mon-compte", version: "", seat: r.seat, room: r.room, ref: r.ref, src: "pathe"});
  sync(); $("#ptxt").value = "";
  LASTMSG = `✅ Ajouté : <b>${esc(r.title)}</b> · ${esc(c.name)} · ${new Date(r.time).toLocaleString("fr-FR", {weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"})}${r.seat ? " · 💺 " + esc(r.seat) : ""}${r.room ? " · salle " + esc(r.room) : ""}`;
  toast("Billet Pathé ajouté à « Mes billets »"); renderTickets();
};
window.patheIcs = async inp => { const f = inp.files[0]; if (!f) return; const t = await f.text();
  const ev = t.split("BEGIN:VEVENT").slice(1); let n = 0;
  ev.forEach(e => { const g = k => ((e.match(new RegExp("\\n" + k + "[^:]*:(.*)")) || [])[1] || "").trim().replace(/\\,/g, ",");
    const ds = g("DTSTART").match(/(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)/); if (!ds) return;
    $("#ptxt").value = `${g("SUMMARY")} ${g("LOCATION")} ${g("DESCRIPTION")} ${ds[3]}/${ds[2]}/${ds[1]} ${ds[4]}:${ds[5]}`; patheImport(); n++; });
  if (!n) { $("#ptxt").value = t.replace(/<[^>]+>/g, " ").slice(0, 20000); patheImport(); } inp.value = ""; };
window.patheSave = () => { EXTRA.pathe = {email: $("#pem").value.trim(), card: $("#pcard").value.trim(), at: new Date().toISOString()};
  saveExtra(); toast(EXTRA.pathe.email || EXTRA.pathe.card ? "Compte Pathé lié à votre profil Ciné IDF" : "Liaison Pathé retirée"); renderPathe(); };
window.patheUnlink = () => { delete EXTRA.pathe; saveExtra(); renderPathe(); toast("Compte Pathé délié"); };
function box() { const P = EXTRA.pathe || {}, linked = P.email || P.card, n = TICKETS.filter(t => t.src === "pathe").length, cp = EXTRA.cp || {};
  return `<div class="lbbox pathe-link" id="pathebox"><h2>🔗 Mon compte Pathé ${linked ? '<span class="lbw" style="background:#c9a227;color:#111">LIÉ</span>' : ""}</h2>
  <p class="sub">Pathé ne propose pas de connexion externe (pas d’OAuth ni d’API publique pour les billets). Pour votre sécurité, Ciné IDF <b>ne demande jamais votre mot de passe Pathé</b>. On lie votre compte par son e-mail et votre n° de carte CinéPass, et vous importez vos billets en 2 secondes depuis l’e-mail de confirmation.</p>
  <div class="row"><input id="pem" type="email" placeholder="E-mail du compte Pathé" value="${esc(P.email || "")}" aria-label="E-mail du compte Pathé" autocomplete="email">
  <input id="pcard" placeholder="N° carte CinéPass (facultatif)" value="${esc(P.card || "")}" aria-label="Numéro de carte CinéPass" inputmode="numeric">
  <button class="primary" onclick="patheSave()">${linked ? "Mettre à jour" : "Lier mon compte"}</button>${linked ? '<button class="ghost" onclick="patheUnlink()">Délier</button>' : ""}</div>
  ${linked ? `<p class="sub">✔ ${esc(P.email || "")}${P.card ? " · carte •••• " + esc(P.card.slice(-4)) : ""}${cp.f ? " · " + esc(cp.f) : ""} · ${n} billet(s) importé(s) · synchronisé avec votre compte Ciné IDF</p>` : ""}
  <details ${linked ? "open" : ""}><summary><b>🎟️ Importer un billet Pathé</b></summary>
  <ol class="sub"><li>Ouvrez l’e-mail « Confirmation de réservation » de Pathé (ou la page billet de l’app Pathé).</li><li>Copiez tout le texte, collez-le ci-dessous : film, cinéma, date, heure, salle et place sont détectés.</li></ol>
  <textarea id="ptxt" rows="4" placeholder="Collez ici l’e-mail de confirmation Pathé…" style="width:100%"></textarea>
  <div class="row"><button class="primary" onclick="patheImport()">Importer le billet</button><label class="ghost filebtn">📎 Fichier .ics / .eml / .txt<input type="file" accept=".ics,.eml,.txt,.html" onchange="patheIcs(this)" hidden></label>
  <a class="ghost" href="https://www.pathe.fr/mon-compte" target="_blank" rel="noopener">Ouvrir mon espace Pathé ↗</a></div><div id="pres" class="sub" role="status">${LASTMSG}</div></details>
  <p class="sub">CinéPass : formule, séances restantes et échéance se règlent dans « Mon CinéPass » (onglet CinéPass) ; les séances incluses sont surlignées partout.</p></div>`; }
function renderPathe() { const t = $("#tickets"); if (t) { document.getElementById("pathebox")?.remove(); t.insertAdjacentHTML("beforebegin", box()); }
  const i = $("#infos"); if (i) { i.querySelector("#pathecta")?.remove(); const P = EXTRA.pathe || {}; const cp = i.querySelector("#cpbox");
    const h = `<p id="pathecta" class="btns"><button class="primary" onclick="go('billets');setTimeout(()=>document.getElementById('pathebox')?.scrollIntoView({behavior:'smooth'}),200)">🔗 ${P.email || P.card ? "Compte Pathé lié · importer un billet" : "Lier mon compte Pathé (billets + CinéPass)"}</button></p>`;
    cp ? cp.insertAdjacentHTML("afterend", h) : i.insertAdjacentHTML("afterbegin", h); } }
window.renderPathe = renderPathe;
const ri = window.renderInfosPlus; if (typeof renderInfosPlus === "function") { const o = renderInfosPlus; renderInfosPlus = function () { o.apply(this, arguments); renderPathe(); }; }
const rt = renderTickets; renderTickets = function () { rt.apply(this, arguments); renderPathe(); };
setTimeout(renderPathe, 300);
window.parsePatheTicket = parseTicket;
})();
