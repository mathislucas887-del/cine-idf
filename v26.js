// v26 : filtre par moment de la journée + « Toutes les séances » dans l’onglet Accueil (ex-Explorer)
(function () {
  "use strict";
  if (!window.TimeSlot) return;
  const KEY = "timeSlot";
  try { TimeSlot.set(TimeSlot.fromStored(LS.get(KEY, "all"))); } catch (e) { TimeSlot.set([]); }

  let ALLSHOWS = false;
  window.ALLSHOWS = () => ALLSHOWS;

  function knownDates() {
    const strip = (typeof DAYS !== "undefined" && DAYS.length && typeof ymd === "function") ? DAYS.map(d => ymd(d)) : [];
    const last = (window.MATCHCAT || {}).last || "";
    return TimeSlot.rangeDates(strip, last, 28);
  }
  function lastLabel(dates) {
    const last = (dates || SELDATES || [])[(dates || SELDATES || []).length - 1];
    return last && typeof fmtDay === "function" ? "jusqu’au " + fmtDay(last) : "";
  }
  function showAllProgress(done, total, on) {
    let el = document.getElementById("allprog");
    if (!on) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("p");
      el.id = "allprog";
      el.className = "allprog";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      const slots = document.getElementById("slots");
      const bar = document.querySelector("#v-seances .daybar");
      if (slots) slots.after(el);
      else if (bar) bar.appendChild(el);
      else return;
    }
    el.textContent = total ? ("Chargement des séances… " + done + " / " + total + " jours") : "Chargement des séances…";
  }
  function dayCached(d, q) {
    try {
      const cache = window.MEM_DAY_CACHE;
      if (!cache || typeof cache.get !== "function") return false;
      const ttl = (typeof DAY_TTL === "number" ? DAY_TTL : 8 * 60 * 1000);
      const hit = cache.get(d + (q || ""));
      return !!(hit && hit.data && Date.now() - hit.at < ttl);
    } catch (e) { return false; }
  }
  function mergeDay(by, cinemas) {
    let failed = 0, shows = 0, lastDay = "";
    Object.entries(cinemas || {}).forEach(([cid, films]) => {
      const cine = typeof byId === "function" ? byId(cid) : null;
      if (!films) { failed++; return; }
      if (!cine) return;
      films.forEach(f => {
        const times = (f.times || []).filter(t => t && t.time);
        if (!times.length) return;
        shows += times.length;
        times.forEach(t => { const day = String(t.time).slice(0, 10); if (day > lastDay) lastDay = day; });
        const k = f.id || norm(f.title);
        const F = by[k] ||= {...f, times: [], by: []};
        F.times.push(...times);
        const ex = F.by.find(x => x.c === cine);
        ex ? ex.times.push(...times) : F.by.push({c: cine, times: [...times]});
      });
    });
    return {failed, shows, lastDay};
  }
  async function loadAllShows() {
    const my = ++LOADING;
    ERR = "";
    try {
      if ($("#scope").value === "near" && !GEO) {
        try { await locate(); } catch (e) { ERR = e.message; $("#scope").value = "core"; }
      }
    } catch (e) {}
    const ids = typeof scopeIds === "function" ? scopeIds() : null;
    if (ids && !ids.length) {
      FILMS = [];
      ERR = $("#scope").value === "fav" ? "Aucun cinéma en favori : ajoutez-en depuis la fiche d’un cinéma (⭐)." : "Aucun cinéma trouvé.";
      showAllProgress(0, 0, false);
      return renderAll();
    }
    const q = ids && ids.length ? "?ids=" + encodeURIComponent(ids.join(",")) : "";
    const dates = knownDates();
    SELDATES = dates.slice();
    if (typeof renderDates === "function") renderDates();
    showAllProgress(0, dates.length, true);

    const by = {};
    let failed = 0, done = 0, painted = false;
    let pubT = 0;

    const ingest = cinemas => {
      const r = mergeDay(by, cinemas);
      failed += r.failed;
      done++;
    };
    const publish = final => {
      if (my !== LOADING) return;
      FILMS = Object.values(by).map(classify);
      FETCHED = Date.now();
      if (failed) ERR = "Allociné n’a pas répondu pour " + failed + " cinéma(s) – les autres séances s’affichent.";
      if (typeof renderAll === "function") renderAll();
      painted = true;
      showAllProgress(done, dates.length, !final);
      if (final) {
        try {
          LS.set("lastData", {at: FETCHED, dates: SELDATES, films: FILMS.slice(0, 80).map(f => ({...f, by: f.by.map(b => ({cid: b.c.id, times: b.times}))}))});
        } catch (e) {}
        if (typeof injectLD === "function") injectLD();
        if (typeof loadTMDB === "function") { try { _tmN = 0; loadTMDB(); } catch (e) {} }
        if (typeof FILMPATH !== "undefined" && FILMPATH && !window._fp) { window._fp = 1; openFilm(FILMPATH[1]); }
      }
    };
    const publishSoon = () => {
      showAllProgress(done, dates.length, true);
      if (pubT) return;
      pubT = setTimeout(() => { pubT = 0; if (my === LOADING) publish(false); }, 120);
    };

    const finished = Object.create(null);
    const markDone = d => { if (finished[d]) return false; finished[d] = true; done++; return true; };
    let emptyStreak = 0, stopRest = false;
    const fetchDay = d => {
      const p = fetchDayShows(d, q).then(x => {
        if (my !== LOADING) return;
        const cinemas = x && x.cinemas;
        if (cinemas) {
          const r = mergeDay(by, cinemas);
          failed += r.failed;
          if (r.shows) emptyStreak = 0; else emptyStreak++;
        } else {
          emptyStreak++;
        }
        if (emptyStreak >= 3) stopRest = true;
        markDone(d);
        publishSoon();
      }).catch(() => {
        if (my !== LOADING) return;
        emptyStreak++;
        if (emptyStreak >= 3) stopRest = true;
        markDone(d);
        showAllProgress(done, dates.length, true);
      });
      // Un jour très lent (Allociné à froid ~2 min) ne doit pas bloquer indéfiniment la suite.
      return Promise.race([p, new Promise(res => setTimeout(() => {
        if (!finished[d]) {
          emptyStreak++;
          if (emptyStreak >= 3) stopRest = true;
          markDone(d);
          showAllProgress(done, dates.length, true);
        }
        res();
      }, 120000))]);
    };

    const cached = [], rest = [];
    dates.forEach(d => (dayCached(d, q) ? cached : rest).push(d));

    // Jours déjà en cache : affichage immédiat, sans vider la liste.
    for (const d of cached) {
      if (my !== LOADING) return;
      try { const x = await fetchDayShows(d, q); if (my !== LOADING) return; if (x && x.cinemas) ingest(x.cinemas); else done++; }
      catch (e) { done++; }
    }
    if (my !== LOADING) return;
    if (cached.length) publish(false);
    else if (!FILMS.length) { try { skeleton(); } catch (e) {} }

    // Les autres jours : un à la fois, publication au fil de l’eau, arrêt après 3 jours vides ou en échec.
    const LIMIT = 1; // un jour à la fois : Allociné est sérialisé côté serveur (~1,5 s par cinéma)
    let i = 0;
    const workers = Array.from({length: Math.min(LIMIT, rest.length)}, async () => {
      while (i < rest.length && my === LOADING && !stopRest) {
        const d = rest[i++];
        await fetchDay(d);
      }
    });
    if (workers.length) await Promise.all(workers);
    if (my !== LOADING) return;
    if (pubT) { clearTimeout(pubT); pubT = 0; }
    publish(true);
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
    loadAllShows();
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
    el.setAttribute("role", "group");
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
    el.innerHTML = TimeSlot.SLOTS.map(s => {
      const on = TimeSlot.isSelected(s.id);
      const aria = s.hours ? `${s.label}, ${s.hours}` : "Tous les horaires";
      return `<button type="button" data-slot="${s.id}" aria-pressed="${on}" aria-label="${aria}" class="${on ? "on" : ""}">${s.hours ? `<span>${s.label}</span><small>${s.hours}</small>` : s.label}</button>`;
    }).join("");
    const on = el.querySelector(".on");
    on && on.scrollIntoView({inline: "center", block: "nearest", behavior: "smooth"});
  }
  function pick(id) {
    const next = TimeSlot.toggle(id);
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
      if (TimeSlot.isAll()) return _s18(f, by, pref);
      const filtered = TimeSlot.filterBy(by);
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
    const range = lastLabel(SELDATES) || (SELDATES.length + " jour" + (SELDATES.length > 1 ? "s" : ""));
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
      if (next.join() !== SELDATES.join()) { SELDATES = next; renderDates(); loadAllShows(); }
    }, 200);
  });

  const _loadData = typeof loadData === "function" ? loadData : null;
  if (_loadData && !_loadData._allShows) {
    const wrapped = async function () {
      if (ALLSHOWS) return loadAllShows();
      showAllProgress(0, 0, false);
      return _loadData.apply(this, arguments);
    };
    wrapped._allShows = true;
    try { loadData = wrapped; } catch (e) {}
    window.loadData = wrapped;
  }

  function initAllShows() {
    hookRenderDates();
    observeDates();
    ensureAllShowsChip();
    renderSlots();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAllShows);
  else initAllShows();
})();
