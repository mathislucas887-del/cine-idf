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

if (failed) { console.error(failed + " échec(s), " + passed + " ok"); process.exit(1); }
console.log(passed + " tests ok");
