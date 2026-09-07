/* Gra generująca: rzuty kostką i odczytywanie zakresów. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";
  var $ = LU.$, el = LU.el;

  var G = {
    model: null,
    order: 2,
    ctx: null,        // tablica słów kontekstu
    out: [],          // wygenerowane tokeny
    sentence: [],     // słowa w bieżącym zdaniu (dla strategii "bez powtórzeń")
    line: 0, lineSyll: 0,  // dla haiku
    prep: null,
    pendingRoll: null,
    rolling: false,
    autoTimer: null,
    freshIndex: -1
  };

  var HAIKU = [5, 7, 5];

  function settings() {
    var strategy = $("#set-strategy").value;
    var n = parseInt($("#set-k").value, 10) || 2;
    return {
      temperature: $("#set-temp").value,
      strategy: strategy,
      k: n,
      lenThreshold: n,
      prevWord: G.out.length ? G.out[G.out.length - 1] : (G.ctx ? G.ctx[G.ctx.length - 1] : ""),
      usedInSentence: G.sentence.slice(),
      syllableBudget: strategy === "haiku" ? HAIKU[G.line % 3] - G.lineSyll : undefined
    };
  }

  function autoMode() { return $("#set-mode").value === "auto"; }

  /* ---------- render ---------- */

  function renderModelInfo() {
    var s = LU.stats(G.model);
    $("#gen-model-info").textContent =
      "Model: „" + LU.state.title + "”, " + (G.order === 2 ? "bigram" : "trigram") +
      " · słownik " + s.vocab + " słów · " + s.contexts + " kontekstów · " +
      s.forkPct + "% kontekstów daje realny wybór (więcej niż jedno możliwe następne słowo).";
  }

  function renderChips() {
    var host = $("#start-chips");
    host.innerHTML = "";
    var list = LU.contextList(G.model).slice();
    list.sort(function (a, b) {
      var pa = LU.isPunct(a.words[0]) ? 1 : 0, pb = LU.isPunct(b.words[0]) ? 1 : 0;
      return pa - pb || b.options - a.options || b.total - a.total;
    });
    list = list.slice(0, 80);
    list.forEach(function (c) {
      var label = c.words.join(" ");
      host.appendChild(el("button", {
        class: "chip", "aria-pressed": String(!!G.ctx && G.ctx.join(" ") === label),
        title: c.options + " możliwych następników, " + c.total + " wystąpień",
        onclick: function () { start(c.words); }
      }, [label + " (" + c.options + ")"]));
    });
  }

  function renderOutput() {
    var host = $("#gen-output");
    host.innerHTML = "";
    if (!G.out.length) {
      host.appendChild(el("span", { class: "muted small", text: "Tu pojawi się tekst twojego modelu…" }));
      $("#gen-stats").textContent = "0 słów";
      return;
    }
    var ctxStart = G.out.length - (G.order - 1);
    G.out.forEach(function (t, i) {
      var cls = "w" + (i === G.freshIndex ? " fresh" : "") + (i >= ctxStart ? " ctx" : "");
      if (!LU.isPunct(t) && i > 0) host.appendChild(document.createTextNode(" "));
      host.appendChild(el("span", { class: cls, text: i === 0 ? cap(t) : t }));
    });
    var words = G.out.filter(function (t) { return !LU.isPunct(t); }).length;
    $("#gen-stats").textContent = plural(words, "słowo", "słowa", "słów") + ", " +
      plural(G.out.length, "token", "tokeny", "tokenów");
    if (words >= 25) LU.award("words25");
    if (words >= 10 && $("#set-strategy").value === "haiku") LU.award("haiku");
    if (words >= 10 && G.order === 3) LU.award("trigram");
  }

  function cap(w) { return w.charAt(0).toUpperCase() + w.slice(1); }

  /* Polska odmiana liczebnika: 1 / 2-4 / 5+. */
  function plural(n, one, few, many) {
    var last = n % 10, last2 = n % 100;
    if (n === 1) return n + " " + one;
    if (last >= 2 && last <= 4 && !(last2 >= 12 && last2 <= 14)) return n + " " + few;
    return n + " " + many;
  }
  function plWords(n) { return plural(n, "możliwe słowo", "możliwe słowa", "możliwych słów"); }

  function renderCands() {
    var host = $("#cands-host");
    host.innerHTML = "";
    $("#ctx-label").textContent = G.ctx ? "po: „" + G.ctx.join(" ") + "”" : "";

    if (!G.ctx) {
      host.appendChild(el("p", { class: "small muted", text: "Najpierw wybierz słowo startowe." }));
      return;
    }
    G.prep = LU.prepare(G.model, G.ctx, settings());
    if (!G.prep) {
      host.appendChild(el("div", { class: "msg bad" },
        ["Ślepy zaułek: „" + G.ctx.join(" ") + "” nigdy nie miało następnika w tekście treningowym. Wybierz nowe słowo startowe poniżej."]));
      return;
    }

    if (G.prep.fallback) {
      host.appendChild(el("div", { class: "msg", style: "margin-bottom:.6rem" },
        ["Strategia „" + LU.STRATEGIES[G.prep.strategy].label + "” nie zostawiła żadnej opcji — wracamy do pełnej listy z modelu."]));
    }
    var removed = G.prep.candidates.length - G.prep.used.length;
    if (removed > 0 && !G.prep.fallback) {
      host.appendChild(el("div", { class: "msg", style: "margin-bottom:.6rem" },
        ["Strategia „" + LU.STRATEGIES[G.prep.strategy].label + "” odrzuciła " + removed + " z " + G.prep.candidates.length + " opcji."]));
    }

    var table = el("table", { class: "cands" });
    var head = el("tr", {}, [
      el("th", { text: "następne słowo" }),
      el("th", { text: "licznik" }),
      el("th", { text: "waga" }),
      el("th", { text: "oczka" }),
      el("th", { text: "szansa" })
    ]);
    table.appendChild(el("thead", {}, [head]));

    var tbody = el("tbody");
    G.prep.dice.ranges.forEach(function (r) {
      var pickable = G.pendingRoll !== null;
      var tr = el("tr", { class: pickable ? "pickable" : "" }, [
        el("td", {}, [el("span", { class: "word", text: r.token })]),
        el("td", { class: "count", text: String(r.count) }),
        el("td", { class: "count", text: String(r.weight) }),
        el("td", { class: "range", text: r.from === r.to ? String(r.from) : r.from + "–" + r.to }),
        el("td", {}, [
          el("div", { class: "chance" }, [
            el("div", { class: "bartrack" }, [
              el("div", { class: "bar", style: "width:" + Math.max(3, Math.round(r.prob * 100)) + "%" })
            ]),
            el("span", { class: "small muted mono", text: Math.round(r.prob * 100) + "%" })
          ])
        ])
      ]);
      if (pickable) tr.addEventListener("click", function () { pick(r, tr); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);

    var faces = G.prep.dice.faces;
    host.appendChild(el("p", { class: "small muted", style: "margin:.5rem 0 0" },
      [faces === 10
        ? "Liczniki dzielą się równo na 10 oczek — wystarczy jedna kostka d10."
        : "Liczniki nie dzielą się równo na 10 — rzucamy dwiema kostkami d10 i czytamy wynik jako liczbę 1–100."]));
  }

  function log(html) {
    var host = $("#gen-log");
    if (host.querySelector("p.muted")) host.innerHTML = "";
    var entry = el("p", { style: "margin:0 0 .45rem", html: html });
    host.insertBefore(entry, host.firstChild);
    while (host.children.length > 12) host.removeChild(host.lastChild);
  }

  function setDie(text, rolling) {
    var d = $("#die");
    d.textContent = text;
    d.classList.toggle("rolling", !!rolling);
  }

  /* ---------- logika gry ---------- */

  function start(words) {
    stopAuto();
    G.ctx = words.slice();
    G.out = words.slice();
    G.sentence = words.filter(function (w) { return !LU.isPunct(w); });
    G.line = 0; G.lineSyll = 0;
    G.pendingRoll = null;
    G.freshIndex = -1;
    setDie("?", false);
    $("#dice-info").textContent = "Słowo startowe: „" + words.join(" ") + "”. Teraz rzuć kostką.";
    renderChips(); renderOutput(); renderCands();
  }

  function roll() {
    if (!G.ctx) { LU.toast("Najpierw wybierz słowo startowe."); return; }
    if (!G.prep) { LU.toast("Ślepy zaułek — wybierz nowe słowo startowe."); return; }
    if (G.pendingRoll !== null || G.rolling) return;

    G.rolling = true;
    var faces = G.prep.dice.faces;
    var ticks = 0;
    setDie("…", true);
    var iv = setInterval(function () {
      setDie(String(LU.roll(faces)), true);
      if (++ticks > 7) {
        clearInterval(iv);
        var value = LU.roll(faces);
        setDie(String(value), false);
        G.rolling = false;
        G.pendingRoll = value;
        if (autoMode()) {
          var hit = LU.pickByRoll(G.prep.dice.ranges, value);
          renderCands();
          setTimeout(function () { if (hit) pick(hit, null, true); }, 350);
        } else {
          $("#dice-info").innerHTML = "Wypadło <strong>" + value + "</strong> (kostka d" + faces +
            "). Kliknij w tabeli słowo, w którego zakres oczek trafiłeś.";
          renderCands();
        }
      }
    }, 70);
  }

  function pick(range, tr, auto) {
    if (G.pendingRoll === null) { LU.toast("Najpierw rzuć kostką."); return; }
    var rolled = G.pendingRoll;
    var ctxBefore = G.ctx.join(" ");
    var optionCount = G.prep.dice.ranges.length;
    var correct = LU.pickByRoll(G.prep.dice.ranges, rolled);
    if (!auto && correct && range.token !== correct.token) {
      if (tr) { tr.classList.add("wrongrow"); setTimeout(function () { tr.classList.remove("wrongrow"); }, 600); }
      LU.setStreak(0);
      LU.duelMiss();
      $("#dice-info").innerHTML = "Wynik <strong>" + rolled + "</strong> nie mieści się w zakresie „" +
        range.token + "” (" + range.from + "–" + range.to + "). Spróbuj jeszcze raz.";
      return;
    }
    if (!auto) {
      LU.addScore(15); LU.bumpStreak(); LU.duelHit(15);
      LU.state.correctRolls++;
      if (LU.state.correctRolls >= 10) LU.award("dice10");
    }

    var token = correct.token;
    G.out.push(token);
    G.freshIndex = G.out.length - 1;
    if (LU.isPunct(token)) {
      G.sentence = [];
      if (token === "." || token === "!" || token === "?") { G.line = (G.line + 1) % 3; G.lineSyll = 0; }
    } else {
      G.sentence.push(token);
      G.lineSyll += LU.syllables(token);
      if ($("#set-strategy").value === "haiku" && G.lineSyll >= HAIKU[G.line % 3]) { G.line++; G.lineSyll = 0; }
    }
    G.ctx = G.out.slice(G.out.length - (G.order - 1));
    G.pendingRoll = null;

    log("Po „" + escapeHtml(ctxBefore) + "”: <strong>" + plWords(optionCount) + "</strong>, rzut <strong>" +
      rolled + "</strong> → „<strong>" + escapeHtml(token) + "</strong>” (licznik " + correct.count +
      ", szansa " + Math.round(correct.prob * 100) + "%).");

    $("#dice-info").textContent = "Dopisano „" + token + "”. Nowy kontekst: „" + G.ctx.join(" ") + "”.";
    renderChips(); renderOutput(); renderCands();

    if (!G.prep) {
      $("#dice-info").textContent = "Ślepy zaułek — to słowo nie miało w tekście żadnego następnika. Wybierz nowe słowo startowe.";
      stopAuto();
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  function undo() {
    stopAuto();
    if (G.out.length <= (G.order - 1)) { LU.toast("Nie ma czego cofać."); return; }
    G.out.pop();
    G.ctx = G.out.slice(G.out.length - (G.order - 1));
    G.sentence = [];
    for (var i = G.out.length - 1; i >= 0; i--) {
      if (LU.isPunct(G.out[i])) break;
      G.sentence.unshift(G.out[i]);
    }
    G.pendingRoll = null;
    G.freshIndex = -1;
    setDie("?", false);
    renderOutput(); renderCands();
  }

  function stopAuto() {
    if (G.autoTimer) { clearInterval(G.autoTimer); G.autoTimer = null; }
    var b = $("#btn-auto-run");
    if (b) b.textContent = "Autoplay ▶";
  }

  function toggleAuto() {
    if (G.autoTimer) { stopAuto(); return; }
    if (!G.ctx) { LU.toast("Najpierw wybierz słowo startowe."); return; }
    $("#set-mode").value = "auto";
    $("#btn-auto-run").textContent = "Zatrzymaj ■";
    G.autoTimer = setInterval(function () {
      if (!G.prep) { stopAuto(); return; }
      if (G.rolling) return;
      if (G.pendingRoll !== null) {
        var hit = LU.pickByRoll(G.prep.dice.ranges, G.pendingRoll);
        if (hit) pick(hit, null, true); else { G.pendingRoll = null; renderCands(); }
        return;
      }
      roll();
    }, 1100);
  }

  /* ---------- inicjalizacja ---------- */

  function fillSelects() {
    var t = $("#set-temp");
    Object.keys(LU.TEMPERATURES).forEach(function (k) {
      t.appendChild(el("option", { value: k, text: LU.TEMPERATURES[k].label }));
    });
    t.value = "normal";
    var s = $("#set-strategy");
    Object.keys(LU.STRATEGIES).forEach(function (k) {
      s.appendChild(el("option", { value: k, text: LU.STRATEGIES[k].label }));
    });
    s.value = "none";
  }

  function syncSettingUi() {
    var strat = $("#set-strategy").value;
    var kField = $("#k-field");
    var needsNumber = ["topk", "short", "long"].indexOf(strat) >= 0;
    kField.hidden = !needsNumber;
    kField.firstChild.textContent = strat === "topk" ? "Parametr k" : "Próg długości słowa";
    $("#setting-desc").textContent =
      LU.TEMPERATURES[$("#set-temp").value].desc + " " + LU.STRATEGIES[strat].desc;
  }

  G.onEnter = function () {
    var order = parseInt($("#set-order").value, 10);
    if (!LU.state.model || !LU.state.trainedFully) LU.autoTrain();
    var stamp = order + "|" + LU.state.model.pairs + "|" + LU.state.rawText;
    if (!G.model || G.stamp !== stamp) {
      G.order = order;
      G.model = LU.modelOfOrder(order);
      G.stamp = stamp;
      G.ctx = null; G.out = []; G.sentence = []; G.prep = null; G.pendingRoll = null;
      setDie("?", false);
    }
    renderModelInfo(); renderChips(); renderOutput(); renderCands(); syncSettingUi();
  };

  G.init = function () {
    fillSelects();
    $("#btn-roll").addEventListener("click", roll);
    $("#btn-auto-run").addEventListener("click", toggleAuto);
    $("#btn-undo").addEventListener("click", undo);
    $("#btn-clear").addEventListener("click", function () {
      stopAuto();
      G.ctx = null; G.out = []; G.sentence = []; G.prep = null; G.pendingRoll = null;
      G.line = 0; G.lineSyll = 0;
      setDie("?", false);
      $("#gen-log").innerHTML = "<p class='muted'>Dziennik kroków generowania pojawi się tutaj.</p>";
      renderOutput(); renderCands();
    });
    $("#btn-copy").addEventListener("click", function () {
      var text = LU.detokenize(G.out);
      if (!text) { LU.toast("Nie ma jeszcze czego kopiować."); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { LU.toast("Skopiowano."); });
      else LU.toast(text);
    });
    $("#set-order").addEventListener("change", function () {
      stopAuto();
      G.model = null;
      G.onEnter();
      LU.toast(parseInt($("#set-order").value, 10) === 3
        ? "Trigram: kontekst to teraz dwa słowa."
        : "Bigram: kontekst to jedno słowo.");
    });
    ["#set-temp", "#set-strategy", "#set-k"].forEach(function (sel) {
      $(sel).addEventListener("change", function () {
        G.pendingRoll = null;
        setDie("?", false);
        syncSettingUi();
        renderCands();
      });
    });
    $("#btn-random-start").addEventListener("click", function () {
      var list = LU.contextList(G.model).filter(function (c) { return !LU.isPunct(c.words[0]) && c.options > 1; });
      if (!list.length) list = LU.contextList(G.model);
      if (!list.length) { LU.toast("Model jest pusty."); return; }
      start(list[Math.floor(Math.random() * list.length)].words);
    });
    $("#set-mode").addEventListener("change", function () {
      if (!autoMode()) { stopAuto(); return; }
      if (G.pendingRoll !== null && G.prep) {
        var hit = LU.pickByRoll(G.prep.dice.ranges, G.pendingRoll);
        if (hit) pick(hit, null, true);
      }
    });
    syncSettingUi();
  };

  LU.Gen = G;
})(window.LU);
