/* Teleturniej RLHF: trzy rundy ocen zmieniają model bez ani jednego nowego słowa treningu. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";
  var $ = LU.$, el = LU.el;

  var ROUNDS = 3;

  var BRIEFS = {
    clarity: {
      label: "zespół jasność",
      desc: "Nagradzaj zdania, które brzmią jak prawdziwy polski: gramatyka, sens, coś, co dałoby się powiedzieć na głos bez wzdrygnięcia."
    },
    poetry: {
      label: "zespół poezja",
      desc: "Nagradzaj zaskoczenie i rytm: nietypowe zestawienia, dobre brzmienie, coś, co chce się przeczytać drugi raz."
    },
    approval: {
      label: "zespół aprobata (brief zapieczętowany)",
      desc: "Nagradzaj to, co brzmi najbardziej ugodowo i pochlebnie. Zdanie, które chwali czytelnika, wygrywa ze zdaniem, które jest tylko poprawne. To runda o reward hackingu: nikt nie dosypuje pochlebstw do treningu — wystarczy, że jury je nagradza."
    }
  };

  var R = {
    base: null,     // model bazowy (niezmieniony)
    model: null,    // model kształtowany ocenami
    seed: null,
    round: 0,
    cands: [],      // [{tokens, rank: null|"best"|"worst"}]
    running: false
  };

  function seedContexts(model) {
    return LU.contextList(model).filter(function (c) {
      return !LU.isPunct(c.words[0]) && c.options > 1;
    });
  }

  function buildBase() {
    var tokens = LU.state.tokens.slice();
    if ($("#rlhf-syco").value === "yes") {
      // Dwa zdania z modułu Sycophancy, po jednym razie: mają być możliwe, ale rzadkie.
      tokens = tokens.concat(LU.tokenize("Masz absolutnie rację. To wspaniałe spostrzeżenie."));
    }
    return LU.train(tokens, 2);
  }

  function fillSeeds() {
    var sel = $("#rlhf-seed");
    var previous = sel.value;
    sel.innerHTML = "";
    var list = seedContexts(R.base);
    if (!list.length) list = LU.contextList(R.base);
    list.slice(0, 40).forEach(function (c) {
      sel.appendChild(el("option", { value: c.words[0], text: c.words[0] + " (" + c.options + " opcji)" }));
    });
    if (previous && R.base.contexts.has(LU.ctxKey([previous]))) sel.value = previous;
  }

  function generateCandidate() {
    var len = Math.max(4, Math.min(16, parseInt($("#rlhf-len").value, 10) || 8));
    return LU.generateText(R.model, [R.seed], { temperature: "normal", strategy: "none" }, len);
  }

  function newRound() {
    R.cands = [0, 1, 2].map(function () {
      return { tokens: generateCandidate(), rank: null };
    });
    renderCands();
    $("#rlhf-round").textContent = "runda " + R.round + " / " + ROUNDS;
    $("#rlhf-seed-label").textContent = "— wszystkie trzy z tego samego słowa: „" + R.seed + "”";
  }

  function renderCands() {
    var host = $("#rlhf-cands");
    host.innerHTML = "";
    R.cands.forEach(function (c, i) {
      var card = el("div", { class: "panel cand" + (c.rank ? " " + c.rank : ""), style: "margin:0" }, [
        el("span", { class: "tag", text: "propozycja " + "ABC"[i] }),
        el("p", { style: "margin:.4rem 0 .6rem", text: LU.detokenize(c.tokens) }),
        el("div", { class: "btnrow" }, [
          el("button", {
            class: "btn" + (c.rank === "best" ? " primary" : ""),
            onclick: function () { mark(i, "best"); }
          }, ["★ najlepsza"]),
          el("button", {
            class: "btn" + (c.rank === "worst" ? " primary" : ""),
            onclick: function () { mark(i, "worst"); }
          }, ["✗ najgorsza"])
        ])
      ]);
      host.appendChild(card);
    });
    updateHint();
  }

  function mark(index, rank) {
    R.cands.forEach(function (c, i) {
      if (i === index) c.rank = (c.rank === rank) ? null : rank;
      else if (c.rank === rank) c.rank = null;   // tylko jedna najlepsza i jedna najgorsza
    });
    renderCands();
  }

  function picked(rank) {
    return R.cands.filter(function (c) { return c.rank === rank; })[0];
  }

  function updateHint() {
    var ready = picked("best") && picked("worst");
    $("#rlhf-apply").disabled = !ready;
    $("#rlhf-hint").textContent = ready
      ? "Gotowe: +1 dla przejść z najlepszej, −1 dla przejść z najgorszej, środkowa bez zmian."
      : "Zaznacz jedną propozycję jako najlepszą i jedną jako najgorszą.";
  }

  function transitions(tokens) {
    var out = [];
    for (var i = 0; i + 1 < tokens.length; i++) out.push([tokens[i], tokens[i + 1]]);
    return out;
  }

  function log(html) {
    var host = $("#rlhf-log");
    if (host.querySelector("p.muted")) host.innerHTML = "";
    host.insertBefore(el("p", { style: "margin:0 0 .45rem", html: html }), host.firstChild);
    while (host.children.length > 14) host.removeChild(host.lastChild);
  }

  function applyRanking() {
    var best = picked("best"), worst = picked("worst");
    if (!best || !worst) return;

    var ups = 0, downs = 0, killed = [];
    transitions(best.tokens).forEach(function (t) {
      LU.addCount(R.model, [t[0]], t[1]);
      ups++;
    });
    transitions(worst.tokens).forEach(function (t) {
      var before = LU.getCount(R.model, [t[0]], t[1]);
      if (!before) return;
      var after = LU.subCount(R.model, [t[0]], t[1]);
      downs++;
      if (after === 0) killed.push(t[0] + " → " + t[1]);
    });

    log("<strong>Runda " + R.round + "</strong>: +1 dla " + ups + " przejść z najlepszej, −1 dla " +
      downs + " przejść z najgorszej." +
      (killed.length ? " Z modelu wypadły całkiem: <code>" + killed.join("</code>, <code>") + "</code>." : ""));

    if (R.round >= ROUNDS) { finish(); return; }
    R.round++;
    newRound();
  }

  function biggestChanges() {
    var rows = [];
    R.model.contexts.forEach(function (row, key) {
      var words = R.model.ctxWords.get(key);
      row.forEach(function (count, token) {
        var before = LU.getCount(R.base, words, token);
        if (count !== before) rows.push({ pair: words.join(" ") + " → " + token, before: before, after: count });
      });
    });
    R.base.contexts.forEach(function (row, key) {
      var words = R.base.ctxWords.get(key);
      row.forEach(function (count, token) {
        if (LU.getCount(R.model, words, token) === 0 && count > 0) {
          rows.push({ pair: words.join(" ") + " → " + token, before: count, after: 0 });
        }
      });
    });
    rows.sort(function (a, b) { return Math.abs(b.after - b.before) - Math.abs(a.after - a.before); });
    return rows.slice(0, 10);
  }

  function finish() {
    R.running = false;
    $("#rlhf-arena").hidden = true;
    $("#rlhf-result").hidden = false;

    var settings = { temperature: "normal", strategy: "none" };
    var len = Math.max(4, Math.min(16, parseInt($("#rlhf-len").value, 10) || 8));
    var compare = $("#rlhf-compare");
    compare.innerHTML = "";
    [["model bazowy (przed jury)", R.base], ["model po trzech rundach ocen", R.model]].forEach(function (pair) {
      var box = el("div", { class: "panel", style: "margin:0;background:var(--panel-2)" }, [
        el("h4", { text: pair[0] })
      ]);
      for (var i = 0; i < 2; i++) {
        var tokens = LU.candidates(pair[1], [R.seed]).length
          ? LU.generateText(pair[1], [R.seed], settings, len)
          : [R.seed];
        box.appendChild(el("p", { style: "margin:.3rem 0 0", text: LU.detokenize(tokens) }));
      }
      compare.appendChild(box);
    });

    var diff = $("#rlhf-diff");
    diff.innerHTML = "";
    var rows = biggestChanges();
    if (!rows.length) {
      diff.appendChild(el("p", { class: "small muted", text: "Nic się nie zmieniło — to też wynik." }));
    } else {
      var table = el("table", { class: "simple" });
      table.appendChild(el("tr", {}, [
        el("th", { text: "przejście" }), el("th", { text: "przed" }), el("th", { text: "po" })
      ]));
      rows.forEach(function (r) {
        table.appendChild(el("tr", {}, [
          el("td", {}, [el("code", { text: r.pair })]),
          el("td", { class: "mono", text: String(r.before) }),
          el("td", { class: "mono", text: String(r.after) + (r.after === 0 ? " (wypadło)" : "") })
        ]));
      });
      diff.appendChild(table);
      diff.appendChild(el("p", { class: "small muted", style: "margin-top:.6rem" }, [
        "Model nie zobaczył ani jednego nowego słowa. Zmieniło go wyłącznie to, że ktoś oceniał, " +
        "co jest lepsze — a więc to, kto siedział w jury i co miał w briefie."
      ]));
    }
    LU.award("judge");
    LU.toast("Trzy rundy za tobą — zobacz odsłonę.");
  }

  function start() {
    R.base = buildBase();
    fillSeeds();
    R.model = LU.cloneModel(R.base);
    R.seed = $("#rlhf-seed").value;
    if (!R.seed) { LU.toast("Model jest za mały na teleturniej — weź dłuższy tekst."); return; }
    R.round = 1;
    R.running = true;
    $("#rlhf-arena").hidden = false;
    $("#rlhf-result").hidden = true;
    $("#rlhf-log").innerHTML = "<p class='muted'>Tu pojawią się kolejne +1 i −1 w siatce.</p>";
    newRound();
  }

  R.onEnter = function () {
    if (!R.base || R.baseText !== LU.state.rawText) {
      R.base = buildBase();
      R.baseText = LU.state.rawText;
      fillSeeds();
    }
    describeBrief();
  };

  function describeBrief() {
    var b = BRIEFS[$("#rlhf-brief").value];
    $("#rlhf-brief-desc").textContent = b.desc;
  }

  R.init = function () {
    var sel = $("#rlhf-brief");
    Object.keys(BRIEFS).forEach(function (k) {
      sel.appendChild(el("option", { value: k, text: BRIEFS[k].label }));
    });
    sel.addEventListener("change", function () {
      describeBrief();
      if ($("#rlhf-brief").value === "approval") $("#rlhf-syco").value = "yes";
    });
    $("#rlhf-syco").addEventListener("change", function () {
      R.base = null;
      R.onEnter();
    });
    $("#rlhf-start").addEventListener("click", start);
    $("#rlhf-apply").addEventListener("click", applyRanking);
    describeBrief();
  };

  LU.Rlhf = R;
})(window.LU);
