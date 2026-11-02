// v11 : persistance durable côté appareil — copie de toutes les données dans IndexedDB (survit à un nettoyage du localStorage)
(function () {
  const KEYS = ["favs", "tickets", "lb", "lists", "alerts", "extra", "game", "cineToken", "cineEmail", "cineRestore", "theme"];
  let db; const open = () => db || (db = new Promise((ok, ko) => { const r = indexedDB.open("cine-idf", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); }));
  const put = (k, v) => open().then(d => d.transaction("kv", "readwrite").objectStore("kv").put(v, k)).catch(() => {});
  const all = () => open().then(d => new Promise(ok => { const out = {}, s = d.transaction("kv").objectStore("kv").openCursor(); s.onsuccess = e => { const c = e.target.result; if (c) { out[c.key] = c.value; c.continue(); } else ok(out); }; s.onerror = () => ok(out); })).catch(() => ({}));
  try { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { set.call(this, k, v); if (this === window.localStorage && KEYS.includes(k)) put(k, v); }; } catch (e) {}
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
  window.DURABLE_READY = all().then(m => {
    const missing = KEYS.filter(k => m[k] != null && localStorage.getItem(k) == null);
    const empty = !localStorage.getItem("cineEmail") && !localStorage.getItem("favs") && !localStorage.getItem("game");
    if (missing.length && empty && !sessionStorage.getItem("cineIdbRestored")) { missing.forEach(k => localStorage.setItem(k, m[k])); sessionStorage.setItem("cineIdbRestored", "1"); location.reload(); return; }
    KEYS.forEach(k => { const v = localStorage.getItem(k); if (v != null && m[k] !== v) put(k, v); });
  });
})();
