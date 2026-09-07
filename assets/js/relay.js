/* Sztafeta danych syntetycznych: każde ogniwo trenuje wyłącznie na tekście poprzednika. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";
  var $ = LU.$, el = LU.el;

  var R = { chain: [], locked: false };

  var LETTERS = "ABCDEFGH";

  function wordsWanted() {
    return Math.max(20, Math.min(120, parseInt($("#relay-words").value, 10) || 60));
  }
  function linksWanted() {
    return Math.max(3, Math.min(8, parseInt($("#relay-links").value, 10) || 5));
  }

  /* Tryb Jokera: siatka wymyślona z niczego — losowe sylaby i losowe kreski. */
  function jokerTokens() {
    var syl = ["mo", "ka", "ti", "rus", "len", "pa", "zi", "gro", "fu", "bel", "szo", "wir"];
    var vocab = [];
    for (var i = 0; i < 12; i++) {
      vocab.push(syl[i % syl.length] + syl[(i * 5 + 3) % syl.length]);
    }
    vocab.push(".", ",");
    var out = [];
    for (var j = 0; j < wordsWanted(); j++) {
      out.push(vocab[Math.floor(Math.random() * vocab.length)]);
    }
    return out;
  }

  function generateFrom(tokens) {
    var model = LU.train(tokens, 2);
    var starts = LU.contextList(model).filter(function (c) { return !LU.isPunct(c.words[0]); });
    if (!starts.length) starts = LU.contextList(model);
    if (!starts.length) return { model: model, out: [] };
    var seed = starts[Math.floor(Math.random() * Math.min(starts.length, 8))].words;
    var out = LU.generateText(model, seed, { temperature: "normal", strategy: "none" }, wordsWanted());
    return { model: model, out: out };
  }

  /* Zapętlenie: ostatnie 12 tokenów to powtórka dwóch, trzech słów w kółko. */
  function looped(tokens) {
    if (tokens.length < 12) return false;
    var tail = tokens.slice(-12);
    return new Set(tail).size <= 3;
  }

  function start() {
    R.chain = [];
    R.locked = false;
    $("#relay-msg").hidden = true;
    $("#relay-board").hidden = false;
    $("#relay-texts").hidden = false;

    var joker = $("#relay-source").value === "joker";
    var inTokens = joker ? jokerTokens() : LU.state.tokens.slice();
    var res = generateFrom(inTokens);
    R.chain.push({
      letter: LETTERS[0],
      inLabel: joker ? "wymyślona siatka Jokera" : "oryginał: „" + LU.state.title + "”",
      distinctIn: LU.distinctWords(inTokens),
      out: res.out,
      distinctOut: LU.distinctWords(res.out)
    });
    render();
  }

  function step() {
    if (!R.chain.length) { start(); return; }
    if (R.chain.length >= linksWanted()) { LU.toast("Łańcuch dobiegł końca."); return; }
    var prev = R.chain[R.chain.length - 1];
    var res = generateFrom(prev.out);
    var link = {
      letter: LETTERS[R.chain.length],
      inLabel: "tekst grupy " + prev.letter,
      distinctIn: prev.distinctOut,
      out: res.out,
      distinctOut: LU.distinctWords(res.out)
    };
    R.chain.push(link);
    if (!R.locked && looped(res.out)) {
      R.locked = true;
      link.locked = true;
    }
    render();
    if (R.chain.length >= linksWanted()) LU.award("relay");
  }

  function runAll() {
    var guard = 0;
    if (!R.chain.length) start();
    while (R.chain.length < linksWanted() && guard++ < 20) step();
  }

  function render() {
    var chart = $("#relay-chart");
    chart.innerHTML = "";
    var max = R.chain.reduce(function (m, l) { return Math.max(m, l.distinctIn, l.distinctOut); }, 1);
    R.chain.forEach(function (l) {
      chart.appendChild(el("div", { class: "barrow" }, [
        el("span", { class: "lbl", text: "grupa " + l.letter }),
        el("div", { class: "bar", style: "width:" + Math.max(2, Math.round(l.distinctOut / max * 100)) + "%" }),
        el("span", { class: "val", text: l.distinctOut + " słów" })
      ]));
    });

    var table = $("#relay-table");
    table.innerHTML = "";
    table.appendChild(el("tr", {}, [
      el("th", { text: "pokolenie" }),
      el("th", { text: "uczy się z" }),
      el("th", { text: "różnych słów na wejściu" }),
      el("th", { text: "różnych słów na wyjściu" })
    ]));
    R.chain.forEach(function (l) {
      table.appendChild(el("tr", {}, [
        el("td", { text: "grupa " + l.letter }),
        el("td", { class: "small", text: l.inLabel }),
        el("td", { class: "mono", text: String(l.distinctIn) }),
        el("td", { class: "mono", text: String(l.distinctOut) + (l.locked ? " ⟲" : "") })
      ]));
    });

    var msg = $("#relay-msg");
    var first = R.chain[0], last = R.chain[R.chain.length - 1];
    if (R.locked) {
      msg.hidden = false;
      msg.className = "msg bad";
      msg.textContent = "Łańcuch się zablokował (⟲): model wpadł w krótką pętlę i wszystko poniżej to już tylko ta pętla. " +
        "To normalny wynik — prawdziwy model czyta miliardy słów zamiast " + wordsWanted() + ", dlatego dochodzi do tego samego miejsca dużo wolniej.";
    } else if (R.chain.length > 1) {
      msg.hidden = false;
      msg.className = "msg info";
      msg.textContent = "Od grupy " + first.letter + " do grupy " + last.letter + " słownik stopniał z " +
        first.distinctIn + " do " + last.distinctOut + " różnych słów. Najpierw znikają te, które w tekście wystąpiły raz.";
    } else {
      msg.hidden = true;
    }

    var host = $("#relay-texts-host");
    host.innerHTML = "";
    R.chain.forEach(function (l) {
      host.appendChild(el("div", { class: "sample" }, [
        el("span", { class: "tag", text: "grupa " + l.letter + " · " + l.distinctOut + " różnych słów" }),
        el("p", { style: "margin:.3rem 0 0", text: LU.detokenize(l.out) })
      ]));
    });
  }

  R.onEnter = function () {
    if (!R.chain.length) {
      $("#relay-board").hidden = true;
      $("#relay-texts").hidden = true;
    }
  };

  R.init = function () {
    $("#relay-start").addEventListener("click", start);
    $("#relay-step").addEventListener("click", step);
    $("#relay-all").addEventListener("click", runAll);
  };

  LU.Relay = R;
})(window.LU);
