/* Zakładka Q·K·V: skąd biorą się macierze zapytań, kluczy i wartości i jak się uczą. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";
  var $ = LU.$, el = LU.el, T = LU.Tx;

  var Q = {
    data: null,
    model: null,
    stamp: null,
    grads: null,       // gradienty ostatnio policzone dla wybranego fragmentu
    stats: null,       // normy sygnału na kolejnych etapach
    before: null,      // kopia macierzy sprzed kroku Adama
    raf: null,
    race: null
  };

  function css(name) { return getComputedStyle(document.body).getPropertyValue(name).trim(); }
  function num(v, d) { return v.toFixed(d === undefined ? 3 : d); }

  /* Małe liczby (gradienty dobrze nauczonego modelu) po zaokrągleniu wyglądają jak zero —
     w takim razie pokazujemy je wykładniczo. */
  function smart(v) {
    var a = Math.abs(v);
    if (a === 0) return "0";
    if (a < 0.001) return v.toExponential(1).replace("e", " ·10^").replace("+", "");
    return num(v, a < 0.1 ? 4 : 3);
  }

  /* ---------- model doświadczalny (własny, żeby nie mieszać w zakładce Transformer) ---------- */

  function rebuild(force) {
    var stamp = LU.state.rawText;
    if (!force && Q.stamp === stamp && Q.model) return;
    stopRace();
    Q.stamp = stamp;
    Q.data = T.buildData(LU.state.tokens, 6);
    Q.model = T.createModel(Q.data, { dim: 12, hidden: 24, seed: 777 });
    Q.grads = null; Q.stats = null; Q.before = null;
    fillSequences();
    renderStatus();
    renderChain();
    renderMatrices();
  }

  function fillSequences() {
    var sel = $("#qkv-seq");
    var previous = sel.value;
    sel.innerHTML = "";
    Q.data.sequences.forEach(function (seq, i) {
      if (seq.length < 3) return;
      var words = seq.map(function (id) { return Q.data.vocab[id]; });
      var target = words[words.length - 1];
      sel.appendChild(el("option", {
        value: String(i),
        text: words.slice(0, -1).join(" ") + "  →  " + target
      }));
    });
    if (previous && sel.querySelector('option[value="' + previous + '"]')) sel.value = previous;
  }

  function renderStatus() {
    var loss = Q.model.history.length ? Q.model.history[Q.model.history.length - 1] : null;
    $("#qkv-status").textContent = "model doświadczalny: " + Q.model.dim + " wymiarów, " +
      Q.model.params.toLocaleString("pl-PL") + " parametrów, " + Q.model.step + " kroków uczenia" +
      (loss === null ? "" : ", strata " + num(loss, 2));
  }

  /* ---------- 1. łańcuch sygnału ---------- */

  var CHAIN = [
    { key: "dlogits", label: "pomyłka na logitach", desc: "różnica: co model przewidział minus co było naprawdę" },
    { key: "du", label: "→ wektor wyjściowy u", desc: "przez macierz osadzeń, wstecz" },
    { key: "dz", label: "→ po sieci FFN", desc: "przez W2, ReLU i W1" },
    { key: "dctx", label: "→ kontekst z uwagi", desc: "przez macierz Wo" },
    { key: "datt", label: "→ wagi uwagi", desc: "ile zyskałaby strata, gdyby uwaga rozłożyła się inaczej" },
    { key: "dscores", label: "→ wyniki q·k", desc: "przez pochodną softmaxu" },
    { key: "dq", label: "→ zapytania q", desc: "stąd bierze się poprawka Wq" },
    { key: "dk", label: "→ klucze k", desc: "stąd bierze się poprawka Wk" },
    { key: "dv", label: "→ wartości v", desc: "stąd bierze się poprawka Wv" }
  ];

  function computeGradient() {
    var idx = parseInt($("#qkv-seq").value, 10);
    var seq = Q.data.sequences[idx];
    if (!seq || seq.length < 3) { LU.toast("Wybierz dłuższy fragment."); return; }

    Q.grads = T.zeroGrads(Q.model);
    Q.stats = {};
    var loss = T.backward(Q.model, seq, Q.grads, Q.stats);
    Q.before = null;

    var context = seq.slice(0, seq.length - 1);
    var cache = T.forward(Q.model, context);
    var probs = cache.probs[context.length - 1];
    var targetId = seq[seq.length - 1];
    var bestId = 0;
    for (var i = 1; i < probs.length; i++) if (probs[i] > probs[bestId]) bestId = i;

    var gradSize = T.norm(Q.grads.Wq) + T.norm(Q.grads.Wk) + T.norm(Q.grads.Wv);
    Q.weakGradient = gradSize < 0.01;
    $("#qkv-loss").innerHTML = "strata na tym fragmencie: <strong>" + num(loss, 3) +
      "</strong> · model stawia na „<strong>" + Q.data.vocab[bestId] + "</strong>” (" +
      (probs[bestId] * 100).toFixed(1) + "%), a prawidłowa odpowiedź to „<strong>" +
      Q.data.vocab[targetId] + "</strong>” (" + (probs[targetId] * 100).toFixed(1) + "%)";

    renderChain();
    renderMatrices();
  }

  function renderChain() {
    var host = $("#qkv-chain");
    host.innerHTML = "";
    if (!Q.stats) {
      host.appendChild(el("p", { class: "small muted", text: "Naciśnij „Policz gradient”, żeby zobaczyć, ile sygnału dociera na każdy etap." }));
      return;
    }
    var values = CHAIN.map(function (c) { return Math.sqrt(Q.stats[c.key] || 0); });
    var max = Math.max.apply(null, values) || 1;

    var list = el("div", { class: "chain" });
    CHAIN.forEach(function (c, i) {
      var v = values[i];
      var isQKV = c.key === "dq" || c.key === "dk" || c.key === "dv";
      list.appendChild(el("div", { class: "chain-step" + (isQKV ? " target" : "") }, [
        el("span", { class: "chain-label", text: c.label }),
        el("div", { class: "bartrack" }, [
          el("div", { class: "bar", style: "width:" + Math.max(2, Math.round(v / max * 100)) + "%" })
        ]),
        el("span", { class: "chain-val mono", text: num(v, 3) }),
        el("span", { class: "chain-desc small muted", text: c.desc })
      ]));
    });
    host.appendChild(list);

    var dq = values[CHAIN.findIndex(function (c) { return c.key === "dq"; })];
    var dv = values[CHAIN.findIndex(function (c) { return c.key === "dv"; })];
    host.appendChild(el("p", { class: "small muted", style: "margin:.7rem 0 0" }, [
      "Zwróć uwagę na proporcje: do wartości (v) sygnał dociera zwykle kilkanaście razy silniejszy " +
      "niż do zapytań i kluczy (tutaj " + num(dv, 3) + " kontra " + num(dq, 3) + "). " +
      "To normalne — v wpływa na wynik wprost, a q i k tylko pośrednio, przez wagi uwagi, " +
      "które softmax dodatkowo spłaszcza. Dlatego uwaga uczy się wolniej niż reszta sieci."
    ]));
  }

  function renderMatrixNorms() {
    var host = $("#qkv-matnorms");
    host.innerHTML = "";
    if (!Q.grads) return;
    var rows = [
      ["Wq", "macierz zapytań"], ["Wk", "macierz kluczy"], ["Wv", "macierz wartości"],
      ["Wo", "wyjście uwagi"], ["E", "osadzenia"], ["W1", "FFN, warstwa 1"]
    ];
    var norms = rows.map(function (r) { return T.norm(Q.grads[r[0]]); });
    var max = Math.max.apply(null, norms) || 1;
    var bars = el("div", { class: "bars" });
    rows.forEach(function (r, i) {
      bars.appendChild(el("div", { class: "barrow" }, [
        el("span", { class: "lbl", text: r[0] }),
        el("div", { class: "bartrack" }, [
          el("div", { class: "bar", style: "width:" + Math.max(2, Math.round(norms[i] / max * 100)) + "%" })
        ]),
        el("span", { class: "val", text: num(norms[i], 3) })
      ]));
    });
    host.appendChild(el("h4", { style: "margin:0 0 .4rem", text: "Długość gradientu każdej macierzy" }));
    host.appendChild(bars);
    host.appendChild(el("p", { class: "small muted", style: "margin:.5rem 0 0", text:
      "To jest cała „wiedza” o tym, jak poprawić model po tym jednym fragmencie. Optymalizator Adam " +
      "zamienia te liczby na faktyczne zmiany wag." }));
    if (Q.weakGradient) {
      host.appendChild(el("div", { class: "msg", style: "margin-top:.6rem" }, [
        "Gradienty są tu bliskie zeru, bo model zna już ten fragment na pamięć — nie ma czego poprawiać. " +
        "Naciśnij „Od nowa (losowe macierze)” albo wybierz inny fragment, żeby zobaczyć mocny sygnał uczenia."
      ]));
    }
  }

  /* ---------- 2. macierze przed / gradient / po ---------- */

  function matrixView(label, values, dim, opts) {
    opts = opts || {};
    var max = 0, i;
    for (i = 0; i < values.length; i++) max = Math.max(max, Math.abs(values[i]));
    max = max || 1;
    var grid = el("div", { class: "matbig", style: "grid-template-columns:repeat(" + dim + ", 1fr)" });
    for (var r = 0; r < dim; r++) {
      for (var c2 = 0; c2 < dim; c2++) {
        var idx = r * dim + c2;
        var v = values[idx] / max;
        grid.appendChild(el("span", {
          class: "mcell" + (idx === opts.highlight ? " hl" : ""),
          title: label + "[" + r + "," + c2 + "] = " + num(values[idx], 4),
          style: "background:" + (v >= 0
            ? "color-mix(in srgb, var(--accent) " + Math.round(Math.abs(v) * 92) + "%, transparent)"
            : "color-mix(in srgb, var(--hot) " + Math.round(Math.abs(v) * 92) + "%, transparent)")
        }));
      }
    }
    return el("div", { class: "panel", style: "margin:0;background:var(--panel-2)" }, [
      el("h4", { style: "margin:0 0 .1rem", text: label }),
      el("p", { class: "small muted", style: "margin:0 0 .5rem", text: opts.note || "" }),
      grid,
      el("p", { class: "small mono muted", style: "margin:.5rem 0 0",
        text: "największa wartość: " + smart(max) })
    ]);
  }

  function renderMatrices() {
    var host = $("#qkv-mats");
    host.innerHTML = "";
    $("#qkv-cell").innerHTML = "";
    renderMatrixNorms();
    if (!Q.grads) {
      host.appendChild(el("p", { class: "small muted", text: "Najpierw policz gradient w sekcji 1." }));
      $("#qkv-apply").disabled = true;
      return;
    }
    $("#qkv-apply").disabled = false;

    var which = $("#qkv-which").value;
    var dim = Q.model.dim;
    host.appendChild(matrixView(which + (Q.before ? " — przed krokiem" : " — teraz"),
      Q.before || Q.model[which], dim,
      { note: Q.before ? "stan sprzed poprawki" : "stan bieżący" }));
    host.appendChild(matrixView("gradient d" + which, Q.grads[which], dim,
      { note: "w którą stronę i jak mocno warto ruszyć każdą liczbę" }));
    if (Q.before) {
      var delta = new Float64Array(Q.model[which].length);
      var maxIdx = 0;
      for (var i = 0; i < delta.length; i++) {
        delta[i] = Q.model[which][i] - Q.before[i];
        if (Math.abs(delta[i]) > Math.abs(delta[maxIdx])) maxIdx = i;
      }
      host.appendChild(matrixView(which + " — po kroku", Q.model[which], dim,
        { note: "wagi po jednej poprawce Adama", highlight: maxIdx }));

      var r = Math.floor(maxIdx / dim), c = maxIdx % dim;
      $("#qkv-cell").appendChild(el("p", { class: "formula mono", html:
        "największa zmiana: <strong>" + which + "[" + r + "," + c + "]</strong> = " +
        num(Q.before[maxIdx], 4) + " → " + num(Q.model[which][maxIdx], 4) +
        "  (o " + (delta[maxIdx] > 0 ? "+" : "−") + smart(Math.abs(delta[maxIdx])) +
        ", gradient " + smart(Q.grads[which][maxIdx]) + ")" }));
      $("#qkv-cell").appendChild(el("p", { class: "small muted", style: "margin:.5rem 0 0", text:
        "Adam nie mnoży po prostu gradientu przez tempo uczenia — dzieli go jeszcze przez typową " +
        "wielkość ostatnich gradientów tej komórki. Dlatego rzadko ruszane wagi dostają większe kroki " +
        "niż te, które i tak zmieniają się przy każdej paczce." }));
    } else {
      host.appendChild(el("div", { class: "panel", style: "margin:0;background:var(--panel-2)" }, [
        el("h4", { style: "margin:0 0 .3rem", text: which + " — po kroku" }),
        el("p", { class: "small muted", style: "margin:0", text:
          "Naciśnij „Wykonaj krok Adama”, żeby zobaczyć macierz po poprawce i największą zmianę." })
      ]));
    }
  }

  function applyStep() {
    if (!Q.grads) return;
    var which = $("#qkv-which").value;
    Q.before = Float64Array.from(Q.model[which]);
    T.adam(Q.model, Q.grads, parseFloat($("#qkv-lr").value) || 0.03);
    $("#qkv-applynote").textContent = "krok wykonany — po nim gradient jest już nieaktualny, policz go ponownie dla kolejnej porcji";
    renderStatus();
    renderMatrices();
  }

  /* ---------- 3. wyścig: model uczony kontra z zamrożonymi macierzami ---------- */

  function stopRace() {
    if (Q.raf) { cancelAnimationFrame(Q.raf); Q.raf = null; }
    var b = $("#qkv-race");
    if (b) b.textContent = "Trenuj oba modele";
  }

  function startRace() {
    if (Q.raf) { stopRace(); return; }
    var steps = parseInt($("#qkv-steps").value, 10) || 400;
    var frozenNames = $("#qkv-freeze").value.split(",");

    var base = T.createModel(Q.data, { dim: 12, hidden: 24, seed: 777 });
    var free = T.cloneModel(base);
    var frozen = T.cloneModel(base);
    frozen.frozen = {};
    frozenNames.forEach(function (n) { frozen.frozen[n] = true; });

    Q.race = { free: free, frozen: frozen, steps: steps, names: frozenNames, lossFree: [], lossFrozen: [] };
    $("#qkv-race").textContent = "Zatrzymaj ■";
    $("#qkv-raceresult").innerHTML = "";
    raceFrame();
  }

  function raceFrame() {
    var R = Q.race;
    var budget = performance.now() + 25;
    do {
      R.lossFree.push(T.trainBatch(R.free, 16, 0.03));
      R.lossFrozen.push(T.trainBatch(R.frozen, 16, 0.03));
    } while (performance.now() < budget && R.free.step < R.steps);

    drawRace();
    $("#qkv-raceinfo").textContent = R.free.step + " / " + R.steps + " kroków";

    if (R.free.step >= R.steps) {
      stopRace();
      finishRace();
      return;
    }
    Q.raf = requestAnimationFrame(raceFrame);
  }

  function drawRace() {
    var canvas = $("#qkv-racechart");
    var ratio = window.devicePixelRatio || 1;
    var width = canvas.parentElement.clientWidth || 600, height = 170;
    canvas.style.width = "100%"; canvas.style.height = height + "px";
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = css("--line");
    ctx.strokeRect(.5, .5, width - 1, height - 1);

    var R = Q.race;
    if (!R || R.lossFree.length < 2) return;
    var all = R.lossFree.concat(R.lossFrozen);
    var max = Math.max.apply(null, all), min = Math.min.apply(null, all);
    var span = (max - min) || 1;

    function line(series, color) {
      ctx.beginPath();
      series.forEach(function (v, i) {
        var x = 6 + i / (series.length - 1) * (width - 12);
        var y = height - 10 - (v - min) / span * (height - 26);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    line(R.lossFree, css("--accent"));
    line(R.lossFrozen, css("--hot"));

    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = css("--accent");
    ctx.fillText("model uczony w całości", 10, 15);
    ctx.fillStyle = css("--hot");
    ctx.fillText("z zamrożonymi " + R.names.join(", "), 10, 30);
  }

  function sample(model) {
    var starts = [];
    Q.data.vocab.forEach(function (w, i) { if (!LU.isPunct(w)) starts.push(i); });
    var ids = [starts[Math.floor(Math.random() * starts.length)]];
    for (var i = 0; i < 14; i++) {
      var dist = T.nextDistribution(model, ids, { temperature: 0.8 });
      ids.push(T.sample(dist).id);
    }
    return LU.detokenize(ids.map(function (id) { return Q.data.vocab[id]; }));
  }

  function finishRace() {
    var R = Q.race;
    var host = $("#qkv-raceresult");
    host.innerHTML = "";
    var pplFree = T.perplexity(R.free), pplFrozen = T.perplexity(R.frozen);
    var attFree = T.attentionStats(R.free), attFrozen = T.attentionStats(R.frozen);

    [["model uczony w całości", R.free, pplFree, attFree, "var(--accent)"],
     ["z zamrożonymi " + R.names.join(", "), R.frozen, pplFrozen, attFrozen, "var(--hot)"]].forEach(function (row) {
      host.appendChild(el("div", { class: "panel", style: "margin:0;background:var(--panel-2);border-color:" + row[4] }, [
        el("h4", { style: "margin:0 0 .4rem", text: row[0] }),
        el("p", { class: "mono small", style: "margin:0 0 .3rem", text:
          "strata " + num(row[1].history[row[1].history.length - 1], 3) +
          " · zakłopotanie " + (row[2] === null ? "—" : num(row[2], 2)) }),
        el("p", { class: "mono small", style: "margin:0 0 .4rem", text:
          "ostrość uwagi: najwyższa waga średnio " + (row[3] ? (row[3].meanMax * 100).toFixed(0) + "%" : "—") +
          " · rozproszenie " + (row[3] ? (row[3].meanEntropy * 100).toFixed(0) + "%" : "—") }),
        el("p", { style: "margin:0", text: sample(row[1]) })
      ]));
    });

    var worse = pplFrozen / Math.max(pplFree, 1e-9);
    var sharper = attFree && attFrozen ? attFree.meanMax / Math.max(attFrozen.meanMax, 1e-9) : 1;
    var msg;
    if (worse >= 1.25) {
      msg = "Model z zamrożonymi macierzami " + R.names.join(", ") + " kończy z zakłopotaniem " +
        num(worse, 1) + "× większym — bez uczenia tych wag nie potrafi wybrać, którego słowa z kontekstu posłuchać.";
    } else if (worse >= 1.0) {
      msg = "Na tak krótkim tekście różnica w zakłopotaniu jest niewielka (" + num(worse, 2) +
        "×): model potrafi go po prostu zapamiętać osadzeniami i siecią FFN, nawet gdy uwaga patrzy byle gdzie. " +
        "Dlatego ważniejszy jest tu drugi wiersz liczb.";
    } else {
      msg = "Uwaga, wynik przewrotny: model z zamrożonymi macierzami wypadł tu nawet odrobinę lepiej (" +
        num(1 / Math.max(worse, 1e-9), 2) + "× niższe zakłopotanie). Na kilkudziesięciu słowach da się " +
        "wygrać samym zapamiętywaniem, a zamrożone macierze to o kilkaset parametrów mniej do ustawienia, " +
        "więc reszta sieci uczy się szybciej. Przewaga wyuczonej uwagi pojawia się dopiero przy dłuższych " +
        "tekstach, gdzie to samo słowo znaczy co innego w różnych miejscach. Za to w samej uwadze różnicę widać od razu.";
    }
    msg += " Model uczony skupia średnio " +
      (attFree ? (attFree.meanMax * 100).toFixed(0) : "?") + "% wagi na jednym słowie, a zamrożony " +
      (attFrozen ? (attFrozen.meanMax * 100).toFixed(0) : "?") + "% — czyli " + num(sharper, 1) + "× mniej ostro. " +
      "Właśnie to robią wyuczone Wq i Wk: wskazują, które słowo z kontekstu jest teraz istotne. " +
      "Wv odpowiada za co innego — za treść, którą wskazane słowo przekazuje dalej. " +
      "Chcesz zobaczyć wyraźniejszą różnicę w zakłopotaniu? Weź na Starcie dłuższy tekst i zamroź wszystkie trzy macierze.";

    host.appendChild(el("p", { class: "small muted", style: "grid-column:1/-1;margin:.2rem 0 0", text: msg }));
  }

  /* ---------- wejście / wyjście ---------- */

  Q.onEnter = function () {
    rebuild(false);
    if (Q.race) drawRace();
  };
  Q.onLeave = stopRace;

  Q.init = function () {
    $("#qkv-train").addEventListener("click", function () {
      for (var i = 0; i < 200; i++) T.trainBatch(Q.model, 16, 0.03);
      Q.grads = null; Q.stats = null; Q.before = null;
      $("#qkv-loss").textContent = "";
      renderStatus(); renderChain(); renderMatrices();
      LU.toast("Model doświadczalny douczony o 200 kroków.");
    });
    $("#qkv-reset").addEventListener("click", function () { rebuild(true); LU.toast("Macierze wylosowane od nowa."); });
    $("#qkv-grad").addEventListener("click", computeGradient);
    $("#qkv-apply").addEventListener("click", applyStep);
    $("#qkv-which").addEventListener("change", function () { Q.before = null; renderMatrices(); });
    $("#qkv-race").addEventListener("click", startRace);
    window.addEventListener("resize", function () {
      if (!$("#view-qkv").hidden && Q.race) drawRace();
    });
  };

  LU.Qkv = Q;
})(window.LU);
