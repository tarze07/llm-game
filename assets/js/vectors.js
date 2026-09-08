/* Zakładka Wektory: kodowanie słów, nauka osadzeń na żywo, porównywanie i uwaga. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";
  var $ = LU.$, el = LU.el, V = LU.Vec;

  var X = {
    corpus: null,
    trainer: null,
    raf: null,
    running: false,
    axes: null,
    selected: null,
    stamp: null
  };

  function css(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
  }

  /* ---------- budowa modelu wektorowego ---------- */

  function rebuild(force) {
    var dim = parseInt($("#vec-dim").value, 10);
    var win = parseInt($("#vec-window").value, 10);
    var stamp = LU.state.rawText + "|" + dim + "|" + win;
    if (!force && X.stamp === stamp && X.trainer) return;

    stop();
    X.stamp = stamp;
    X.corpus = V.buildCorpus(LU.state.tokens, { window: win });
    /* Tyle przebiegów, żeby na krótkim tekście też uzbierało się kilkadziesiąt tysięcy poprawek. */
    X.epochs = Math.max(30, Math.min(200, Math.round(30000 / Math.max(1, X.corpus.pairs.length))));
    X.trainer = V.createTrainer(X.corpus, { dim: dim, epochs: X.epochs, seed: 20260908 });
    X.axes = null;
    if (!X.selected || !X.corpus.index.has(X.selected)) X.selected = X.corpus.vocab[0];

    fillWordSelects();
    renderAll();
  }

  function fillWordSelects() {
    var vocab = X.corpus.vocab;
    [["#vec-word", X.selected], ["#an-a", vocab[0]], ["#an-b", vocab[1] || vocab[0]], ["#an-c", vocab[2] || vocab[0]]]
      .forEach(function (pair) {
        var sel = $(pair[0]);
        var previous = sel.value;
        sel.innerHTML = "";
        vocab.forEach(function (w) {
          sel.appendChild(el("option", { value: w, text: w + " (" + X.corpus.freq.get(w) + "×)" }));
        });
        sel.value = (previous && X.corpus.index.has(previous)) ? previous : pair[1];
      });

    var sents = sentences();
    var ss = $("#att-sentence");
    var prevIdx = ss.value;
    ss.innerHTML = "";
    sents.forEach(function (s, i) {
      ss.appendChild(el("option", { value: String(i), text: s.join(" ") }));
    });
    ss.value = (prevIdx && sents[prevIdx]) ? prevIdx : "0";
  }

  /* Zdania tekstu, przycięte do słów obecnych w słowniku wektorów. */
  function sentences() {
    var out = [], current = [];
    LU.state.tokens.forEach(function (t) {
      if (t === "." || t === "!" || t === "?") {
        if (current.length > 1) out.push(current);
        current = [];
        return;
      }
      if (!LU.isPunct(t) && X.corpus.index.has(t)) current.push(t);
    });
    if (current.length > 1) out.push(current);
    return out.length ? out.map(function (s) { return s.slice(0, 9); }) : [X.corpus.vocab.slice(0, 5)];
  }

  /* ---------- 1. kodowanie ---------- */

  function renderEncoding() {
    var host = $("#vec-encoding");
    host.innerHTML = "";
    var word = $("#vec-word").value;
    var id = X.corpus.index.get(word);
    if (id === undefined) return;
    var vec = X.trainer.W[id];

    host.appendChild(el("div", { class: "pipeline" }, [
      el("div", { class: "pipe-step" }, [
        el("span", { class: "tag", text: "1. token" }),
        el("b", { class: "mono", text: word })
      ]),
      el("div", { class: "pipe-arrow", text: "→" }),
      el("div", { class: "pipe-step" }, [
        el("span", { class: "tag", text: "2. numer w słowniku" }),
        el("b", { class: "mono", text: "#" + id + " z " + X.corpus.vocab.length })
      ]),
      el("div", { class: "pipe-arrow", text: "→" }),
      el("div", { class: "pipe-step" }, [
        el("span", { class: "tag", text: "3. wektor (" + X.trainer.dim + " liczb)" }),
        vectorStrip(vec)
      ])
    ]));

    var values = Array.prototype.slice.call(vec).map(function (v) { return v.toFixed(3); });
    host.appendChild(el("p", { class: "small mono", style: "margin:.6rem 0 0; word-break:break-all" },
      ["[" + values.join(", ") + "]  ·  długość wektora: " + V.norm(vec).toFixed(3)]));
  }

  function vectorStrip(vec) {
    var max = 0;
    for (var i = 0; i < vec.length; i++) max = Math.max(max, Math.abs(vec[i]));
    max = max || 1;
    var strip = el("div", { class: "vecstrip" });
    for (var d = 0; d < vec.length; d++) {
      var v = vec[d] / max;
      strip.appendChild(el("span", {
        class: "cell",
        title: "wymiar " + d + ": " + vec[d].toFixed(4),
        style: "background:" + heatColor(v)
      }));
    }
    return strip;
  }

  /* Krótki zapis kosinusa: 1, .72, -.31, 0 */
  function shortScore(v) {
    if (v >= 0.995) return "1";
    if (Math.abs(v) < 0.05) return "0";
    return (v < 0 ? "-" : "") + Math.abs(v).toFixed(2).slice(1);
  }

  function heatColor(v) {
    // v w [-1, 1]: błękit dla dodatnich, rdzawy dla ujemnych
    var a = Math.min(1, Math.abs(v));
    return v >= 0
      ? "color-mix(in srgb, var(--accent) " + Math.round(a * 85) + "%, transparent)"
      : "color-mix(in srgb, var(--hot) " + Math.round(a * 85) + "%, transparent)";
  }

  /* ---------- 2. nauka ---------- */

  function fitCanvas(canvas, height) {
    var ratio = window.devicePixelRatio || 1;
    var width = canvas.parentElement.clientWidth || 520;
    canvas.style.width = "100%";
    canvas.style.height = height + "px";
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx: ctx, w: width, h: height };
  }

  function drawMap() {
    var canvas = $("#vec-canvas");
    var c = fitCanvas(canvas, 380);
    var ctx = c.ctx;
    ctx.clearRect(0, 0, c.w, c.h);

    var pca = V.pca2(X.trainer.W);
    if (pca.axes) { V.alignAxes(pca.axes, X.axes); X.axes = pca.axes.map(function (a) { return a.slice(); }); }
    var points = pca.axes
      ? X.trainer.W.map(function (v) { return [V.dot(v, pca.axes[0]), V.dot(v, pca.axes[1])]; })
      : pca.points;

    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(function (p) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    });
    var pad = 34;
    var spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1;
    function sx(x) { return pad + (x - minX) / spanX * (c.w - 2 * pad); }
    function sy(y) { return c.h - pad - (y - minY) / spanY * (c.h - 2 * pad); }

    var line = css("--line"), ink = css("--ink"), accent = css("--accent"), amber = css("--amber");

    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.strokeRect(.5, .5, c.w - 1, c.h - 1);

    var selectedId = X.corpus.index.get(X.selected);
    var near = {};
    if (selectedId !== undefined) {
      V.nearest(X.trainer, X.selected, 5).forEach(function (r) { near[r.word] = r.score; });
    }

    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "center";

    /* Etykiety układamy tak, żeby jak najmniej na siebie nachodziły. */
    var placed = [];
    function free(box) {
      return placed.every(function (b) {
        return box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2;
      });
    }

    X.corpus.vocab.forEach(function (word, i) {
      var x = sx(points[i][0]), y = sy(points[i][1]);
      var isSel = word === X.selected;
      var isNear = near[word] !== undefined;
      ctx.beginPath();
      ctx.arc(x, y, isSel ? 6 : (isNear ? 4.5 : 3), 0, Math.PI * 2);
      ctx.fillStyle = isSel ? amber : (isNear ? accent : line);
      ctx.fill();

      var w = ctx.measureText(word).width;
      var offsets = [-9, 13, -21, 25, -33];
      var chosen = null;
      for (var o = 0; o < offsets.length; o++) {
        var ly = y + offsets[o];
        var box = { x1: x - w / 2 - 2, x2: x + w / 2 + 2, y1: ly - 9, y2: ly + 2 };
        if (free(box)) { chosen = { y: ly, box: box }; break; }
      }
      if (!chosen && !(isSel || isNear)) return;   // tłok — pomijamy mniej ważną etykietę
      if (!chosen) chosen = { y: y - 9, box: { x1: x - w / 2, x2: x + w / 2, y1: y - 18, y2: y - 7 } };
      placed.push(chosen.box);

      ctx.fillStyle = isSel || isNear ? ink : css("--ink-soft");
      ctx.globalAlpha = isSel || isNear ? 1 : .75;
      ctx.fillText(word, x, chosen.y);
      ctx.globalAlpha = 1;
    });

    $("#vec-canvas-note").textContent = X.trainer.dim === 2
      ? "Wektory są dwuwymiarowe, więc widzisz je bez żadnych sztuczek. Wybrane słowo świeci na żółto, pięciu najbliższych sąsiadów na granatowo."
      : "Wektory mają " + X.trainer.dim + " wymiarów — na ekran rzutujemy je przez PCA (dwa kierunki, wzdłuż których słowa najbardziej się różnią). Wybrane słowo świeci na żółto, pięciu najbliższych sąsiadów na granatowo.";
  }

  function drawLoss() {
    var canvas = $("#vec-loss");
    var c = fitCanvas(canvas, 110);
    var ctx = c.ctx;
    ctx.clearRect(0, 0, c.w, c.h);
    var h = X.trainer.history;
    ctx.strokeStyle = css("--line");
    ctx.strokeRect(.5, .5, c.w - 1, c.h - 1);
    if (h.length < 2) return;

    var max = Math.max.apply(null, h), min = Math.min.apply(null, h);
    var span = (max - min) || 1;
    ctx.beginPath();
    h.forEach(function (v, i) {
      var x = 4 + i / (h.length - 1) * (c.w - 8);
      var y = c.h - 6 - (v - min) / span * (c.h - 16);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = css("--accent");
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = css("--ink-soft");
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(max.toFixed(2), 6, 12);
    ctx.fillText(min.toFixed(2), 6, c.h - 6);
  }

  function renderStats() {
    var host = $("#vec-stats");
    host.innerHTML = "";
    var loss = X.trainer.history.length ? X.trainer.history[X.trainer.history.length - 1] : null;
    function stat(v, label) {
      return el("div", { class: "stat" }, [el("b", { text: String(v) }), el("span", { text: label })]);
    }
    host.appendChild(stat(X.corpus.vocab.length, "słów w słowniku"));
    host.appendChild(stat(X.corpus.pairs.length, "par (słowo, sąsiad)"));
    host.appendChild(stat(X.trainer.seen.toLocaleString("pl-PL"), "poprawek wektorów"));
    host.appendChild(stat(loss === null ? "—" : loss.toFixed(2), "aktualna strata"));
    host.appendChild(stat(Math.round(X.trainer.progress() * 100) + "%", "postęp nauki"));
  }

  function frame() {
    var speed = parseInt($("#vec-speed").value, 10) || 300;
    X.trainer.step(speed);
    drawMap(); drawLoss(); renderStats();
    if (X.trainer.progress() >= 1) { stop(); LU.toast("Nauka skończona — teraz porównaj wektory."); renderComparisons(); return; }
    X.raf = requestAnimationFrame(frame);
  }

  function play() {
    if (X.running) { stop(); return; }
    X.running = true;
    $("#vec-play").textContent = "⏸ Pauza";
    X.raf = requestAnimationFrame(frame);
  }

  function stop() {
    X.running = false;
    if (X.raf) cancelAnimationFrame(X.raf);
    X.raf = null;
    var btn = $("#vec-play");
    if (btn) btn.textContent = "▶ Ucz";
    if (X.trainer) renderComparisons();
  }

  function trainToEnd() {
    stop();
    var target = X.corpus.pairs.length * X.epochs;
    var guard = 0;
    while (X.trainer.seen < target && guard++ < 4000) X.trainer.step(2000);
    renderAll();
    LU.toast("Wektory douczone.");
  }

  /* ---------- 3. porównywanie ---------- */

  function renderNeighbours() {
    var host = $("#vec-neighbours");
    host.innerHTML = "";
    var word = $("#vec-word").value;
    var list = V.nearest(X.trainer, word, 8);
    if (!list.length) { host.appendChild(el("p", { class: "small muted", text: "Brak danych." })); return; }
    host.appendChild(el("p", { class: "small muted", style: "margin:0 0 .5rem" },
      ["Najbliżej wektora „", el("b", { text: word }), "”:"]));
    var bars = el("div", { class: "bars" });
    list.forEach(function (r) {
      bars.appendChild(el("div", { class: "barrow" }, [
        el("span", { class: "lbl", text: r.word }),
        el("div", { class: "bartrack" }, [
          el("div", {
            class: "bar",
            style: "width:" + Math.max(2, Math.round(Math.abs(r.score) * 100)) + "%" +
              (r.score < 0 ? ";background:var(--hot)" : "")
          })
        ]),
        el("span", { class: "val", text: r.score.toFixed(2) })
      ]));
    });
    host.appendChild(bars);
  }

  function renderAnalogy() {
    var host = $("#vec-analogy");
    host.innerHTML = "";
    var a = $("#an-a").value, b = $("#an-b").value, c = $("#an-c").value;
    $("#an-a-label").textContent = a;
    $("#an-b-label").textContent = b;
    $("#an-c-label").textContent = c;
    var res = V.analogy(X.trainer, a, b, c, 4);
    if (!res.length) { host.appendChild(el("p", { class: "small muted", text: "Brak wyniku." })); return; }
    var bars = el("div", { class: "bars" });
    res.forEach(function (r) {
      bars.appendChild(el("div", { class: "barrow" }, [
        el("span", { class: "lbl", text: r.word }),
        el("div", { class: "bartrack" }, [
          el("div", { class: "bar", style: "width:" + Math.max(2, Math.round(Math.abs(r.score) * 100)) + "%" })
        ]),
        el("span", { class: "val", text: r.score.toFixed(2) })
      ]));
    });
    host.appendChild(bars);
    host.appendChild(el("p", { class: "small muted", style: "margin:.5rem 0 0" }, [
      "Na kilkudziesięciu słowach analogie wychodzą raz lepiej, raz gorzej — i to też jest lekcja: " +
      "jakość wektorów zależy przede wszystkim od ilości tekstu."
    ]));
  }

  function renderHeat() {
    var host = $("#vec-heat");
    host.innerHTML = "";
    var words = X.corpus.vocab.slice(0, 12);
    if (words.length < 2) return;
    var table = el("table", { class: "heat" });
    var head = el("tr", {}, [el("th", { text: "" })]);
    words.forEach(function (w) { head.appendChild(el("th", {}, [el("span", { text: w })])); });
    table.appendChild(head);
    words.forEach(function (rowWord) {
      var tr = el("tr", {}, [el("th", { text: rowWord })]);
      var vi = X.trainer.vectorOf(rowWord);
      words.forEach(function (colWord) {
        var score = rowWord === colWord ? 1 : V.cosine(vi, X.trainer.vectorOf(colWord));
        tr.appendChild(el("td", {
          style: "background:" + heatColor(score),
          title: rowWord + " ↔ " + colWord + " = " + score.toFixed(2),
          text: shortScore(score)
        }));
      });
      table.appendChild(tr);
    });
    host.appendChild(table);
  }

  /* ---------- 4. uwaga ---------- */

  function renderAttention() {
    var host = $("#att-matrix");
    var detail = $("#att-detail");
    host.innerHTML = ""; detail.innerHTML = "";

    var sents = sentences();
    var sentence = sents[parseInt($("#att-sentence").value, 10)] || sents[0];
    if (!sentence || sentence.length < 2) return;

    var vectors = sentence.map(function (w) { return X.trainer.vectorOf(w); });
    var att = V.attention(vectors, {
      causal: $("#att-causal").value === "yes",
      positional: $("#att-pos").value === "yes"
    });

    var table = el("table", { class: "heat att" });
    var head = el("tr", {}, [el("th", { class: "corner", text: "patrzy ↓ / na →" })]);
    sentence.forEach(function (w) { head.appendChild(el("th", {}, [el("span", { text: w })])); });
    table.appendChild(head);

    sentence.forEach(function (rowWord, i) {
      var tr = el("tr", {}, [el("th", { text: rowWord })]);
      att.weights[i].forEach(function (w, j) {
        tr.appendChild(el("td", {
          style: "background:" + heatColor(w),
          title: "„" + rowWord + "” daje słowu „" + sentence[j] + "” wagę " + (w * 100).toFixed(0) + "%",
          text: w < 0.005 ? "" : (w * 100).toFixed(0)
        }));
      });
      table.appendChild(tr);
    });
    host.appendChild(el("div", { class: "heatwrap" }, [table]));
    host.appendChild(el("p", { class: "small muted", style: "margin:.6rem 0 0" }, [
      "Liczby to procenty: ile uwagi słowo z wiersza poświęca słowu z kolumny. Każdy wiersz sumuje się do 100%. " +
      ($("#att-causal").value === "yes"
        ? "Maska przyczynowa zeruje wszystko po prawej stronie przekątnej — model piszący tekst nie może zerknąć w przyszłość."
        : "Bez maski każde słowo widzi całe zdanie, także to, co po nim.")
    ]));

    // szczegół ostatniego słowa: co z tego wymieszania wychodzi
    var last = sentence.length - 1;
    var mixed = att.outputs[last];
    var nearest = V.nearestToVector(X.trainer, mixed, 4, []);
    var contributions = att.weights[last]
      .map(function (w, j) { return { word: sentence[j], w: w }; })
      .sort(function (a, b) { return b.w - a.w; })
      .slice(0, 4);

    detail.appendChild(el("div", { class: "panel", style: "margin:0;background:var(--panel-2)" }, [
      el("h4", { text: "Co „widzi” ostatnie słowo („" + sentence[last] + "”)" }),
      el("p", { class: "small muted", style: "margin:0 0 .5rem", text:
        "Najwięcej uwagi daje: " + contributions.map(function (c) {
          return c.word + " (" + (c.w * 100).toFixed(0) + "%)";
        }).join(", ") + "." }),
      el("p", { class: "small muted", style: "margin:0 0 .4rem", text:
        "Po zmieszaniu wektorów w tych proporcjach powstaje nowy wektor — kontekstowa reprezentacja tego słowa. " +
        "Najbliżej niej leżą teraz:" }),
      el("p", { class: "mono small", style: "margin:0 0 .5rem", text:
        nearest.map(function (r) { return r.word + " " + r.score.toFixed(2); }).join("   ") }),
      vectorStrip(mixed),
      el("p", { class: "small muted", style: "margin:.5rem 0 0", text:
        "W prawdziwym transformerze taki wektor idzie jeszcze przez wyuczone macierze i warstwy — " +
        "i dopiero na końcu zamienia się w rozkład prawdopodobieństwa następnego słowa, czyli w to samo, " +
        "co w zakładce Generowanie daje ci wiersz siatki." })
    ]));
  }

  /* ---------- render zbiorczy ---------- */

  function renderComparisons() {
    if (!X.trainer) return;
    renderNeighbours();
    renderAnalogy();
    renderHeat();
    renderAttention();
  }

  function renderAll() {
    renderEncoding();
    drawMap();
    drawLoss();
    renderStats();
    renderComparisons();
  }

  X.onEnter = function () {
    rebuild(false);
    if (X.trainer) { drawMap(); drawLoss(); }
  };

  X.onLeave = stop;

  X.init = function () {
    ["#vec-dim", "#vec-window"].forEach(function (sel) {
      $(sel).addEventListener("change", function () { rebuild(true); });
    });
    $("#vec-word").addEventListener("change", function () {
      X.selected = $("#vec-word").value;
      renderEncoding(); drawMap(); renderNeighbours();
    });
    $("#vec-play").addEventListener("click", play);
    $("#vec-fast").addEventListener("click", trainToEnd);
    $("#vec-reset").addEventListener("click", function () { rebuild(true); LU.toast("Wektory wylosowane od nowa."); });
    $("#an-go").addEventListener("click", renderAnalogy);
    ["#an-a", "#an-b", "#an-c"].forEach(function (sel) {
      $(sel).addEventListener("change", renderAnalogy);
    });
    ["#att-sentence", "#att-causal", "#att-pos"].forEach(function (sel) {
      $(sel).addEventListener("change", renderAttention);
    });
    window.addEventListener("resize", function () {
      if ($("#view-vec").hidden) return;
      drawMap(); drawLoss();
    });
  };

  LU.Vectors = X;
})(window.LU);
