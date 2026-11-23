// v26 : filtre par moment de la journée (créneaux horaires, sans accès au DOM)
(function (root) {
  "use strict";
  // Nuit : 19h inclusive jusqu’à la fin de journée, plus les séances après minuit
  // rattachées à la journée cinéma (00h inclus à 6h exclus). Les séances de 6h à 9h exclus
  // (matin très tôt) n’apparaissent que dans « Toutes ».
  const LATE_END = 6 * 60;
  const SLOTS = [
    {id: "all",   label: "Toutes",      hours: "",          phrase: ""},
    {id: "matin", label: "Matin",       hours: "9h–12h",    phrase: "le matin (9h–12h)",       start: 9 * 60,  end: 12 * 60},
    {id: "midi",  label: "Midi",        hours: "12h–14h",   phrase: "le midi (12h–14h)",       start: 12 * 60, end: 14 * 60},
    {id: "aprem", label: "Après-midi",  hours: "14h–16h",   phrase: "l’après-midi (14h–16h)",  start: 14 * 60, end: 16 * 60},
    {id: "soir",  label: "Soir",        hours: "16h–19h",   phrase: "le soir (16h–19h)",       start: 16 * 60, end: 19 * 60},
    {id: "nuit",  label: "Nuit",        hours: "dès 19h",   phrase: "la nuit (dès 19h)",       start: 19 * 60, end: 24 * 60, late: true}
  ];
  let current = "all";

  function minutesOf(t) {
    const s = String((t && typeof t === "object") ? (t.time || "") : (t || ""));
    if (s.length < 16) return null;
    const hh = +s.slice(11, 13), mm = +s.slice(14, 16);
    if (!isFinite(hh) || !isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }
  function normalize(id) { return SLOTS.some(s => s.id === id) ? id : "all"; }
  function slotOf(id) { id = normalize(id); return SLOTS.find(s => s.id === id); }
  function inSlot(t, id) {
    const slot = slotOf(id);
    if (!slot || slot.id === "all") return true;
    const m = minutesOf(t);
    if (m == null) return false;
    if (slot.late && m < LATE_END) return true;
    return m >= slot.start && m < slot.end;
  }
  function filterTimes(times, id) { return (times || []).filter(t => inSlot(t, id)); }
  function filterBy(by, id) {
    if (!id || id === "all") return by;
    if (Array.isArray(by)) return by.map(({c, times}) => ({c, times: filterTimes(times, id)})).filter(x => x.times.length);
    const out = {};
    Object.entries(by || {}).forEach(([k, ts]) => { const f = filterTimes(ts, id); if (f.length) out[k] = f; });
    return out;
  }
  function set(id) { current = normalize(id); return current; }
  function get() { return current; }
  function emptyMsg(when) {
    const s = slotOf(current);
    if (!s || s.id === "all") return "Aucun film pour ces critères.";
    return "Aucun film avec une séance " + s.phrase + (when ? " " + when : " pour les jours affichés") + ".";
  }

  // Nombre de jours du catalogue (utilitaire). « Toutes les séances » s’appuie plutôt sur rangeDates.
  function allDaysCount(today, last, min, max) {
    min = min == null ? 7 : min; max = max == null ? 28 : max;
    if (!last) return min;
    const t = new Date(today + "T12:00"), L = new Date(last + "T12:00");
    if (isNaN(t) || isNaN(L)) return min;
    const n = Math.round((L - t) / 864e5) + 1;
    return Math.max(min, Math.min(max, n));
  }
  function ymdParts(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  // Union de la barre des jours (strip) et du dernier jour connu du catalogue (CAT.last), plafonnée.
  function rangeDates(strip, last, cap) {
    cap = cap == null ? 28 : cap;
    const out = (strip || []).slice();
    if (last && (!out.length || last > out[out.length - 1])) {
      if (!out.length) {
        out.push(last);
      } else {
        let d = new Date(out[out.length - 1] + "T12:00");
        while (out.length < cap) {
          d.setDate(d.getDate() + 1);
          const k = ymdParts(d);
          out.push(k);
          if (k >= last) break;
        }
      }
    }
    return out.slice(0, cap);
  }

  root.TimeSlot = {SLOTS, LATE_END, minutesOf, inSlot, normalize, slotOf, filterTimes, filterBy, set, current: get, emptyMsg, allDaysCount, rangeDates};
})(typeof window !== "undefined" ? window : globalThis);
