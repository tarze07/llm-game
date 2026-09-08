/* Zakładka Transformer: uczenie małej sieci na żywo i generowanie tekstu z softmaxu. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";
  var $ = LU.$, el = LU.el, T = LU.Tx;

  var X = {
    data: null,
    model: null,
    stamp: null,
    raf: null,
    running: false,
    autoTimer: null,
    seedIds: [],
    ids: [],          // pełny wygenerowany ciąg (z promptem)
    fresh: -1,
    lastDist: null
  };

  function css(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  function target() { return parseInt($("#tx-target").value, 10) || 500; }
  function stopAt() { return X.stopAt || target(); }

  /* ---------- budowa modelu ---------- */

  function rebuild(force) {
    var dim = parseInt($("#tx-dim").value, 10);
    var ctx = parseInt($("#tx-ctx").value, 10);
    var stamp = LU.state.rawText + "|" + dim + "|" + ctx;
    if (!force && X.stamp === stamp && X.model) return;

    stop();
    X.stamp = stamp;
    X.data = T.buildData(LU.state.tokens, ctx);
    X.model = T.createModel(X.data, { dim: dim, hidden: 2 * dim, seed: 20260908 });
    X.stopAt = null;
    X.perplexity = null;
    fillSeeds();
    resetOutput();
    renderTraining();
    renderStep();
  }

  function fillSeeds() {
    var sel = $("#tx-seed");
    var previous = sel.value;
    sel.innerHTML = "";
    X.data.vocab.forEach(function (w) {
      if (LU.isPunct(w)) return;
      sel.appendChild(el("option", { value: w, text: w }));
    });
    if (!sel.options.length) {
      X.data.vocab.forEach(function (w) { sel.appendChild(el("option", { value: w, text: w })); });
    }
    if (previous && X.data.index.has(previous)) sel.value = previous;
  }

  function resetOutput() {
    var seed = $("#tx-seed").value || X.data.vocab[0];
    X.seedIds = [X.data.index.get(seed)];
    X.ids = X.seedIds.slice();
    X.fresh = -1;
    X.lastDist = null;
    renderOutput();
  }

  /* ---------- 1. uczenie ---------- */

  function renderStats() {
    var host = $("#tx-stats");
    host.innerHTML = "";
    var loss = X.model.history.length ? X.model.history[X.model.history.length - 1] : null;
    function stat(v, label) {
      return el("div", { class: "stat" }, [el("b", { text: String(v) }), el("span", { text: label })]);
    }
    host.appendChild(stat(X.model.params.toLocaleString("pl-PL"), "parametrów sieci"));
    host.appendChild(stat(X.data.vocab.length, "tokenów w słowniku"));
    host.appendChild(stat(X.model.step, "kroków uczenia"));
    host.appendChild(stat(loss === null ? "—" : loss.toFixed(2), "strata"));
    host.appendChild(stat(X.perplexity === undefined || X.perplexity === null ? "—" : X.perplexity.toFixed(2), "zakłopotanie"));

    $("#tx-progress").style.width = Math.min(100, X.model.step / stopAt() * 100) + "%";
    $("#tx-note").textContent = X.model.step === 0
      ? "Sieć ma na razie losowe wagi — wygenerowany tekst będzie bełkotem."
      : (X.model.step >= stopAt() ? "Cel osiągnięty. „Ucz” doda kolejną porcję kroków." : "");
  }

  function drawLoss() {
    var canvas = $("#tx-loss");
    var ratio = window.devicePixelRatio || 1;
    var width = canvas.parentElement.clientWidth || 480, height = 150;
    canvas.style.width = "100%"; canvas.style.height = height + "px";
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = css("--line");
    ctx.strokeRect(.5, .5, width - 1, height - 1);

    var h = X.model.history;
    if (h.length < 2) {
      ctx.fillStyle = css("--ink-soft");
      ctx.font = "12px ui-monospace, monospace";
      ctx.fillText("naciśnij „Ucz”, żeby zobaczyć spadek straty", 12, height / 2);
      return;
    }
    var max = Math.max.apply(null, h), min = Math.min.apply(null, h);
    var span = (max - min) || 1;
    ctx.beginPath();
    h.forEach(function (v, i) {
      var x = 5 + i / (h.length - 1) * (width - 10);
      var y = height - 8 - (v - min) / span * (height - 22);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = css("--accent");
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = css("--ink-soft");
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(max.toFixed(2), 7, 13);
    ctx.fillText(min.toFixed(2), 7, height - 7);
  }

  function renderTraining() {
    renderStats();
    drawLoss();
  }

  /* Uczenie w kawałkach: mieścimy się w budżecie ~25 ms na klatkę, żeby strona nie zamarzała. */
  function frame() {
    var lr = parseFloat($("#tx-lr").value) || 0.03;
    var budget = performance.now() + 25;
    do {
      T.trainBatch(X.model, 16, lr);
    } while (performance.now() < budget && X.model.step < stopAt());

    X.perplexity = T.perplexity(X.model);
    renderTraining();

    if (X.model.step >= stopAt()) {
      stop();
      renderStep();
      LU.award("neuron");
      LU.toast("Sieć nauczona — sprawdź, co teraz generuje.");
      return;
    }
    X.raf = requestAnimationFrame(frame);
  }

  function play() {
    if (X.running) { stop(); return; }
    X.stopAt = X.model.step >= target() ? X.model.step + target() : target();
    X.running = true;
    $("#tx-play").textContent = "⏸ Pauza";
    X.raf = requestAnimationFrame(frame);
  }

  function stop() {
    X.running = false;
    if (X.raf) cancelAnimationFrame(X.raf);
    X.raf = null;
    stopAuto();
    var btn = $("#tx-play");
    if (btn) btn.textContent = "▶ Ucz";
  }

  /* ---------- 2. generowanie ---------- */

  function renderOutput() {
    var host = $("#tx-output");
    host.innerHTML = "";
    if (!X.ids.length) {
      host.appendChild(el("span", { class: "muted small", text: "Wybierz prompt i naciśnij „Następne słowo”." }));
      $("#tx-outstats").textContent = "";
      return;
    }
    var capitalize = true;
    X.ids.forEach(function (id, i) {
      var word = X.data.vocab[id];
      if (LU.isPunct(word)) {
        host.appendChild(el("span", { class: i === X.fresh ? "w fresh" : "w", text: word }));
        if (word === "." || word === "!" || word === "?") capitalize = true;
        return;
      }
      if (i > 0) host.appendChild(document.createTextNode(" "));
      host.appendChild(el("span", {
        class: (i === X.fresh ? "w fresh" : "w") + (i < X.seedIds.length ? " ctx" : ""),
        text: capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word
      }));
      capitalize = false;
    });
    var words = X.ids.filter(function (id) { return !LU.isPunct(X.data.vocab[id]); }).length;
    $("#tx-outstats").textContent = words + " słów · kontekst widziany przez sieć: ostatnie " +
      Math.min(X.ids.length, X.data.contextLength) + " tokenów";
  }

  function stepOnce() {
    if (!X.model) return;
    var dist = T.nextDistribution(X.model, X.ids, {
      temperature: parseFloat($("#tx-temp").value) || 1,
      topK: parseInt($("#tx-topk").value, 10) || 0
    });
    var pick = T.sample(dist);
    X.ids.push(pick.id);
    X.fresh = X.ids.length - 1;
    X.lastDist = dist;
    renderOutput();
    renderStep(dist, pick);
  }

  function undo() {
    if (X.ids.length <= X.seedIds.length) { LU.toast("To już sam prompt."); return; }
    X.ids.pop();
    X.fresh = -1;
    renderOutput();
    renderStep();
  }

  function stopAuto() {
    if (X.autoTimer) { clearInterval(X.autoTimer); X.autoTimer = null; }
    var b = $("#tx-auto");
    if (b) b.textContent = "Pisz dalej ▶";
  }

  function toggleAuto() {
    if (X.autoTimer) { stopAuto(); return; }
    $("#tx-auto").textContent = "Zatrzymaj ■";
    X.autoTimer = setInterval(function () {
      if (X.ids.length > 60) { stopAuto(); return; }
      stepOnce();
    }, 700);
  }

  /* ---------- 3-5. rozkład, uwaga, wnętrze kroku ---------- */

  function probBars(list, max) {
    var bars = el("div", { class: "bars" });
    list.slice(0, max || 8).forEach(function (r) {
      bars.appendChild(el("div", { class: "barrow" }, [
        el("span", { class: "lbl", text: r.word }),
        el("div", { class: "bartrack" }, [
          el("div", { class: "bar", style: "width:" + Math.max(2, Math.round(r.p * 100)) + "%" })
        ]),
        el("span", { class: "val", text: (r.p * 100).toFixed(1) + "%" })
      ]));
    });
    return bars;
  }

  function renderStep(dist, pick) {
    if (!X.model) return;
    dist = dist || T.nextDistribution(X.model, X.ids, {
      temperature: parseFloat($("#tx-temp").value) || 1,
      topK: parseInt($("#tx-topk").value, 10) || 0
    });
    X.lastDist = dist;

    // 3a. rozkład transformera
    var host = $("#tx-dist");
    host.innerHTML = "";
    host.appendChild(el("p", { class: "small muted", style: "margin:0 0 .5rem" },
      ["Kontekst: „" + dist.ids.map(function (id) { return X.data.vocab[id]; }).join(" ") + "”" +
        (pick ? " → wylosowano „" + pick.word + "”" : "")]));
    host.appendChild(probBars(dist.list, 8));

    // 3b. rozkład bigramu dla porównania
    var bhost = $("#tx-bigram");
    bhost.innerHTML = "";
    var lastWord = X.data.vocab[X.ids[X.ids.length - 1]];
    var bigram = LU.modelOfOrder(2);
    var cands = LU.candidates(bigram, [lastWord]);
    if (!cands.length) {
      bhost.appendChild(el("p", { class: "small muted", text: "Bigram nie zna następnika dla „" + lastWord + "” — dla niego to ślepy zaułek." }));
    } else {
      var total = cands.reduce(function (s, c) { return s + c.count; }, 0);
      bhost.appendChild(el("p", { class: "small muted", style: "margin:0 0 .5rem" },
        ["Po słowie „" + lastWord + "”, według policzonych kresek:"]));
      bhost.appendChild(probBars(cands.map(function (c) {
        return { word: c.token, p: c.count / total };
      }), 8));
    }

    renderAttention(dist);
    renderInside(dist);
  }

  function renderAttention(dist) {
    var host = $("#tx-attention");
    host.innerHTML = "";
    var words = dist.ids.map(function (id) { return X.data.vocab[id]; });
    var att = dist.attention;

    host.appendChild(el("p", { class: "small muted", style: "margin:0 0 .6rem" }, [
      "Ostatnia pozycja kontekstu rozdziela 100% uwagi między wszystkie wcześniejsze tokeny " +
      "(maska przyczynowa nie pozwala patrzeć w przód). Im mocniejszy kolor, tym większa waga."
    ]));

    var strip = el("div", { class: "attstrip" });
    words.forEach(function (w, i) {
      var weight = att[i] || 0;
      strip.appendChild(el("span", {
        class: "atttok",
        title: w + ": " + (weight * 100).toFixed(1) + "% uwagi",
        style: "background:color-mix(in srgb, var(--accent) " + Math.round(weight * 90) + "%, transparent)"
      }, [
        el("b", { text: w }),
        el("i", { text: (weight * 100).toFixed(0) + "%" })
      ]));
    });
    host.appendChild(strip);

    // pełna macierz uwagi dla całego kontekstu
    var table = el("table", { class: "heat att" });
    var head = el("tr", {}, [el("th", { class: "corner", text: "patrzy ↓ / na →" })]);
    words.forEach(function (w) { head.appendChild(el("th", {}, [el("span", { text: w })])); });
    table.appendChild(head);
    dist.cache.att.forEach(function (row, i) {
      var tr = el("tr", {}, [el("th", { text: words[i] })]);
      words.forEach(function (w, j) {
        var v = row[j] === undefined ? 0 : row[j];
        tr.appendChild(el("td", {
          style: "background:color-mix(in srgb, var(--accent) " + Math.round(v * 85) + "%, transparent)",
          title: words[i] + " → " + w + ": " + (v * 100).toFixed(1) + "%",
          text: v < 0.005 ? "" : (v * 100).toFixed(0)
        }));
      });
      table.appendChild(tr);
    });
    host.appendChild(el("div", { class: "heatwrap", style: "margin-top:.8rem" }, [table]));
  }

  function vecStrip(vec, label, note) {
    var max = 0, i;
    for (i = 0; i < vec.length; i++) max = Math.max(max, Math.abs(vec[i]));
    max = max || 1;
    var strip = el("div", { class: "vecstrip" });
    for (i = 0; i < vec.length; i++) {
      var v = vec[i] / max;
      strip.appendChild(el("span", {
        class: "cell",
        title: "wymiar " + i + ": " + vec[i].toFixed(4),
        style: "background:" + (v >= 0
          ? "color-mix(in srgb, var(--accent) " + Math.round(Math.abs(v) * 85) + "%, transparent)"
          : "color-mix(in srgb, var(--hot) " + Math.round(Math.abs(v) * 85) + "%, transparent)")
      }));
    }
    return el("div", { class: "pipe-step", style: "align-items:stretch" }, [
      el("span", { class: "tag", text: label }),
      strip,
      note ? el("span", { class: "small muted", text: note }) : null
    ]);
  }

  function renderInside(dist) {
    var host = $("#tx-inside");
    host.innerHTML = "";
    var c = dist.cache, i = dist.position;
    var m = X.model;

    var row = el("div", { class: "pipeline wrap" }, [
      vecStrip(c.h0[i], "wejście: osadzenie + pozycja", "słowo zamienione w liczby"),
      el("div", { class: "pipe-arrow", text: "→" }),
      vecStrip(c.q[i], "zapytanie q", "czego szukam?"),
      vecStrip(c.k[i], "klucz k", "co oferuję?"),
      vecStrip(c.v[i], "wartość v", "co przekazuję?"),
      el("div", { class: "pipe-arrow", text: "→" }),
      vecStrip(c.ctx[i], "kontekst c", "mieszanka v wg wag uwagi"),
      el("div", { class: "pipe-arrow", text: "→" }),
      vecStrip(c.z[i], "z = wejście + uwaga", "połączenie rezydualne"),
      el("div", { class: "pipe-arrow", text: "→" }),
      vecStrip(c.u[i], "u = z + FFN(z)", "wektor gotowy do odczytu")
    ]);
    host.appendChild(row);

    var top = dist.list.slice(0, 5).map(function (r) {
      return r.word + " " + (r.p * 100).toFixed(1) + "%";
    }).join("   ");
    host.appendChild(el("p", { class: "small muted", style: "margin:.8rem 0 .3rem" }, [
      "Na końcu mnożymy wektor u przez macierz osadzeń (te same wagi, co na wejściu — stąd „wiązanie wag”), " +
      "dostajemy po jednej liczbie na każde słowo ze słownika (logity), a softmax zamienia je w prawdopodobieństwa:"
    ]));
    host.appendChild(el("p", { class: "mono small", style: "margin:0", text: top }));

    host.appendChild(el("p", { class: "small muted", style: "margin:.8rem 0 0" }, [
      "To wszystko: " + m.params.toLocaleString("pl-PL") + " liczb, jedna warstwa i jedna głowica. " +
      "Prawdziwy model ma tych warstw kilkadziesiąt, głowic kilkanaście na warstwę i miliardy liczb — " +
      "ale schemat kroku jest dokładnie ten sam."
    ]));
  }

  /* ---------- wejście/wyjście zakładki ---------- */

  X.onEnter = function () {
    rebuild(false);
    drawLoss();
  };
  X.onLeave = stop;

  X.init = function () {
    ["#tx-dim", "#tx-ctx"].forEach(function (sel) {
      $(sel).addEventListener("change", function () { rebuild(true); });
    });
    $("#tx-target").addEventListener("change", function () { X.stopAt = null; renderStats(); });
    $("#tx-play").addEventListener("click", play);
    $("#tx-reset").addEventListener("click", function () {
      rebuild(true);
      LU.toast("Wagi wylosowane od nowa.");
    });
    $("#tx-step").addEventListener("click", stepOnce);
    $("#tx-auto").addEventListener("click", toggleAuto);
    $("#tx-back").addEventListener("click", undo);
    $("#tx-clear").addEventListener("click", function () {
      stopAuto(); resetOutput(); renderStep();
    });
    $("#tx-seed").addEventListener("change", function () { stopAuto(); resetOutput(); renderStep(); });
    ["#tx-temp", "#tx-topk"].forEach(function (sel) {
      $(sel).addEventListener("change", function () { renderStep(); });
    });
    window.addEventListener("resize", function () {
      if ($("#view-tx").hidden || !X.model) return;
      drawLoss();
    });
  };

  LU.Transformer = X;
})(window.LU);
