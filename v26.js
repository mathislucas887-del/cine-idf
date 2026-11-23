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

  // Le premier renderDates() a déjà eu lieu à la fin de app.js, avant ce script.
  // On enveloppe le rendu, on réinjecte la pastille tout de suite, et un observateur
  // la remet si une autre fonction réécrit #dates (référence périmée, nouvel appel, etc.).
  const CHIP = `<button type="button" role="tab" data-all="1" class="allshows" aria-selected="false" aria-label="Toutes les séances connues, sur toute la période disponible">Toutes les séances</button>`;
  function ensureAllShowsChip() {
    const el = document.getElementById("dates");
    if (!el) return;
    let btn = el.querySelector("button[data-all]");
    if (!btn) {
      el.insertAdjacentHTML("afterbegin", CHIP);
      btn = el.querySelector("button[data-all]");
    } else if (el.firstElementChild !== btn) {
      el.insertBefore(btn, el.firstElementChild);
    }
    if (!btn) return;
    btn.classList.toggle("on", ALLSHOWS);
    btn.setAttribute("aria-selected", ALLSHOWS);
    if (!ALLSHOWS) return;
    el.querySelectorAll("button[data-d]").forEach(b => { b.classList.remove("on"); b.setAttribute("aria-selected", "false"); });
    const last = SELDATES[SELDATES.length - 1], n = SELDATES.length;
    const range = last && typeof fmtDay === "function" ? "jusqu’au " + fmtDay(last) : n + " jour" + (n > 1 ? "s" : "");
    const h = document.querySelector(".today");
    if (h) h.innerHTML = "Toutes les séances · <em>" + range + "</em>";
    document.querySelectorAll(".qk").forEach(b => {
      if (b.dataset.q === "today" || b.dataset.q === "weekend" || b.dataset.q === "tomorrow") b.classList.remove("on");
    });
    const per = document.querySelector(".period");
    if (per) per.classList.remove("on");
  }
  function hookRenderDates() {
    const orig = window.renderDates || (typeof renderDates === "function" ? renderDates : null);
    if (orig && orig._allShows) return orig;
    const wrapped = function () {
      if (orig) orig();
      ensureAllShowsChip();
    };
    wrapped._allShows = true;
    window.renderDates = wrapped;
    try { renderDates = wrapped; } catch (e) {}
    return wrapped;
  }
  hookRenderDates();
  function observeDates() {
    const el = document.getElementById("dates");
    if (!el || el._allShowsObs) return;
    const obs = new MutationObserver(() => {
      hookRenderDates();
      const first = el.firstElementChild;
      if (!first || !first.getAttribute || first.getAttribute("data-all") !== "1") ensureAllShowsChip();
      else if (ALLSHOWS) ensureAllShowsChip();
    });
    obs.observe(el, {childList: true});
    el._allShowsObs = obs;
  }

  function onDatesClick(e) {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.all) { pickAllShows(); return; }
    if (!b.dataset.d) return;
    ALLSHOWS = false;
    SELDATES = [b.dataset.d];
    (window.renderDates || renderDates)();
    loadData();
  }
  const datesEl = document.getElementById("dates");
  if (datesEl) {
    datesEl.onclick = onDatesClick;
    if (!datesEl._allShowsClick) {
      datesEl.addEventListener("click", ev => {
        if (datesEl.onclick !== onDatesClick) onDatesClick(ev);
      });
      datesEl._allShowsClick = true;
    }
  }

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

  function initAllShows() {
    hookRenderDates();
    observeDates();
    ensureAllShowsChip();
    renderSlots();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAllShows);
  else initAllShows();
})();
