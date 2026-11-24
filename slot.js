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
  let current = []; // ids nommés sélectionnés ; vide = « Toutes »

  function minutesOf(t) {
    const s = String((t && typeof t === "object") ? (t.time || "") : (t || ""));
    if (s.length < 16) return null;
    const hh = +s.slice(11, 13), mm = +s.slice(14, 16);
    if (!isFinite(hh) || !isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }
  const NAMED = SLOTS.filter(s => s.id !== "all").map(s => s.id);
  function normalize(id) { return SLOTS.some(s => s.id === id) ? id : "all"; }
  function slotOf(id) { id = normalize(id); return SLOTS.find(s => s.id === id); }
  function fromStored(raw) {
    if (raw == null || raw === "" || raw === "all") return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return NAMED.filter(id => arr.includes(id));
  }
  function inOne(t, id) {
    const slot = slotOf(id);
    if (!slot || slot.id === "all") return true;
    const m = minutesOf(t);
    if (m == null) return false;
    if (slot.late && m < LATE_END) return true;
    return m >= slot.start && m < slot.end;
  }
  function activeIds(ids) {
    if (ids == null) return current.slice();
    if (ids === "all") return [];
    return fromStored(Array.isArray(ids) ? ids : [ids]);
  }
  function inSlot(t, ids) {
    const sel = activeIds(ids);
    if (!sel.length) return true;
    return sel.some(id => inOne(t, id));
  }
  function filterTimes(times, ids) { return (times || []).filter(t => inSlot(t, ids)); }
  function isAll(ids) { return activeIds(ids).length === 0; }
  function filterBy(by, ids) {
    if (isAll(ids)) return by;
    if (Array.isArray(by)) return by.map(({c, times}) => ({c, times: filterTimes(times, ids)})).filter(x => x.times.length);
    const out = {};
    Object.entries(by || {}).forEach(([k, ts]) => { const f = filterTimes(ts, ids); if (f.length) out[k] = f; });
    return out;
  }
  function selected() { return current.slice(); }
  function isSelected(id) { return id === "all" ? isAll() : current.includes(id); }
  function set(ids) { current = fromStored(ids); return selected(); }
  function toggle(id) {
    if (id === "all") { current = []; return selected(); }
    if (!NAMED.includes(id)) return selected();
    current = current.includes(id) ? current.filter(x => x !== id) : current.concat(id);
    current = NAMED.filter(x => current.includes(x));
    return selected();
  }
  function joinFr(parts) {
    if (!parts.length) return "";
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] + " ou " + parts[1];
    return parts.slice(0, -1).join(", ") + " ou " + parts[parts.length - 1];
  }
  function emptyMsg(when) {
    const sel = selected();
    if (!sel.length) return "Aucun film pour ces critères.";
    const phrases = sel.map(id => (slotOf(id) || {}).phrase).filter(Boolean);
    return "Aucun film avec une séance " + joinFr(phrases) + (when ? " " + when : " pour les jours affichés") + ".";
  }
  function get() { return isAll() ? "all" : (current.length === 1 ? current[0] : selected()); }

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

  // « Cette semaine » : de maintenant jusqu’à dimanche 23:59:59.999 (heure locale, ex. Paris).
  // Le dimanche, la plage se limite au reste de la journée. Aucune séance n’est inventée.
  function asDate(now) {
    if (now == null || now === "") return new Date();
    if (now instanceof Date) return new Date(now.getTime());
    if (typeof now === "number") return new Date(now);
    const d = new Date(String(now));
    return isNaN(d) ? new Date() : d;
  }
  function weekDates(now) {
    const n = asDate(now);
    const today = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0, 0);
    const dow = today.getDay();
    const count = dow === 0 ? 1 : 8 - dow;
    const out = [];
    for (let i = 0; i < count; i++) {
      const x = new Date(today);
      x.setDate(today.getDate() + i);
      out.push(ymdParts(x));
    }
    return out;
  }
  function weekEnd(now) {
    const last = weekDates(now).slice(-1)[0];
    return last ? new Date(last + "T23:59:59.999") : asDate(now);
  }
  function showStart(t) {
    const s = String((t && typeof t === "object") ? (t.time || "") : (t || ""));
    if (s.length < 16) return null;
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  function isUpcoming(t, now) {
    const start = showStart(t);
    if (!start) return false;
    return start.getTime() >= asDate(now).getTime();
  }
  function inThisWeek(t, now) {
    const start = showStart(t);
    if (!start) return false;
    const n = asDate(now);
    return start.getTime() >= n.getTime() && start.getTime() <= weekEnd(n).getTime();
  }
  function filterThisWeek(times, now) {
    return (times || []).filter(t => inThisWeek(t, now));
  }
  function filterByWeek(by, now) {
    if (Array.isArray(by)) return by.map(({c, times}) => ({c, times: filterThisWeek(times, now)})).filter(x => x.times.length);
    const out = {};
    Object.entries(by || {}).forEach(([k, ts]) => { const f = filterThisWeek(ts, now); if (f.length) out[k] = f; });
    return out;
  }

  root.TimeSlot = {SLOTS, LATE_END, minutesOf, inSlot, inOne, normalize, slotOf, fromStored, filterTimes, filterBy, set, toggle, selected, isSelected, isAll, current: get, emptyMsg, joinFr, allDaysCount, rangeDates, weekDates, weekEnd, showStart, isUpcoming, inThisWeek, filterThisWeek, filterByWeek};
})(typeof window !== "undefined" ? window : globalThis);
