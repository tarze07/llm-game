/* Laboratorium: bigram kontra trigram, temperatura na żywo, zatruwanie danych. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";
  var $ = LU.$, el = LU.el;

  var L = { m2: null, m3: null, loaded: false };

  function stat(value, label) {
    return el("div", { class: "stat" }, [el("b", { text: String(value) }), el("span", { text: label })]);
  }

  function renderStats(host, model) {
    var s = LU.stats(model);
    host.innerHTML = "";
    host.appendChild(stat(s.vocab, "słów w słowniku"));
    host.appendChild(stat(s.contexts, "kontekstów w modelu"));
    host.appendChild(stat(s.entries, "wpisów (kontekst → słowo)"));
    host.appendChild(stat(s.forkPct + "%", "kontekstów z realnym wyborem"));
  }

  function renderSamples(host, model, order) {
    host.innerHTML = "";
    var contexts = LU.contextList(model).filter(function (c) { return !LU.isPunct(c.words[0]); });
    if (!contexts.length) contexts = LU.contextList(model);
    if (!contexts.length) { host.appendChild(el("p", { class: "small muted", text: "Za mało tekstu." })); return; }
    for (var i = 0; i < 3; i++) {
      var startCtx = contexts[Math.floor(Math.random() * Math.min(contexts.length, 12))].words;
      var tokens = LU.generateText(model, startCtx, { temperature: "normal", strategy: "none" }, 24);
      host.appendChild(el("div", { class: "sample" }, [
        el("span", { class: "tag", text: (order === 2 ? "bigram" : "trigram") + " · próbka " + (i + 1) }),
        el("p", { style: "margin:.3rem 0 0", text: LU.detokenize(tokens) })
      ]));
    }
  }

  function renderTempDemo() {
    var host = $("#lab-temp-host");
    var sel = $("#lab-ctx");
    host.innerHTML = "";
    if (!sel.value) return;
    var ctx = [sel.value];
    var cands = LU.candidates(L.m2, ctx);
    if (!cands.length) return;

    ["cold", "normal", "hot", "boiling"].forEach(function (temp) {
      var list = temp === "cold" ? LU.applyStrategy(cands, "greedy", {}).list : cands;
      var dice = LU.diceRanges(LU.applyTemperature(list, temp));
      var bars = el("div", { class: "bars" });
      dice.ranges.forEach(function (r) {
        bars.appendChild(el("div", { class: "barrow" }, [
          el("span", { class: "lbl", text: r.token }),
          el("div", { class: "bar", style: "width:" + Math.max(2, Math.round(r.prob * 100)) + "%" }),
          el("span", { class: "val", text: Math.round(r.prob * 100) + "%" })
        ]));
      });
      host.appendChild(el("div", { class: "panel", style: "margin:0;background:var(--panel-2)" }, [
        el("h3", { text: LU.TEMPERATURES[temp].label }),
        el("p", { class: "small muted", style: "margin:0 0 .5rem", text: LU.TEMPERATURES[temp].desc }),
        bars
      ]));
    });
  }

  function retrain() {
    var text = $("#lab-text").value;
    var tokens = LU.tokenize(text);
    if (tokens.length < 6) { LU.toast("Za mało tekstu do wytrenowania modelu."); return; }
    L.m2 = LU.train(tokens, 2);
    L.m3 = LU.train(tokens, 3);
    renderStats($("#lab-stats-2"), L.m2);
    renderStats($("#lab-stats-3"), L.m3);

    var sel = $("#lab-ctx");
    var previous = sel.value;
    sel.innerHTML = "";
    LU.contextList(L.m2).forEach(function (c) {
      sel.appendChild(el("option", { value: c.words[0], text: c.words[0] + " (" + c.options + " opcji)" }));
    });
    if (previous && L.m2.contexts.has(LU.ctxKey([previous]))) sel.value = previous;
    renderTempDemo();
    renderSamples($("#lab-samples-2"), L.m2, 2);
    renderSamples($("#lab-samples-3"), L.m3, 3);
  }

  L.onEnter = function () {
    if (!L.loaded) {
      $("#lab-text").value = LU.state.rawText;
      L.loaded = true;
      retrain();
    }
  };

  L.init = function () {
    $("#lab-retrain").addEventListener("click", retrain);
    $("#lab-load").addEventListener("click", function () {
      $("#lab-text").value = LU.state.rawText;
      retrain();
      LU.toast("Wczytano tekst z gry.");
    });
    $("#lab-syco").addEventListener("click", function () {
      var extra = " " + LU.SYCOPHANCY + " " + LU.SYCOPHANCY + " " + LU.SYCOPHANCY;
      $("#lab-text").value = $("#lab-text").value.trim() + extra;
      retrain();
      LU.toast("Dolano danych przypochlebnych — zobacz, jak zmieniły się próbki.");
    });
    $("#lab-gen").addEventListener("click", function () {
      if (!L.m2) retrain();
      renderSamples($("#lab-samples-2"), L.m2, 2);
      renderSamples($("#lab-samples-3"), L.m3, 3);
    });
    $("#lab-ctx").addEventListener("change", renderTempDemo);
  };

  LU.Lab = L;
})(window.LU);
