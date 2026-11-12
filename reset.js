// v20 : « Mot de passe oublié ? » — demande d'un lien par e-mail puis choix d'un nouveau mot de passe (lien ?reset=…).
(() => {
  const css = document.createElement("style");
  css.textContent = `.auth .fpw{display:block;margin:10px auto 0;background:none;border:0;color:var(--gold2);font:500 14px Inter,sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer;padding:10px 12px;min-height:44px}
.auth .fpw[hidden]{display:none}.auth .ok{color:var(--gold2);background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.45;margin:10px 0}
.auth .back{background:none;border:0;color:var(--mut);font:14px Inter,sans-serif;cursor:pointer;padding:10px 0;min-height:44px}`;
  document.head.appendChild(css);

  const _openAcct = window.openAcct;
  window.openAcct = msg => {
    _openAcct(msg);
    const f = $("#mcontent .auth form");
    if (!f || EMAIL || $("#fpw")) return;
    f.insertAdjacentHTML("afterend", `<button type="button" class="fpw" id="fpw" onclick="forgotPw()">Mot de passe oublié ?</button>`);
    if (AMODE !== "login") $("#fpw").hidden = true;
  };
  const _authMode = window.authMode;
  window.authMode = m => { _authMode(m); const b = $("#fpw"); if (b) b.hidden = m !== "login"; };

  window.forgotPw = () => {
    const em = (($("#aemail") || {}).value || LS.get("cineLastEmail", "") || "").trim();
    modal(`<div class="auth"><h2>Mot de passe oublié</h2>
      <p class="sub">Indiquez l’e-mail de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe (valable 30 minutes).</p>
      <form id="fpform" onsubmit="sendForgot(event)"><label class="sub" for="femail">E-mail</label><input id="femail" type="email" autocomplete="email" inputmode="email" required value="${esc(em)}">
      <div class="err" id="ferr" role="alert"></div><button class="primary" style="width:100%" id="fsub">Recevoir le lien</button></form>
      <div id="fdone"></div><button type="button" class="back" onclick="openAcct()">← Retour à la connexion</button></div>`);
  };
  window.sendForgot = async e => {
    e.preventDefault(); $("#ferr").textContent = ""; const b = $("#fsub"); b.disabled = true; b.textContent = "Envoi…";
    try {
      const x = await post("/api/forgot", {email: $("#femail").value.trim().toLowerCase()});
      LS.set("cineLastEmail", $("#femail").value.trim().toLowerCase());
      $("#fpform").hidden = true; $("#fdone").innerHTML = `<p class="ok" role="status">✉️ ${esc(x.message || "E-mail envoyé.")}</p>`;
    } catch (err) { $("#ferr").textContent = err.message; b.disabled = false; b.textContent = "Recevoir le lien"; }
  };

  const showReset = async tok => {
    modal(`<div class="auth"><h2>Nouveau mot de passe</h2><p class="sub" id="rinfo">Vérification du lien…</p><div id="rbody"></div></div>`);
    try {
      const x = await post("/api/reset/check", {token: tok});
      $("#rinfo").textContent = "Compte " + x.email + " : choisissez un nouveau mot de passe (6 caractères min.).";
      $("#rbody").innerHTML = `<form onsubmit="doReset(event)"><label class="sub" for="rpw">Nouveau mot de passe</label><input id="rpw" type="password" autocomplete="new-password" required minlength="6">
        <label class="sub" for="rpw2">Confirmer le mot de passe</label><input id="rpw2" type="password" autocomplete="new-password" required minlength="6">
        <div class="err" id="rerr" role="alert"></div><button class="primary" style="width:100%" id="rsub">Enregistrer et me connecter</button></form>`;
      window.doReset = async e => {
        e.preventDefault(); $("#rerr").textContent = "";
        const p1 = $("#rpw").value, p2 = $("#rpw2").value;
        if (p1.length < 6) return $("#rerr").textContent = "Mot de passe : 6 caractères minimum.";
        if (p1 !== p2) return $("#rerr").textContent = "Les deux mots de passe ne correspondent pas.";
        const b = $("#rsub"); b.disabled = true;
        try {
          const r = await post("/api/reset", {token: tok, password: p1});
          onAuth(r); toast("Mot de passe modifié — vous êtes connecté"); openAcct();
        } catch (err) { $("#rerr").textContent = err.message; b.disabled = false; }
      };
    } catch (err) {
      $("#rinfo").textContent = err.message;
      $("#rbody").innerHTML = `<button class="primary" style="width:100%" onclick="forgotPw()">Refaire une demande</button>`;
    }
  };
  const q = new URLSearchParams(location.search), tok = q.get("reset");
  if (tok) {
    q.delete("reset"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); // retire le jeton de l'URL/historique
    setTimeout(() => showReset(tok), 300);
  }
})();
