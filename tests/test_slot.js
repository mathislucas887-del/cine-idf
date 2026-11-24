// Tests du filtre par moment de la journée (logique pure, sans DOM)
"use strict";
const {pathToFileURL} = require("url");
const path = require("path");
// charge slot.js (script classique) dans ce contexte
const fs = require("fs");
const src = fs.readFileSync(path.join(__dirname, "..", "slot.js"), "utf8");
eval(src);
const T = globalThis.TimeSlot;
if (!T) { console.error("TimeSlot introuvable"); process.exit(1); }

let failed = 0, passed = 0;
function eq(name, got, exp) {
  const ok = Object.is(got, exp) || JSON.stringify(got) === JSON.stringify(exp);
  if (ok) { passed++; return; }
  failed++;
  console.error("FAIL", name, "got=", got, "expected=", exp);
}
function t(iso) { return {time: iso}; }
const D = "2026-11-23";
const at = (hm, day) => t((day || D) + "T" + hm + ":00");

// minutesOf
eq("minutes 09:00", T.minutesOf(at("09:00")), 9 * 60);
eq("minutes 12:00", T.minutesOf(at("12:00")), 12 * 60);
eq("minutes 00:30", T.minutesOf(at("00:30", "2026-11-24")), 30);
eq("minutes objet ou chaîne", T.minutesOf(D + "T19:00:00"), 19 * 60);
eq("minutes invalide", T.minutesOf(""), null);
eq("minutes court", T.minutesOf("21:30"), null);

// Toutes
["08:30", "09:00", "12:00", "14:00", "16:00", "19:00", "23:59", "00:15"].forEach(hm => {
  eq("toutes " + hm, T.inSlot(at(hm), "all"), true);
});

// Bornes : début inclus, fin exclus
eq("08:59 pas matin", T.inSlot(at("08:59"), "matin"), false);
eq("09:00 matin", T.inSlot(at("09:00"), "matin"), true);
eq("11:59 matin", T.inSlot(at("11:59"), "matin"), true);
eq("12:00 est midi, pas matin", T.inSlot(at("12:00"), "matin"), false);
eq("12:00 midi", T.inSlot(at("12:00"), "midi"), true);
eq("13:59 midi", T.inSlot(at("13:59"), "midi"), true);
eq("14:00 pas midi", T.inSlot(at("14:00"), "midi"), false);
eq("14:00 après-midi", T.inSlot(at("14:00"), "aprem"), true);
eq("15:59 après-midi", T.inSlot(at("15:59"), "aprem"), true);
eq("16:00 pas après-midi", T.inSlot(at("16:00"), "aprem"), false);
eq("16:00 soir", T.inSlot(at("16:00"), "soir"), true);
eq("18:59 soir", T.inSlot(at("18:59"), "soir"), true);
eq("19:00 pas soir", T.inSlot(at("19:00"), "soir"), false);
eq("19:00 nuit", T.inSlot(at("19:00"), "nuit"), true);
eq("23:59 nuit", T.inSlot(at("23:59"), "nuit"), true);

// Après minuit = Nuit de la journée cinéma (ex. 00:xx)
eq("00:00 nuit", T.inSlot(at("00:00", "2026-11-24"), "nuit"), true);
eq("00:30 nuit", T.inSlot(at("00:30", "2026-11-24"), "nuit"), true);
eq("05:59 nuit", T.inSlot(at("05:59", "2026-11-24"), "nuit"), true);

// Avant 9h (à partir de 6h) : uniquement « Toutes »
eq("06:00 pas nuit", T.inSlot(at("06:00"), "nuit"), false);
eq("06:00 pas matin", T.inSlot(at("06:00"), "matin"), false);
eq("08:00 pas matin", T.inSlot(at("08:00"), "matin"), false);
eq("08:00 toutes", T.inSlot(at("08:00"), "all"), true);
eq("08:59 pas matin", T.inSlot(at("08:59"), "matin"), false);

// Un horaire n’appartient qu’à un seul créneau nommé
const named = ["matin", "midi", "aprem", "soir", "nuit"];
["09:00", "11:00", "12:00", "13:00", "14:00", "15:30", "16:00", "18:00", "19:00", "22:15", "00:20", "05:00", "07:00"].forEach(hm => {
  const hits = named.filter(id => T.inSlot(at(hm), id));
  const exp = (hm < "06:00" || hm >= "19:00") ? ["nuit"]
    : hm < "09:00" ? []
    : hm < "12:00" ? ["matin"]
    : hm < "14:00" ? ["midi"]
    : hm < "16:00" ? ["aprem"]
    : hm < "19:00" ? ["soir"]
    : ["nuit"];
  eq("créneau unique " + hm, hits, exp);
});

// filterTimes / filterBy
const times = ["08:00", "10:00", "12:30", "15:00", "17:00", "20:00", "00:40"].map(hm => at(hm, hm < "06:00" ? "2026-11-24" : D));
eq("filter matin count", T.filterTimes(times, "matin").length, 1);
eq("filter nuit count", T.filterTimes(times, "nuit").length, 2); // 20:00 et 00:40
eq("filter toutes count", T.filterTimes(times, "all").length, 7);
const by = [{c: {id: "a"}, times: times}, {c: {id: "b"}, times: [at("08:00")]}];
eq("filterBy matin cinémas", T.filterBy(by, "matin").map(x => x.c.id), ["a"]);
eq("filterBy objet nuit", Object.keys(T.filterBy({a: times, b: [at("08:00")]}, "nuit")), ["a"]);

// normalize / emptyMsg
eq("normalize inconnu", T.normalize("foo"), "all");
T.set("matin");
eq("current matin", T.current(), "matin");
eq("empty matin", T.emptyMsg("aujourd’hui"), "Aucun film avec une séance le matin (9h–12h) aujourd’hui.");
T.set("all");
eq("empty toutes", T.emptyMsg(), "Aucun film pour ces critères.");


// allDaysCount : fenêtre 7–28 jours selon le dernier jour connu
eq("sans last → 7", T.allDaysCount("2026-11-23", ""), 7);
eq("sans last null → 7", T.allDaysCount("2026-11-23", null), 7);
eq("last = aujourd’hui → 7 (plancher)", T.allDaysCount("2026-11-23", "2026-11-23"), 7);
eq("last J+6 → 7", T.allDaysCount("2026-11-23", "2026-11-29"), 7);
eq("last J+13 → 14", T.allDaysCount("2026-11-23", "2026-12-06"), 14);
eq("last J+40 → 28 (plafond)", T.allDaysCount("2026-11-23", "2027-01-10"), 28);
eq("last avant aujourd’hui → 7", T.allDaysCount("2026-11-23", "2026-11-01"), 7);


// rangeDates : au moins toute la barre des jours, étendue jusqu’à CAT.last
const strip7 = ["2026-11-23","2026-11-24","2026-11-25","2026-11-26","2026-11-27","2026-11-28","2026-11-29"];
const strip28 = [...Array(28)].map((_, i) => { const d = new Date("2026-11-23T12:00"); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); });
eq("barre 28 j, sans last → 28", T.rangeDates(strip28, "").length, 28);
eq("barre 28 j, last plus tôt → 28 (on garde la barre)", T.rangeDates(strip28, "2026-11-29").length, 28);
eq("barre 28 j dernier", T.rangeDates(strip28, "")[27], "2026-12-20");
eq("barre 7 j, last J+13 → 14", T.rangeDates(strip7, "2026-12-06").length, 14);
eq("barre 7 j, last J+13 dernier", T.rangeDates(strip7, "2026-12-06")[13], "2026-12-06");
eq("barre vide, sans last", T.rangeDates([], ""), []);
eq("barre vide, avec last", T.rangeDates([], "2026-12-06"), ["2026-12-06"]);
eq("plafond 28", T.rangeDates(strip7, "2027-02-01").length, 28);


// Multi-sélection : un horaire passe s’il correspond à AU MOINS un créneau choisi
eq("soir+nuit 18:00", T.inSlot(at("18:00"), ["soir", "nuit"]), true);
eq("soir+nuit 20:00", T.inSlot(at("20:00"), ["soir", "nuit"]), true);
eq("soir+nuit 00:30", T.inSlot(at("00:30", "2026-11-24"), ["soir", "nuit"]), true);
eq("soir+nuit pas 10:00", T.inSlot(at("10:00"), ["soir", "nuit"]), false);
eq("soir+nuit pas 08:00", T.inSlot(at("08:00"), ["soir", "nuit"]), false);
eq("tableau vide = toutes", T.inSlot(at("08:00"), []), true);
eq("inSlot sans 2e arg suit la sélection", (T.set(["soir","nuit"]), T.inSlot(at("20:00"))), true);
eq("isAll après set all", (T.set("all"), T.isAll()), true);
eq("selected vide", T.selected(), []);
eq("isSelected toutes", T.isSelected("all"), true);

// toggle
T.set("all");
eq("toggle soir", T.toggle("soir"), ["soir"]);
eq("toggle nuit en plus", T.toggle("nuit"), ["soir", "nuit"]);
eq("isSelected soir", T.isSelected("soir"), true);
eq("isSelected nuit", T.isSelected("nuit"), true);
eq("isAll faux", T.isAll(), false);
eq("current multi", T.current(), ["soir", "nuit"]);
eq("toggle soir retire", T.toggle("soir"), ["nuit"]);
eq("toggle dernier → toutes", T.toggle("nuit"), []);
eq("isAll après dernier", T.isAll(), true);
eq("toggle toutes vide", T.toggle("all"), []);
T.toggle("matin"); T.toggle("midi");
eq("toggle toutes efface", T.toggle("all"), []);

// fromStored : migration de l’ancienne clé simple
eq("migrate all", T.fromStored("all"), []);
eq("migrate soir", T.fromStored("soir"), ["soir"]);
eq("migrate tableau", T.fromStored(["soir", "nuit"]), ["soir", "nuit"]);
eq("migrate ignore all dans tableau", T.fromStored(["all", "soir"]), ["soir"]);
eq("migrate inconnu", T.fromStored("foo"), []);
eq("migrate mixte", T.fromStored(["foo", "nuit", "all"]), ["nuit"]);
T.set(["nuit", "soir", "foo"]);
eq("set réordonne selon SLOTS", T.selected(), ["soir", "nuit"]);

// emptyMsg
T.set("soir");
eq("empty un créneau", T.emptyMsg("aujourd’hui"), "Aucun film avec une séance le soir (16h–19h) aujourd’hui.");
T.set(["soir", "nuit"]);
eq("empty deux créneaux", T.emptyMsg("aujourd’hui"), "Aucun film avec une séance le soir (16h–19h) ou la nuit (dès 19h) aujourd’hui.");
T.set(["matin", "soir", "nuit"]);
eq("empty trois créneaux", T.emptyMsg(), "Aucun film avec une séance le matin (9h–12h), le soir (16h–19h) ou la nuit (dès 19h) pour les jours affichés.");
T.set("all");
eq("empty toutes après multi", T.emptyMsg(), "Aucun film pour ces critères.");

// filterBy avec plusieurs créneaux
const times2 = ["08:00", "10:00", "17:00", "20:00", "00:40"].map(hm => at(hm, hm < "06:00" ? "2026-11-24" : D));
eq("filter soir+nuit count", T.filterTimes(times2, ["soir", "nuit"]).length, 3); // 17:00, 20:00, 00:40
const by2 = [{c: {id: "a"}, times: times2}, {c: {id: "b"}, times: [at("08:00")]}];
eq("filterBy soir+nuit cinémas", T.filterBy(by2, ["soir", "nuit"]).map(x => x.c.id), ["a"]);


// « Cette semaine » : plage lundi→dimanche, à partir de maintenant
const atLocal = (y, mo, d, hh, mm, ss) => {
  const x = new Date(y, mo - 1, d, hh, mm, ss || 0, 0);
  const pad = n => String(n).padStart(2, "0");
  return t(x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()) + "T" + pad(x.getHours()) + ":" + pad(x.getMinutes()) + ":" + pad(x.getSeconds()));
};
const nowTue = new Date(2026, 10, 24, 11, 34, 0);
eq("semaine mardi → 6 jours", T.weekDates(nowTue), ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
eq("semaine mardi commence aujourd’hui", T.weekDates(nowTue)[0], "2026-11-24");
eq("semaine mardi finit dimanche", T.weekDates(nowTue).slice(-1)[0], "2026-11-29");
eq("semaine lundi → 7 jours", T.weekDates(new Date(2026, 10, 23, 9, 0, 0)).length, 7);
eq("semaine lundi premier", T.weekDates(new Date(2026, 10, 23, 9, 0, 0))[0], "2026-11-23");
eq("semaine samedi → sam+dim", T.weekDates(new Date(2026, 10, 28, 10, 0, 0)), ["2026-11-28", "2026-11-29"]);
eq("dimanche : seulement le reste du jour", T.weekDates(new Date(2026, 10, 29, 18, 0, 0)), ["2026-11-29"]);
eq("semaine à cheval sur l’année", T.weekDates(new Date(2026, 11, 30, 12, 0, 0)), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
eq("weekEnd dimanche 23:59", T.weekEnd(nowTue).getTime(), new Date("2026-11-29T23:59:59.999").getTime());
eq("weekEnd le dimanche même", T.weekEnd(new Date(2026, 10, 29, 8, 0, 0)).getTime(), new Date("2026-11-29T23:59:59.999").getTime());

// Filtrage des séances déjà commencées + borne du dimanche 23:59
eq("passée ce matin masquée", T.inThisWeek(at("11:00", "2026-11-24"), nowTue), false);
eq("égale à maintenant conservée", T.inThisWeek(at("11:34", "2026-11-24"), nowTue), true);
eq("future aujourd’hui conservée", T.inThisWeek(at("20:15", "2026-11-24"), nowTue), true);
eq("jeudi conservée", T.inThisWeek(at("14:00", "2026-11-26"), nowTue), true);
eq("dimanche 23:59 conservée", T.inThisWeek(at("23:59", "2026-11-29"), nowTue), true);
eq("lundi suivant exclu", T.inThisWeek(at("00:00", "2026-11-30"), nowTue), false);
eq("lundi 00:30 nuit exclu (après dimanche 23:59)", T.inThisWeek(at("00:30", "2026-11-30"), nowTue), false);
eq("lundi précédent exclu", T.inThisWeek(at("21:00", "2026-11-23"), nowTue), false);
eq("horaire invalide", T.inThisWeek({time: "foo"}, nowTue), false);
eq("isUpcoming faux si déjà commencé", T.isUpcoming(at("11:33", "2026-11-24"), nowTue), false);
eq("isUpcoming vrai à l’heure pile", T.isUpcoming(at("11:34", "2026-11-24"), nowTue), true);

const timesW = ["11:00", "11:34", "20:00"].map(hm => at(hm, "2026-11-24")).concat([at("23:59", "2026-11-29"), at("00:10", "2026-11-30")]);
eq("filterThisWeek compte", T.filterThisWeek(timesW, nowTue).map(x => x.time), ["2026-11-24T11:34:00", "2026-11-24T20:00:00", "2026-11-29T23:59:00"]);

const byW = [{c: {id: "a"}, times: timesW}, {c: {id: "b"}, times: [at("10:00", "2026-11-24")]}];
eq("filterByWeek cinémas", T.filterByWeek(byW, nowTue).map(x => x.c.id), ["a"]);

// Dimanche soir : seulement le reste de la journée
const nowSun = new Date(2026, 10, 29, 20, 0, 0);
eq("dimanche 19h déjà passé", T.inThisWeek(at("19:00", "2026-11-29"), nowSun), false);
eq("dimanche 21h encore à venir", T.inThisWeek(at("21:00", "2026-11-29"), nowSun), true);
eq("lundi après un dimanche exclu", T.inThisWeek(at("09:00", "2026-11-30"), nowSun), false);

if (failed) { console.error(failed + " échec(s), " + passed + " ok"); process.exit(1); }
console.log(passed + " tests ok");
