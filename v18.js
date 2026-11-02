// v18 : séances unifiées (un jour à la fois, grille régulière) + fermeture iPhone (croix safe-area, swipe-down)
(() => {
const S = {}; let n = 0;
const norm = by => Array.isArray(by) ? by.map(({c, times}) => ({c, times})) : Object.entries(by || {}).map(([cid, times]) => ({c: (typeof byId === "function" && byId(cid)) || {id: cid, name: cid}, times}));
const lab = k => { const t = new Date(), d0 = ymd(t), d1 = ymd(new Date(t.getTime() + 864e5)); if (k === d0) return "Auj."; if (k === d1) return "Demain"; return new Date(k + "T12:00").toLocaleDateString("fr-FR", {weekday: "short", day: "numeric"}); };
const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const body = (id) => { const {f, g, day} = S[id], now = new Date();
  const rows = g.map(({c, times}) => ({c, ts: times.filter(t => t.time.slice(0, 10) === day).sort((a, b) => a.time.localeCompare(b.time))})).filter(r => r.ts.length)
    .sort((a, b) => (a.c.type === "pathe" ? 0 : 1) - (b.c.type === "pathe" ? 0 : 1) || ((typeof dist === "function" ? dist(a.c) : 0) ?? 0) - ((typeof dist === "function" ? dist(b.c) : 0) ?? 0) || String(a.c.name).localeCompare(b.c.name));
  return `<p class="sub">${rows.length} cinéma${rows.length > 1 ? "s" : ""} · touche un horaire pour réserver</p>` + (rows.map(({c, ts}) => cCard(c, ts.map(t => timeBtn(f, c, t, now)).join(""))).join("") || `<p class="sub">Aucune séance ce jour-là.</p>`); };
window.s18 = (f, by, pref) => { const id = "s" + (++n), g = norm(by), today = ymd(new Date());
  const ds = [...new Set(g.flatMap(x => x.times.map(t => t.time.slice(0, 10))))].filter(k => k >= today).sort();
  if (!ds.length) return `<p class="sub">Aucune séance à venir.</p>`;
  S[id] = {f, g, day: ds.includes(pref) ? pref : ds[0]};
  setTimeout(() => { const b = document.querySelector(`#${id} .fdays .on`); b && b.scrollIntoView({inline: "center", block: "nearest"}); }, 50);
  return `<div class="s18" id="${id}"><div class="fdays" role="tablist" aria-label="Jour des séances">${ds.map(k => `<button role="tab" data-d="${k}" aria-selected="${k === S[id].day}" class="${k === S[id].day ? "on" : ""}" onclick="s18Day('${id}','${k}')">${esc(lab(k))}</button>`).join("")}</div><div class="fdt in">${body(id)}</div></div>`; };
window.s18Day = (id, d) => { const box = document.getElementById(id); if (!box || !S[id]) return; S[id].day = d;
  box.querySelectorAll(".fdays button").forEach(b => { const on = b.dataset.d === d; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
  const el = box.querySelector(".fdt"); el.classList.remove("in"); void el.offsetWidth; el.classList.add("in"); el.innerHTML = body(id); };
// Glisser vers le bas pour fermer (panneau séance : partout si en haut ; fiche : depuis le haut de la fiche)
const drag = (wrap, box, close, zone) => { let y0 = null, dy = 0;
  wrap.addEventListener("touchstart", e => { if (!box.contains(e.target) || e.target.closest("input,textarea,select,iframe,.fdays,.rail,.dayp")) return; const r = box.getBoundingClientRect(), y = e.touches[0].clientY;
    if (wrap.scrollTop > 0 || box.scrollTop > 0 || (zone && y - r.top > zone)) return; y0 = y; dy = 0; box.style.transition = "none"; }, {passive: true});
  wrap.addEventListener("touchmove", e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); box.style.transform = `translateY(${dy}px)`; }, {passive: true});
  wrap.addEventListener("touchend", () => { if (y0 == null) return; y0 = null; box.style.transition = "transform .22s ease"; if (dy > 90) { box.style.transform = "translateY(100%)"; setTimeout(() => { close(); box.style.transform = ""; box.style.transition = ""; }, 200); } else box.style.transform = ""; }); };
const sh = document.getElementById("sheet"), md = document.getElementById("modal");
sh && drag(sh, document.getElementById("sheetc"), () => closeSheet());
md && drag(md, md.querySelector(".mbox"), () => closeModal(), 120);
})();
