/* Silnik wektorowy: osadzenia (skip-gram z próbkowaniem negatywnym), PCA, podobieństwo, uwaga.
   Wszystko liczone od zera, bez bibliotek — żeby dało się zajrzeć w każdy krok. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";

  /* Deterministyczny generator: ten sam start daje ten sam przebieg nauki. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var V = {};

  /* --- Korpus: słownik i pary (środek, kontekst) w oknie --- */
  V.buildCorpus = function (tokens, opts) {
    opts = opts || {};
    var window_ = opts.window || 2;
    var words = tokens.filter(function (t) { return !LU.isPunct(t); });

    var freq = new Map();
    words.forEach(function (w) { freq.set(w, (freq.get(w) || 0) + 1); });

    var vocab = [];
    freq.forEach(function (count, w) { if (count >= (opts.minCount || 1)) vocab.push(w); });
    vocab.sort(function (a, b) { return freq.get(b) - freq.get(a) || a.localeCompare(b, "pl"); });

    var index = new Map();
    vocab.forEach(function (w, i) { index.set(w, i); });

    var pairs = [];
    for (var i = 0; i < words.length; i++) {
      if (!index.has(words[i])) continue;
      for (var d = -window_; d <= window_; d++) {
        var j = i + d;
        if (d === 0 || j < 0 || j >= words.length) continue;
        if (!index.has(words[j])) continue;
        pairs.push([index.get(words[i]), index.get(words[j])]);
      }
    }

    /* Rozkład do losowania negatywów: częstość^0.75, jak w word2vec. */
    var weights = vocab.map(function (w) { return Math.pow(freq.get(w), 0.75); });
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var cumulative = [];
    var acc = 0;
    weights.forEach(function (w) { acc += w / total; cumulative.push(acc); });

    return {
      vocab: vocab, index: index, freq: freq, pairs: pairs,
      cumulative: cumulative, window: window_, words: words
    };
  };

  /* --- Trener skip-gram --- */
  V.createTrainer = function (corpus, opts) {
    opts = opts || {};
    var dim = opts.dim || 2;
    var rand = mulberry32(opts.seed || 12345);
    var vocabSize = corpus.vocab.length;

    function init() {
      var m = [];
      for (var i = 0; i < vocabSize; i++) {
        var row = new Float64Array(dim);
        for (var d = 0; d < dim; d++) row[d] = (rand() - 0.5) / dim;
        m.push(row);
      }
      return m;
    }

    var T = {
      corpus: corpus,
      dim: dim,
      W: init(),            // wektory słów (te oglądamy)
      C: init(),            // wektory kontekstu (pomocnicze)
      lr0: opts.lr || 0.08,
      negatives: opts.negatives || 5,
      seen: 0,              // ile par już przerobiliśmy
      epoch: 0,
      lossSum: 0,
      lossCount: 0,
      history: [],
      order: null,
      cursor: 0
    };

    function shuffle() {
      var idx = [];
      for (var i = 0; i < corpus.pairs.length; i++) idx.push(i);
      for (var j = idx.length - 1; j > 0; j--) {
        var k = Math.floor(rand() * (j + 1));
        var tmp = idx[j]; idx[j] = idx[k]; idx[k] = tmp;
      }
      T.order = idx;
      T.cursor = 0;
    }
    shuffle();

    function sampleNegative() {
      var r = rand();
      var lo = 0, hi = corpus.cumulative.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (corpus.cumulative[mid] < r) lo = mid + 1; else hi = mid;
      }
      return lo;
    }

    function sigmoid(x) {
      if (x > 12) return 1;
      if (x < -12) return 0;
      return 1 / (1 + Math.exp(-x));
    }

    function updatePair(centerId, contextId, label, lr) {
      var w = T.W[centerId], c = T.C[contextId];
      var dot = 0;
      for (var d = 0; d < dim; d++) dot += w[d] * c[d];
      var pred = sigmoid(dot);
      var g = (label - pred) * lr;
      for (var e = 0; e < dim; e++) {
        var wd = w[e];
        w[e] += g * c[e];
        c[e] += g * wd;
      }
      // strata logistyczna dla tej pary
      var p = label === 1 ? pred : 1 - pred;
      return -Math.log(Math.max(p, 1e-9));
    }

    /* Jeden krok = jedna para (środek, kontekst) plus kilka negatywów. */
    T.step = function (count) {
      var epochs = Math.max(1, opts.epochs || 40);
      for (var n = 0; n < count; n++) {
        if (T.cursor >= T.order.length) { T.epoch++; shuffle(); }
        var progress = Math.min(1, (T.epoch + T.cursor / T.order.length) / epochs);
        var lr = Math.max(T.lr0 * 0.05, T.lr0 * (1 - progress));
        var pair = corpus.pairs[T.order[T.cursor++]];
        var loss = updatePair(pair[0], pair[1], 1, lr);
        for (var k = 0; k < T.negatives; k++) {
          var neg = sampleNegative();
          if (neg === pair[1]) continue;
          loss += updatePair(pair[0], neg, 0, lr);
        }
        T.seen++;
        T.lossSum += loss;
        T.lossCount++;
      }
      if (T.lossCount > 0) {
        T.history.push(T.lossSum / T.lossCount);
        if (T.history.length > 400) T.history.shift();
        T.lossSum = 0; T.lossCount = 0;
      }
      return T;
    };

    T.progress = function () {
      var epochs = Math.max(1, opts.epochs || 40);
      return Math.min(1, T.seen / (corpus.pairs.length * epochs));
    };

    T.vectorOf = function (word) {
      var i = corpus.index.get(word);
      return i === undefined ? null : T.W[i];
    };

    return T;
  };

  /* --- Podobieństwo --- */
  V.dot = function (a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  };
  V.norm = function (a) { return Math.sqrt(V.dot(a, a)); };
  V.cosine = function (a, b) {
    var n = V.norm(a) * V.norm(b);
    return n === 0 ? 0 : V.dot(a, b) / n;
  };

  V.nearest = function (trainer, word, k) {
    var vec = trainer.vectorOf(word);
    if (!vec) return [];
    return V.nearestToVector(trainer, vec, k, [word]);
  };

  V.nearestToVector = function (trainer, vec, k, exclude) {
    exclude = exclude || [];
    var out = [];
    trainer.corpus.vocab.forEach(function (w, i) {
      if (exclude.indexOf(w) >= 0) return;
      out.push({ word: w, score: V.cosine(vec, trainer.W[i]) });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, k || 8);
  };

  /* Analogia: a jest do b jak c jest do ? (wektor b - a + c) */
  V.analogy = function (trainer, a, b, c, k) {
    var va = trainer.vectorOf(a), vb = trainer.vectorOf(b), vc = trainer.vectorOf(c);
    if (!va || !vb || !vc) return [];
    var target = new Float64Array(trainer.dim);
    for (var d = 0; d < trainer.dim; d++) target[d] = vb[d] - va[d] + vc[d];
    return V.nearestToVector(trainer, target, k || 5, [a, b, c]);
  };

  /* --- PCA do dwóch wymiarów (metoda potęgowa z deflacją) --- */
  V.pca2 = function (vectors) {
    var n = vectors.length;
    if (!n) return { points: [], axes: null };
    var dim = vectors[0].length;
    if (dim === 2) {
      return { points: vectors.map(function (v) { return [v[0], v[1]]; }), axes: null };
    }

    var mean = new Float64Array(dim);
    vectors.forEach(function (v) { for (var d = 0; d < dim; d++) mean[d] += v[d] / n; });
    var centered = vectors.map(function (v) {
      var out = new Float64Array(dim);
      for (var d = 0; d < dim; d++) out[d] = v[d] - mean[d];
      return out;
    });

    function powerIteration(rows) {
      var vec = new Float64Array(dim);
      for (var d = 0; d < dim; d++) vec[d] = Math.sin(d + 1);
      for (var it = 0; it < 60; it++) {
        var next = new Float64Array(dim);
        rows.forEach(function (r) {
          var s = V.dot(r, vec);
          for (var e = 0; e < dim; e++) next[e] += s * r[e];
        });
        var len = V.norm(next);
        if (len < 1e-12) break;
        for (var f = 0; f < dim; f++) vec[f] = next[f] / len;
      }
      return vec;
    }

    var a1 = powerIteration(centered);
    var deflated = centered.map(function (r) {
      var s = V.dot(r, a1);
      var out = new Float64Array(dim);
      for (var d = 0; d < dim; d++) out[d] = r[d] - s * a1[d];
      return out;
    });
    var a2 = powerIteration(deflated);

    return {
      points: centered.map(function (r) { return [V.dot(r, a1), V.dot(r, a2)]; }),
      axes: [a1, a2]
    };
  };

  /* Osie PCA lubią się odwracać między klatkami — trzymamy je zgodne z poprzednimi. */
  V.alignAxes = function (axes, previous) {
    if (!axes || !previous) return axes;
    for (var i = 0; i < axes.length; i++) {
      if (previous[i] && V.dot(axes[i], previous[i]) < 0) {
        for (var d = 0; d < axes[i].length; d++) axes[i][d] = -axes[i][d];
      }
    }
    return axes;
  };

  /* --- Kodowanie pozycji (sinus/cosinus, jak w transformerze) --- */
  V.positional = function (pos, dim) {
    var out = new Float64Array(dim);
    for (var i = 0; i < dim; i++) {
      var k = Math.floor(i / 2);
      var freq = 1 / Math.pow(10000, (2 * k) / dim);
      out[i] = (i % 2 === 0) ? Math.sin(pos * freq) : Math.cos(pos * freq);
    }
    return out;
  };

  /* --- Uproszczona uwaga jednogłowicowa: Q = K = V = wektory słów --- */
  V.attention = function (vectors, opts) {
    opts = opts || {};
    var n = vectors.length;
    if (!n) return { scores: [], weights: [], outputs: [] };
    var dim = vectors[0].length;
    var scale = opts.scale || Math.sqrt(dim);

    var input = vectors.map(function (v, i) {
      var out = new Float64Array(dim);
      for (var d = 0; d < dim; d++) out[d] = v[d];
      if (opts.positional) {
        var pe = V.positional(i, dim);
        var strength = opts.positionalStrength || 0.5;
        for (var e = 0; e < dim; e++) out[e] += strength * pe[e];
      }
      return out;
    });

    var scores = [], weights = [], outputs = [];
    for (var i2 = 0; i2 < n; i2++) {
      var row = [];
      for (var j = 0; j < n; j++) {
        row.push(opts.causal && j > i2 ? -Infinity : V.dot(input[i2], input[j]) / scale);
      }
      scores.push(row);

      var max = Math.max.apply(null, row.filter(function (x) { return isFinite(x); }));
      var exps = row.map(function (x) { return isFinite(x) ? Math.exp(x - max) : 0; });
      var sum = exps.reduce(function (a, b) { return a + b; }, 0) || 1;
      var w = exps.map(function (x) { return x / sum; });
      weights.push(w);

      var mixed = new Float64Array(dim);
      for (var j2 = 0; j2 < n; j2++) {
        for (var d2 = 0; d2 < dim; d2++) mixed[d2] += w[j2] * input[j2][d2];
      }
      outputs.push(mixed);
    }
    return { scores: scores, weights: weights, outputs: outputs, input: input };
  };

  LU.Vec = V;
})(window.LU);
