/* Agent: generowanie pauzuje na interpunkcji, narzędzie (człowiek) dopisuje ciąg dalszy. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";
  var $ = LU.$, el = LU.el;

  var A = {
    model: null,
    ctx: null,
    parts: [],       // [{kind:"model"|"tool", tokens:[...] | text:"..."}]
    pendingPunct: null,
    calls: 0
  };

  function sentenceSoFar() {
    // wszystko od ostatniej kropki — to jest wejście narzędzia
    var text = [];
    for (var i = A.parts.length - 1; i >= 0; i--) {
      var p = A.parts[i];
      if (p.kind === "tool") { text.unshift(p.text); continue; }
      var stop = -1;
      for (var j = p.tokens.length - 1; j >= 0; j--) {
        if (p.tokens[j] === "." || p.tokens[j] === "!" || p.tokens[j] === "?") { stop = j; break; }
      }
      if (stop >= 0) { text.unshift(LU.detokenize(p.tokens.slice(stop + 1))); break; }
      text.unshift(LU.detokenize(p.tokens));
    }
    return text.join(" ").trim();
  }

  function pushModelToken(token) {
    var last = A.parts[A.parts.length - 1];
    if (last && last.kind === "model") last.tokens.push(token);
    else A.parts.push({ kind: "model", tokens: [token] });
  }

  function render() {
    var host = $("#agent-output");
    host.innerHTML = "";
    if (!A.parts.length) {
      host.appendChild(el("span", { class: "muted small", text: "Tu pojawi się tekst z wplecionymi wynikami narzędzia…" }));
      return;
    }
    var capitalize = true;
    A.parts.forEach(function (p, idx) {
      if (p.kind === "tool") {
        host.appendChild(document.createTextNode(" "));
        host.appendChild(el("span", { class: "tool-sample", title: "wynik narzędzia", text: capitalize ? cap(p.text) : p.text }));
        capitalize = false;
        return;
      }
      p.tokens.forEach(function (t, i) {
        if (LU.isPunct(t)) {
          host.appendChild(el("span", { text: t }));
          if (t === "." || t === "!" || t === "?") capitalize = true;
          return;
        }
        if (i > 0 || idx > 0) host.appendChild(document.createTextNode(" "));
        host.appendChild(el("span", { text: capitalize ? cap(t) : t }));
        capitalize = false;
      });
    });
  }

  function cap(w) { return w.charAt(0).toUpperCase() + w.slice(1); }

  function log(html) {
    var host = $("#agent-log");
    if (host.querySelector("p.muted")) host.innerHTML = "";
    host.insertBefore(el("p", { style: "margin:0 0 .45rem", html: html }), host.firstChild);
    while (host.children.length > 10) host.removeChild(host.lastChild);
  }

  function startRandom() {
    A.model = LU.modelOfOrder(2);
    var list = LU.contextList(A.model).filter(function (c) { return !LU.isPunct(c.words[0]) && c.options > 1; });
    if (!list.length) list = LU.contextList(A.model);
    if (!list.length) { LU.toast("Model jest pusty."); return; }
    var seed = list[Math.floor(Math.random() * list.length)].words;
    A.parts = [{ kind: "model", tokens: seed.slice() }];
    A.ctx = seed.slice();
    A.pendingPunct = null;
    A.calls = 0;
    $("#agent-call").hidden = true;
    render();
    step();
  }

  /* Generuje do momentu, aż wypadnie interpunkcja — wtedy wywołanie narzędzia. */
  function step() {
    if (!A.model) { startRandom(); return; }
    if (A.pendingPunct) { LU.toast("Najpierw wklej odpowiedź narzędzia (albo pomiń)."); return; }
    var guard = 0;
    while (guard++ < 40) {
      var r = LU.step(A.model, A.ctx, { temperature: "normal", strategy: "none" });
      if (!r || !r.chosen) {
        log("Ślepy zaułek — model nie ma następnika dla „" + A.ctx.join(" ") + "”. Zacznij od nowego słowa.");
        return;
      }
      var token = r.chosen.token;
      A.ctx = [token];
      if (LU.isPunct(token)) {
        toolCall(token);
        return;
      }
      pushModelToken(token);
      render();
    }
  }

  function toolCall(punct) {
    A.pendingPunct = punct;
    var question = 'Co było dalej? „' + sentenceSoFar() + '…”';
    $("#agent-call").hidden = false;
    $("#agent-question").textContent = 'Model wylosował „' + punct + '” — to wywołanie narzędzia. Wyślij pytanie: ' + question;
    $("#agent-reply").value = "";
    $("#agent-reply").focus();
    log("<strong>Wywołanie narzędzia</strong> (wyzwalacz <code>" + punct + "</code>): " + escapeHtml(question));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  function finishCall(replyText) {
    var punct = A.pendingPunct;
    A.pendingPunct = null;
    $("#agent-call").hidden = true;

    if (replyText) {
      A.parts.push({ kind: "tool", text: replyText });
      A.calls++;
      log("Odpowiedź narzędzia: „" + escapeHtml(replyText) + "” — wpisana w tekst, a zaraz za nią <code>" +
        punct + "</code>. Generujemy dalej od <code>" + punct + "</code>, bo na słowa znajomego model nie ma wiersza.");
      if (A.calls >= 3) LU.award("toolcall");
    } else {
      log("Brak odpowiedzi — zostawiamy lukę i lecimy dalej od <code>" + punct + "</code>.");
    }
    pushModelToken(punct);
    A.ctx = [punct];
    render();
    step();
  }

  A.onEnter = function () {
    if (!A.model) A.model = LU.modelOfOrder(2);
  };

  A.init = function () {
    $("#agent-start").addEventListener("click", startRandom);
    $("#agent-step").addEventListener("click", step);
    $("#agent-clear").addEventListener("click", function () {
      A.parts = []; A.ctx = null; A.pendingPunct = null; A.calls = 0;
      $("#agent-call").hidden = true;
      $("#agent-log").innerHTML = "<p class='muted'>Każde wywołanie narzędzia zapiszemy tutaj.</p>";
      render();
    });
    $("#agent-send").addEventListener("click", function () {
      var text = $("#agent-reply").value.trim();
      if (!text) { LU.toast("Wpisz odpowiedź albo pomiń wywołanie."); return; }
      finishCall(text);
    });
    $("#agent-reply").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); $("#agent-send").click(); }
    });
    $("#agent-skip").addEventListener("click", function () { finishCall(null); });
  };

  LU.Agent = A;
})(window.LU);
