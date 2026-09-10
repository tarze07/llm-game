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
    lastDist: null,
    stepIndex: 0,
    stepTimer: null,
    posLocked: false,
    posLabels: null
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
    X.posLocked = false;
    X.posLabels = null;
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
    stopStepPlayer();
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
    renderSimulation();
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

  /* ---------- 5. symulacja kroku po kroku ---------- */

  var STEPS = [
    { name: "1. Token → osadzenie", fn: stepEmbedding },
    { name: "2. Dodanie pozycji", fn: stepPosition },
    { name: "3. Zapytanie, klucz, wartość", fn: stepQKV },
    { name: "4. Podobieństwa i maska", fn: stepScores },
    { name: "5. Softmax → wagi uwagi", fn: stepSoftmax },
    { name: "6. Mieszanie wartości", fn: stepMix },
    { name: "7. Rezydualne i sieć FFN", fn: stepFFN },
    { name: "8. Logity i wybór słowa", fn: stepLogits }
  ];

  function num(v, digits) { return v.toFixed(digits === undefined ? 3 : digits); }

  /* Liczba jako czynnik iloczynu: ujemne w nawiasie, żeby „0.30·-0.43” nie myliło oka. */
  function factor(v, digits) {
    var t = num(v, digits === undefined ? 2 : digits);
    return v < 0 ? "(" + t.replace("-", "−") + ")" : t;
  }

  /* Wiersz: etykieta, pasek kolorów i kilka pierwszych liczb. */
  function vecRow(label, vec, opts) {
    opts = opts || {};
    var max = 0, i;
    for (i = 0; i < vec.length; i++) max = Math.max(max, Math.abs(vec[i]));
    max = max || 1;
    var strip = el("div", { class: "vecstrip" });
    for (i = 0; i < vec.length; i++) {
      var v = vec[i] / max;
      strip.appendChild(el("span", {
        class: "cell" + (i === opts.highlight ? " hl" : ""),
        title: "wymiar " + i + ": " + num(vec[i], 4),
        style: "background:" + (v >= 0
          ? "color-mix(in srgb, var(--accent) " + Math.round(Math.abs(v) * 85) + "%, transparent)"
          : "color-mix(in srgb, var(--hot) " + Math.round(Math.abs(v) * 85) + "%, transparent)")
      }));
    }
    return el("div", { class: "vecrow" + (opts.strong ? " strong" : "") }, [
      el("span", { class: "vecrow-label", text: label }),
      strip,
      el("span", { class: "vecrow-num mono", text: opts.highlight !== undefined
        ? "[" + opts.highlight + "] = " + num(vec[opts.highlight], 3)
        : num(vec[0], 2) + " …" })
    ]);
  }

  function formula(html) {
    return el("p", { class: "formula mono", html: html });
  }

  function note(text) {
    return el("p", { class: "small muted", style: "margin:.6rem 0 0", text: text });
  }

  /* Mała mapa macierzy wag z podświetlonym wierszem. */
  function matrixMini(W, rows, cols, highlightRow, label) {
    var max = 0, i;
    for (i = 0; i < W.length; i++) max = Math.max(max, Math.abs(W[i]));
    max = max || 1;
    var grid = el("div", { class: "matmini", style: "grid-template-columns:repeat(" + cols + ", 1fr)" });
    for (var r = 0; r < rows; r++) {
      for (var c2 = 0; c2 < cols; c2++) {
        var v = W[r * cols + c2] / max;
        grid.appendChild(el("span", {
          class: "mcell" + (r === highlightRow ? " hl" : ""),
          title: label + "[" + r + "," + c2 + "] = " + num(W[r * cols + c2], 4),
          style: "background:" + (v >= 0
            ? "color-mix(in srgb, var(--accent) " + Math.round(Math.abs(v) * 90) + "%, transparent)"
            : "color-mix(in srgb, var(--hot) " + Math.round(Math.abs(v) * 90) + "%, transparent)")
        }));
      }
    }
    return el("div", { class: "pipe-step", style: "align-items:stretch" }, [
      el("span", { class: "tag", text: label + " (" + rows + "×" + cols + ")" }),
      grid
    ]);
  }

  /* Rozpisanie iloczynu skalarnego na składniki: pokazujemy kilka pierwszych. */
  function dotBreakdown(rowLabel, W, rowIndex, x, dim, resultLabel) {
    var terms = [], sum = 0;
    for (var i = 0; i < dim; i++) {
      var w = W[rowIndex * dim + i];
      sum += w * x[i];
      if (i < 4) terms.push(factor(w) + "·" + factor(x[i]));
    }
    var more = dim > 4 ? " + … (" + (dim - 4) + " dalszych składników)" : "";
    return formula("<strong>" + resultLabel + "</strong> = " + rowLabel + " · wejście = " +
      terms.join(" + ") + more + " = <strong>" + num(sum, 3) + "</strong>");
  }

  function stepEmbedding(host, S) {
    host.appendChild(el("p", { class: "small muted", style: "margin:0 0 .7rem" }, [
      "Model nie widzi liter. Widzi numer tokenu w słowniku, a pod tym numerem " +
      "leży wiersz macierzy osadzeń — kilkanaście liczb, które uczą się razem z resztą sieci."
    ]));
    host.appendChild(el("div", { class: "pipeline" }, [
      el("div", { class: "pipe-step" }, [el("span", { class: "tag", text: "token" }), el("b", { class: "mono", text: S.word })]),
      el("div", { class: "pipe-arrow", text: "→" }),
      el("div", { class: "pipe-step" }, [el("span", { class: "tag", text: "numer w słowniku" }),
        el("b", { class: "mono", text: "#" + S.id + " z " + S.m.vocabSize })]),
      el("div", { class: "pipe-arrow", text: "→" }),
      el("div", { class: "pipe-step" }, [el("span", { class: "tag", text: "wiersz macierzy E" }),
        el("b", { class: "mono", text: S.m.dim + " liczb" })])
    ]));
    host.appendChild(vecRow("E[" + S.word + "]", S.c.emb[S.pos], { highlight: S.dimIdx, strong: true }));
    host.appendChild(formula("E[" + S.word + "] = [" +
      Array.prototype.slice.call(S.c.emb[S.pos], 0, 6).map(function (v) { return num(v, 2); }).join(", ") +
      (S.m.dim > 6 ? ", …" : "") + "]"));
    host.appendChild(note("Na starcie te liczby są losowe. Po uczeniu słowa używane podobnie mają podobne wiersze — dokładnie to oglądasz w zakładce Wektory."));
  }

  function stepPosition(host, S) {
    host.appendChild(el("p", { class: "small muted", style: "margin:0 0 .7rem" }, [
      "Uwaga patrzy na wszystkie pozycje naraz i sama z siebie nie wie, która była pierwsza. " +
      "Dlatego do osadzenia dodajemy wektor pozycji z sinusów i cosinusów o różnych częstotliwościach."
    ]));
    host.appendChild(vecRow("osadzenie słowa", S.c.emb[S.pos], { highlight: S.dimIdx }));
    host.appendChild(vecRow("pozycja nr " + S.pos, S.c.pos[S.pos], { highlight: S.dimIdx }));
    host.appendChild(vecRow("suma = wejście warstwy", S.c.h0[S.pos], { highlight: S.dimIdx, strong: true }));
    var d = S.dimIdx;
    host.appendChild(formula("wejście[" + d + "] = " + num(S.c.emb[S.pos][d], 3) + " + " +
      num(S.c.pos[S.pos][d], 3) + " = <strong>" + num(S.c.h0[S.pos][d], 3) + "</strong>"));
    host.appendChild(note("Bez tego kroku „kot pije mleko” i „mleko pije kot” byłyby dla sieci tym samym zbiorem wektorów."));
  }

  function stepQKV(host, S) {
    host.appendChild(el("p", { class: "small muted", style: "margin:0 0 .7rem" }, [
      "Z jednego wektora wejściowego robimy trzy: zapytanie (czego szukam), klucz (co oferuję) " +
      "i wartość (co przekazuję dalej). Każdy powstaje przez pomnożenie przez wyuczoną macierz."
    ]));
    host.appendChild(el("div", { class: "pipeline wrap" }, [
      matrixMini(S.m.Wq, S.m.dim, S.m.dim, S.dimIdx, "Wq"),
      matrixMini(S.m.Wk, S.m.dim, S.m.dim, S.dimIdx, "Wk"),
      matrixMini(S.m.Wv, S.m.dim, S.m.dim, S.dimIdx, "Wv")
    ]));
    host.appendChild(vecRow("q — zapytanie", S.c.q[S.pos], { highlight: S.dimIdx }));
    host.appendChild(vecRow("k — klucz", S.c.k[S.pos], { highlight: S.dimIdx }));
    host.appendChild(vecRow("v — wartość", S.c.v[S.pos], { highlight: S.dimIdx }));
    host.appendChild(dotBreakdown("wiersz " + S.dimIdx + " macierzy Wq", S.m.Wq, S.dimIdx, S.c.h0[S.pos], S.m.dim, "q[" + S.dimIdx + "]"));
    host.appendChild(note("Podświetlony wiersz macierzy odpowiada wybranemu wymiarowi wyjścia. Zmień wymiar w liście powyżej, żeby zobaczyć inny."));
  }

  function stepScores(host, S) {
    var scale = Math.sqrt(S.m.dim);
    host.appendChild(el("p", { class: "small muted", style: "margin:0 0 .7rem" }, [
      "Zapytanie bieżącej pozycji mnożymy skalarnie przez klucz każdej pozycji. " +
      "Wynik dzielimy przez pierwiastek z wymiaru, żeby liczby nie rosły wraz z rozmiarem modelu."
    ]));
    var table = el("table", { class: "simple compact" });
    table.appendChild(el("tr", {}, [
      el("th", { text: "pozycja" }), el("th", { text: "token" }),
      el("th", { text: "q · k" }), el("th", { text: "÷ √" + S.m.dim }), el("th", { text: "stan" })
    ]));
    S.words.forEach(function (w, j) {
      var allowed = j <= S.pos;
      var raw = allowed ? S.c.scores[S.pos][j] * scale : null;
      table.appendChild(el("tr", { class: allowed ? "" : "masked" }, [
        el("td", { class: "mono", text: String(j) }),
        el("td", { class: "mono", text: w }),
        el("td", { class: "mono", text: allowed ? num(raw, 2) : "—" }),
        el("td", { class: "mono", text: allowed ? num(S.c.scores[S.pos][j], 2) : "—" }),
        el("td", { class: "small", text: allowed ? "widoczne" : "zasłonięte maską (to przyszłość)" })
      ]));
    });
    host.appendChild(table);
    host.appendChild(note("Maska przyczynowa jest powodem, dla którego model piszący tekst nie może podejrzeć dalszego ciągu — przy uczeniu widziałby wtedy odpowiedź."));
  }

  function stepSoftmax(host, S) {
    var sc = S.c.scores[S.pos], att = S.c.att[S.pos];
    var max = -Infinity, j;
    for (j = 0; j < sc.length; j++) max = Math.max(max, sc[j]);
    var exps = [], sum = 0;
    for (j = 0; j < sc.length; j++) { var e2 = Math.exp(sc[j] - max); exps.push(e2); sum += e2; }

    host.appendChild(el("p", { class: "small muted", style: "margin:0 0 .7rem" }, [
      "Softmax zamienia dowolne liczby w rozkład: podnosimy e do potęgi każdej z nich " +
      "(po odjęciu największej, żeby nie przepełnić liczb) i dzielimy przez sumę. Wagi zawsze dają w sumie 100%."
    ]));
    var table = el("table", { class: "simple compact" });
    table.appendChild(el("tr", {}, [
      el("th", { text: "token" }), el("th", { text: "wynik" }),
      el("th", { text: "e^(wynik − max)" }), el("th", { text: "waga" }), el("th", { text: "" })
    ]));
    for (j = 0; j < sc.length; j++) {
      table.appendChild(el("tr", {}, [
        el("td", { class: "mono", text: S.words[j] }),
        el("td", { class: "mono", text: num(sc[j], 2) }),
        el("td", { class: "mono", text: num(exps[j], 3) }),
        el("td", { class: "mono", text: (att[j] * 100).toFixed(1) + "%" }),
        el("td", {}, [el("div", { class: "bartrack" }, [
          el("div", { class: "bar", style: "width:" + Math.max(2, Math.round(att[j] * 100)) + "%" })
        ])])
      ]));
    }
    host.appendChild(table);
    host.appendChild(formula("suma wykładników = " + num(sum, 3) +
      " · suma wag = " + (att.reduce(function (a, b) { return a + b; }, 0) * 100).toFixed(1) + "%"));
  }

  function stepMix(host, S) {
    var att = S.c.att[S.pos], d = S.dimIdx;
    host.appendChild(el("p", { class: "small muted", style: "margin:0 0 .7rem" }, [
      "Wagi mówią, w jakich proporcjach zmieszać wektory wartości. To jest cała uwaga: " +
      "ważona średnia tego, co niosą pozostałe pozycje."
    ]));
    for (var j = 0; j < att.length; j++) {
      host.appendChild(vecRow(S.words[j] + " · " + (att[j] * 100).toFixed(0) + "%", S.c.v[j], { highlight: d }));
    }
    host.appendChild(vecRow("wynik: kontekst c", S.c.ctx[S.pos], { highlight: d, strong: true }));
    var order = [];
    for (var j3 = 0; j3 < att.length; j3++) order.push(j3);
    order.sort(function (a, b) { return att[b] - att[a]; });      // najpierw to, co waży najwięcej
    var terms = order.slice(0, 4).map(function (j4) {
      return factor(att[j4]) + "·" + factor(S.c.v[j4][d]) + " <span class=\"muted\">(" + S.words[j4] + ")</span>";
    });
    host.appendChild(formula("c[" + d + "] = " + terms.join(" + ") +
      (att.length > 4 ? " + …" : "") + " = <strong>" + num(S.c.ctx[S.pos][d], 3) + "</strong>"));
    host.appendChild(note("Składniki uszeregowane od największej wagi. Pozycje z wagą bliską zeru prawie nic nie wnoszą — i o to chodzi: uwaga wybiera, czego słuchać."));
  }

  function stepFFN(host, S) {
    var d = S.dimIdx;
    var active = 0, pre = S.c.pre[S.pos];
    for (var i = 0; i < pre.length; i++) if (pre[i] > 0) active++;

    host.appendChild(el("p", { class: "small muted", style: "margin:0 0 .7rem" }, [
      "Wynik uwagi przepuszczamy przez macierz Wo i dodajemy do wejścia — to połączenie rezydualne, " +
      "dzięki któremu pierwotna informacja o słowie nie ginie. Potem to samo robi mała sieć FFN."
    ]));
    host.appendChild(vecRow("wejście warstwy", S.c.h0[S.pos], { highlight: d }));
    host.appendChild(vecRow("Wo · c (wyjście uwagi)", S.c.attOut[S.pos], { highlight: d }));
    host.appendChild(vecRow("z = wejście + uwaga", S.c.z[S.pos], { highlight: d, strong: true }));
    host.appendChild(formula("z[" + d + "] = " + num(S.c.h0[S.pos][d], 3) + " + " +
      num(S.c.attOut[S.pos][d], 3) + " = <strong>" + num(S.c.z[S.pos][d], 3) + "</strong>"));

    host.appendChild(el("h4", { style: "margin:1rem 0 .4rem", text: "Sieć FFN: rozszerz, obetnij ujemne, ściśnij z powrotem" }));
    host.appendChild(vecRow("po ReLU (" + S.m.hidden + " neuronów)", S.c.relu[S.pos], {}));
    host.appendChild(vecRow("FFN(z)", S.c.ffn[S.pos], { highlight: d }));
    host.appendChild(vecRow("u = z + FFN(z)", S.c.u[S.pos], { highlight: d, strong: true }));
    host.appendChild(formula("aktywnych neuronów: <strong>" + active + " z " + S.m.hidden +
      "</strong> — ReLU zeruje resztę, więc każda pozycja korzysta z innego podzbioru sieci"));
  }

  function stepLogits(host, S) {
    var logits = S.c.logits[S.pos];
    var list = [];
    for (var i = 0; i < logits.length; i++) list.push({ word: S.m.data.vocab[i], logit: logits[i], id: i });
    list.sort(function (a, b) { return b.logit - a.logit; });
    var temp = parseFloat($("#tx-temp").value) || 1;
    var probs = T.softmax(logits, temp);

    host.appendChild(el("p", { class: "small muted", style: "margin:0 0 .7rem" }, [
      "Gotowy wektor mnożymy przez macierz osadzeń — tę samą, od której zaczynaliśmy. " +
      "Dla każdego słowa ze słownika wychodzi jedna liczba (logit), a softmax z temperaturą " +
      temp.toFixed(1) + " zamienia je w prawdopodobieństwa."
    ]));
    var table = el("table", { class: "simple compact" });
    table.appendChild(el("tr", {}, [
      el("th", { text: "słowo" }), el("th", { text: "logit = u · E[słowo] + b" }),
      el("th", { text: "prawdopodobieństwo" }), el("th", { text: "" })
    ]));
    list.slice(0, 8).forEach(function (r, idx) {
      var top = idx === 0;
      table.appendChild(el("tr", { class: top ? "hitrow" : "" }, [
        el("td", { class: "mono", text: r.word + (top ? "  ← faworyt" : "") }),
        el("td", { class: "mono", text: num(r.logit, 2) }),
        el("td", { class: "mono", text: (probs[r.id] * 100).toFixed(1) + "%" }),
        el("td", {}, [el("div", { class: "bartrack" }, [
          el("div", { class: "bar", style: "width:" + Math.max(2, Math.round(probs[r.id] * 100)) + "%" })
        ])])
      ]));
    });
    host.appendChild(table);
    var best = list[0];
    host.appendChild(formula("logit(" + best.word + ") = suma " + S.m.dim + " iloczynów u · E[" +
      best.word + "] + b = <strong>" + num(best.logit, 3) + "</strong>"));
    host.appendChild(note("To jest rozkład, z którego padnie następne słowo — naciśnij „Następne słowo ▶” w sekcji 2, " +
      "a model wylosuje z tych prawdopodobieństw (faworyt nie zawsze wygrywa, od tego jest temperatura), " +
      "dopisze wynik do tekstu i cała ósemka etapów ruszy od nowa. W prawdziwym modelu — przez kilkadziesiąt warstw zamiast jednej."));
  }

  /* Symulacja zawsze dotyczy bieżącego kontekstu, czyli kroku, który dopiero ma się wydarzyć.
     Liczymy dla niej własny przebieg w przód — kilkanaście tokenów, koszt pomijalny. */
  function renderSimulation() {
    var host = $("#tx-stage");
    if (!host || !X.model) return;
    host.innerHTML = "";

    var dist = T.nextDistribution(X.model, X.ids, {
      temperature: parseFloat($("#tx-temp").value) || 1,
      topK: parseInt($("#tx-topk").value, 10) || 0
    });
    var words = dist.ids.map(function (id) { return X.data.vocab[id]; });

    /* Lista pozycji do analizy. Okno kontekstu przesuwa się z każdym słowem, więc etykiety
       przebudowujemy zawsze, gdy zmieni się treść; dopóki użytkownik sam nie wybierze pozycji,
       trzymamy się tej ostatniej — czyli tej, z której powstaje następne słowo. */
    var posSel = $("#tx-pos");
    var labels = words.join(" ");
    if (X.posLabels !== labels) {
      X.posLabels = labels;
      var keep = X.posLocked ? posSel.value : null;
      posSel.innerHTML = "";
      words.forEach(function (w, i) {
        posSel.appendChild(el("option", {
          value: String(i),
          text: (i + 1) + ". „" + w + "”" + (i === words.length - 1 ? " (ostatnia)" : "")
        }));
      });
      posSel.value = keep !== null && Number(keep) < words.length ? keep : String(words.length - 1);
    }
    if (!X.posLocked) posSel.value = String(words.length - 1);
    var pos = Math.min(parseInt(posSel.value, 10) || 0, words.length - 1);

    var dimSel = $("#tx-dimsel");
    if (dimSel.options.length !== X.model.dim) {
      dimSel.innerHTML = "";
      for (var d = 0; d < X.model.dim; d++) {
        dimSel.appendChild(el("option", { value: String(d), text: "wymiar " + d }));
      }
      dimSel.value = "0";
    }

    var S = {
      m: X.model, c: dist.cache, pos: pos, words: words,
      word: words[pos], id: dist.ids[pos],
      dimIdx: Math.min(parseInt(dimSel.value, 10) || 0, X.model.dim - 1)
    };

    // pasek etapów
    var track = $("#tx-steptrack");
    track.innerHTML = "";
    STEPS.forEach(function (st, i) {
      track.appendChild(el("li", {
        class: "stepdot" + (i === X.stepIndex ? " active" : "") + (i < X.stepIndex ? " done" : ""),
        title: st.name,
        onclick: function () { setStep(i); }
      }, [String(i + 1)]));
    });
    $("#tx-stepname").textContent = STEPS[X.stepIndex].name +
      "  ·  pozycja „" + S.word + "”";

    STEPS[X.stepIndex].fn(host, S);
  }

  function setStep(i) {
    X.stepIndex = Math.max(0, Math.min(STEPS.length - 1, i));
    renderStep();
  }

  function stopStepPlayer() {
    if (X.stepTimer) { clearInterval(X.stepTimer); X.stepTimer = null; }
    var b = $("#tx-playsteps");
    if (b) b.textContent = "Odtwórz wszystkie ▶";
  }

  function toggleStepPlayer() {
    if (X.stepTimer) { stopStepPlayer(); return; }
    $("#tx-playsteps").textContent = "Zatrzymaj ■";
    X.stepIndex = 0;
    renderStep();
    X.stepTimer = setInterval(function () {
      if (X.stepIndex >= STEPS.length - 1) { stopStepPlayer(); return; }
      setStep(X.stepIndex + 1);
    }, 2200);
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
    $("#tx-prev").addEventListener("click", function () { stopStepPlayer(); setStep(X.stepIndex - 1); });
    $("#tx-next").addEventListener("click", function () { stopStepPlayer(); setStep(X.stepIndex + 1); });
    $("#tx-playsteps").addEventListener("click", toggleStepPlayer);
    $("#tx-pos").addEventListener("change", function () {
      X.posLocked = true;          // użytkownik wybrał pozycję — nie przeskakujemy już sami
      stopStepPlayer(); renderStep();
    });
    $("#tx-dimsel").addEventListener("change", function () { stopStepPlayer(); renderStep(); });
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
