// v26 : filtre par moment de la journée + « Toutes les séances » dans l’onglet Accueil (ex-Explorer)
(function () {
  "use strict";
  if (!window.TimeSlot) return;
  const KEY = "timeSlot";
  try { TimeSlot.set(LS.get(KEY, "all")); } catch (e) { TimeSlot.set("all"); }

  let ALLSHOWS = false;
  window.ALLSHOWS = () => ALLSHOWS;

  function knownDates() {
    const last = (window.MATCHCAT || {}).last || "";
    const today = typeof ymd === "function" ? ymd(DAYS && DAYS[0] ? DAYS[0] : new Date()) : "";
    const n = TimeSlot.allDaysCount(today, last);
    if (typeof DAYS !== "undefined" && DAYS.length) return DAYS.slice(0, n).map(d => ymd(d));
    return [];
  }

  function periodLabel() {
    try {
      if (ALLSHOWS) {
        const last = SELDATES[SELDATES.length - 1];
        return last && typeof fmtDay === "function"
          ? "sur toute la période connue (jusqu’au " + fmtDay(last) + ")"
          : "sur toute la période connue";
      }
      if (typeof SELDATES === "undefined" || !SELDATES.length) return "pour les jours affichés";
      const today = ymd(new Date()), tom = ymd(new Date(Date.now() + 864e5));
      if (SELDATES.length === 1) {
        if (SELDATES[0] === today) return "aujourd’hui";
        if (SELDATES[0] === tom) return "demain";
        return "le " + (typeof fmtDay === "function" ? fmtDay(SELDATES[0]) : SELDATES[0]);
      }
      if (SELDATES.length === 2 && new Date(SELDATES[0] + "T12:00").getDay() === 6) return "ce week-end";
      return "pour les jours sélectionnés";
    } catch (e) { return "pour les jours affichés"; }
  }
  TimeSlot.periodLabel = periodLabel;

  function pickAllShows() {
    ALLSHOWS = true;
    if (typeof TONIGHT !== "undefined" && TONIGHT) TONIGHT = false;
    SELDATES = knownDates();
    if (typeof SHOWN !== "undefined") SHOWN = 25;
    renderDates();
    if (typeof loadData === "function") loadData();
    if (!(window.MATCHCAT || {}).last && typeof window.loadCatalogX === "function") {
      try { loadCatalogX(); } catch (e) {}
    }
  }
  window.pickAllShows = pickAllShows;

  function ensureBar() {
    let el = document.getElementById("slots");
    if (el) return el;
    const bar = document.querySelector("#v-seances .daybar");
    if (!bar) return null;
    el = document.createElement("div");
    el.id = "slots";
    el.className = "slots";
    el.setAttribute("role", "tablist");
    el.setAttribute("aria-label", "Moment de la journée");
    const dates = bar.querySelector("#dates");
    if (dates && dates.nextSibling) bar.insertBefore(el, dates.nextSibling);
    else if (dates) dates.after(el);
    else bar.appendChild(el);
    el.addEventListener("click", e => {
      const b = e.target.closest("button[data-slot]");
      if (!b) return;
      pick(b.dataset.slot);
    });
    return el;
  }
  function renderSlots() {
    const el = ensureBar();
    if (!el) return;
    const cur = TimeSlot.current();
    el.innerHTML = TimeSlot.SLOTS.map(s => {
      const on = s.id === cur;
      const aria = s.hours ? `${s.label}, ${s.hours}` : "Tous les horaires";
      return `<button type="button" role="tab" data-slot="${s.id}" aria-selected="${on}" aria-label="${aria}" class="${on ? "on" : ""}">${s.hours ? `<span>${s.label}</span><small>${s.hours}</small>` : s.label}</button>`;
    }).join("");
    const on = el.querySelector(".on");
    on && on.scrollIntoView({inline: "center", block: "nearest", behavior: "smooth"});
  }
  function pick(id) {
    const next = TimeSlot.set(id);
    try { LS.set(KEY, next); } catch (e) {}
    if (typeof SHOWN !== "undefined") SHOWN = 25;
    renderSlots();
    if (typeof renderAll === "function") renderAll();
  }
  window.homeSlot = pick;
  TimeSlot.emptyForView = () => TimeSlot.emptyMsg(periodLabel());

  const _s18 = window.s18;
  if (typeof _s18 === "function") {
    window.s18 = function (f, by, pref) {
      const id = TimeSlot.current();
      if (id === "all") return _s18(f, by, pref);
      const filtered = TimeSlot.filterBy(by, id);
      const n = Array.isArray(filtered) ? filtered.reduce((a, x) => a + x.times.length, 0) : Object.values(filtered).reduce((a, ts) => a + ts.length, 0);
      if (!n) return `<p class="sub">${TimeSlot.emptyMsg(periodLabel())}</p>`;
      return _s18(f, filtered, pref);
    };
  }

  const _renderDates = typeof renderDates === "function" ? renderDates : null;
  if (_renderDates) {
    renderDates = window.renderDates = function () {
      _renderDates();
      const el = $("#dates");
      if (!el) return;
      el.insertAdjacentHTML("afterbegin", `<button type="button" role="tab" data-all="1" class="allshows${ALLSHOWS ? " on" : ""}" aria-selected="${ALLSHOWS}" aria-label="Toutes les séances connues, sur toute la période disponible">Toutes les séances</button>`);
      if (!ALLSHOWS) return;
      el.querySelectorAll("button[data-d]").forEach(b => { b.classList.remove("on"); b.setAttribute("aria-selected", "false"); });
      const last = SELDATES[SELDATES.length - 1], n = SELDATES.length;
      const range = last && typeof fmtDay === "function" ? "jusqu’au " + fmtDay(last) : n + " jour" + (n > 1 ? "s" : "");
      const h = $(".today");
      if (h) h.innerHTML = `Toutes les séances · <em>${range}</em>`;
      $$(".qk").forEach(b => {
        if (b.dataset.q === "today" || b.dataset.q === "weekend" || b.dataset.q === "tomorrow") b.classList.remove("on");
      });
      const per = document.querySelector(".period");
      if (per) per.classList.remove("on");
    };
  }

  const datesEl = $("#dates");
  if (datesEl) datesEl.onclick = e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.all) { pickAllShows(); return; }
    ALLSHOWS = false;
    SELDATES = [b.dataset.d];
    renderDates();
    loadData();
  };

  const quick = document.querySelector(".quick");
  if (quick && quick.onclick) {
    const prev = quick.onclick;
    quick.onclick = function (e) {
      const b = e.target.closest("button");
      if (b && b.dataset.q && b.dataset.q !== "ap") ALLSHOWS = false;
      return prev.call(this, e);
    };
  }
  ["#pfrom", "#pto"].forEach(s => {
    const el = $(s);
    if (el) el.addEventListener("change", () => { ALLSHOWS = false; }, true);
  });

  let catT;
  window.addEventListener("cinecat", () => {
    if (!ALLSHOWS) return;
    clearTimeout(catT);
    catT = setTimeout(() => {
      const next = knownDates();
      if (next.join() !== SELDATES.join()) { SELDATES = next; renderDates(); loadData(); }
    }, 200);
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderSlots);
  else renderSlots();
})();
