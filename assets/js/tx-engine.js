/* Mały transformer dekoderowy, uczony od zera w przeglądarce.
   Jedna głowica uwagi, jedna warstwa, sieć FFN, wiązane wagi wyjścia z osadzeniami.
   Propagacja wsteczna i Adam napisane ręcznie — nie ma tu żadnej biblioteki. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";

  var T = {};

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function zeros(n) { return new Float64Array(n); }

  /* Macierz out×in trzymana płasko. */
  function randMat(out, inp, scale, rand) {
    var m = new Float64Array(out * inp);
    for (var i = 0; i < m.length; i++) m[i] = (rand() * 2 - 1) * scale;
    return m;
  }

  function matVec(W, x, out, inp, dst) {
    var y = dst || new Float64Array(out);
    for (var o = 0; o < out; o++) {
      var s = 0, base = o * inp;
      for (var i = 0; i < inp; i++) s += W[base + i] * x[i];
      y[o] = s;
    }
    return y;
  }

  function matTVec(W, y, out, inp) {   // W^T · y
    var x = new Float64Array(inp);
    for (var o = 0; o < out; o++) {
      var g = y[o], base = o * inp;
      if (g === 0) continue;
      for (var i = 0; i < inp; i++) x[i] += W[base + i] * g;
    }
    return x;
  }

  function addOuter(G, a, b, inp) {    // G += a ⊗ b
    for (var o = 0; o < a.length; o++) {
      var g = a[o], base = o * inp;
      if (g === 0) continue;
      for (var i = 0; i < b.length; i++) G[base + i] += g * b[i];
    }
  }

  /* --- Dane: sekwencje uczące z tokenów --- */
  T.buildData = function (tokens, contextLength) {
    var vocab = [], index = new Map();
    tokens.forEach(function (t) {
      if (!index.has(t)) { index.set(t, vocab.length); vocab.push(t); }
    });
    var ids = tokens.map(function (t) { return index.get(t); });

    var L = contextLength || 8;
    var sequences = [];
    for (var i = 0; i + 1 < ids.length; i++) {
      sequences.push(ids.slice(Math.max(0, i - L + 1), i + 2));  // wejście + cel na końcu
    }
    return { vocab: vocab, index: index, ids: ids, sequences: sequences, contextLength: L };
  };

  /* --- Model --- */
  T.createModel = function (data, opts) {
    opts = opts || {};
    var dim = opts.dim || 16;
    var hidden = opts.hidden || 2 * dim;
    var vocabSize = data.vocab.length;
    var rand = rng(opts.seed || 4242);
    var scale = 1 / Math.sqrt(dim);

    var m = {
      data: data,
      dim: dim,
      hidden: hidden,
      vocabSize: vocabSize,
      E: randMat(vocabSize, dim, 0.5, rand),
      Wq: randMat(dim, dim, scale, rand),
      Wk: randMat(dim, dim, scale, rand),
      Wv: randMat(dim, dim, scale, rand),
      Wo: randMat(dim, dim, scale, rand),
      W1: randMat(hidden, dim, scale, rand),
      b1: zeros(hidden),
      W2: randMat(dim, hidden, 1 / Math.sqrt(hidden), rand),
      b2: zeros(dim),
      bOut: zeros(vocabSize),
      step: 0,
      seen: 0,
      history: [],
      pos: []
    };

    for (var p = 0; p < 64; p++) m.pos.push(LU.Vec.positional(p, dim));

    m.names = ["E", "Wq", "Wk", "Wv", "Wo", "W1", "b1", "W2", "b2", "bOut"];
    m.adam = {};
    m.names.forEach(function (n) {
      m.adam[n] = { m: new Float64Array(m[n].length), v: new Float64Array(m[n].length) };
    });
    m.params = m.names.reduce(function (sum, n) { return sum + m[n].length; }, 0);
    return m;
  };

  /* --- Przebieg w przód (z pamięcią pośrednich wartości do propagacji wstecznej) --- */
  T.forward = function (m, ids) {
    var dim = m.dim, hid = m.hidden, n = ids.length;
    var c = { h0: [], emb: [], pos: [], q: [], k: [], v: [], scores: [], att: [], ctx: [],
      attOut: [], z: [], pre: [], relu: [], ffn: [], u: [], probs: [], logits: [] };

    for (var t = 0; t < n; t++) {
      var h = new Float64Array(dim);
      var emb = new Float64Array(dim);
      var base = ids[t] * dim;
      var pe = m.pos[Math.min(t, m.pos.length - 1)];
      for (var d = 0; d < dim; d++) { emb[d] = m.E[base + d]; h[d] = emb[d] + pe[d]; }
      c.emb.push(emb);
      c.pos.push(pe);
      c.h0.push(h);
      c.q.push(matVec(m.Wq, h, dim, dim));
      c.k.push(matVec(m.Wk, h, dim, dim));
      c.v.push(matVec(m.Wv, h, dim, dim));
    }

    var scale = Math.sqrt(dim);
    for (var i = 0; i < n; i++) {
      var scores = new Float64Array(i + 1);
      for (var j = 0; j <= i; j++) {          // maska przyczynowa: tylko wstecz
        var s = 0;
        for (var d2 = 0; d2 < dim; d2++) s += c.q[i][d2] * c.k[j][d2];
        scores[j] = s / scale;
      }
      c.scores.push(Float64Array.from(scores));   // wartości przed softmaxem — do podglądu krok po kroku
      var max = -Infinity;
      for (var a = 0; a <= i; a++) max = Math.max(max, scores[a]);
      var sum = 0;
      for (var b = 0; b <= i; b++) { scores[b] = Math.exp(scores[b] - max); sum += scores[b]; }
      for (var e = 0; e <= i; e++) scores[e] /= sum;
      c.att.push(scores);

      var ctx = new Float64Array(dim);
      for (var j2 = 0; j2 <= i; j2++) {
        var w = scores[j2];
        for (var d3 = 0; d3 < dim; d3++) ctx[d3] += w * c.v[j2][d3];
      }
      c.ctx.push(ctx);

      var attOut = matVec(m.Wo, ctx, dim, dim);
      c.attOut.push(Float64Array.from(attOut));
      var z = Float64Array.from(attOut);
      for (var d4 = 0; d4 < dim; d4++) z[d4] += c.h0[i][d4];       // połączenie rezydualne
      c.z.push(z);

      var pre = matVec(m.W1, z, hid, dim);
      var relu = new Float64Array(hid);
      for (var q = 0; q < hid; q++) { pre[q] += m.b1[q]; relu[q] = pre[q] > 0 ? pre[q] : 0; }
      c.pre.push(pre); c.relu.push(relu);

      var f = matVec(m.W2, relu, dim, hid);
      for (var d6 = 0; d6 < dim; d6++) f[d6] += m.b2[d6];
      c.ffn.push(Float64Array.from(f));
      var u = new Float64Array(dim);
      for (var d5 = 0; d5 < dim; d5++) u[d5] = z[d5] + f[d5];
      c.u.push(u);

      var logits = matVec(m.E, u, m.vocabSize, dim);
      for (var w2 = 0; w2 < m.vocabSize; w2++) logits[w2] += m.bOut[w2];
      c.logits.push(logits);
      c.probs.push(T.softmax(logits));
    }
    return c;
  };

  T.softmax = function (logits, temperature) {
    var temp = temperature || 1;
    var max = -Infinity, i;
    for (i = 0; i < logits.length; i++) max = Math.max(max, logits[i]);
    var out = new Float64Array(logits.length), sum = 0;
    for (i = 0; i < logits.length; i++) { out[i] = Math.exp((logits[i] - max) / temp); sum += out[i]; }
    for (i = 0; i < out.length; i++) out[i] /= sum;
    return out;
  };

  /* --- Propagacja wsteczna dla jednej sekwencji; gradienty dopisywane do G --- */
  T.backward = function (m, ids, G) {
    var dim = m.dim, hid = m.hidden;
    var n = ids.length - 1;                  // ostatni token to tylko cel
    if (n < 1) return 0;
    var c = T.forward(m, ids.slice(0, n));
    var loss = 0;

    var dh0 = [], dq = [], dk = [], dv = [];
    for (var t = 0; t < n; t++) {
      dh0.push(new Float64Array(dim));
      dq.push(new Float64Array(dim));
      dk.push(new Float64Array(dim));
      dv.push(new Float64Array(dim));
    }

    for (var i = 0; i < n; i++) {
      var target = ids[i + 1];
      var probs = c.probs[i];
      loss += -Math.log(Math.max(probs[target], 1e-12));

      var dlogits = new Float64Array(m.vocabSize);
      for (var w = 0; w < m.vocabSize; w++) dlogits[w] = probs[w] / n;
      dlogits[target] -= 1 / n;

      addOuter(G.E, dlogits, c.u[i], dim);                        // wagi wiązane
      for (var w2 = 0; w2 < m.vocabSize; w2++) G.bOut[w2] += dlogits[w2];
      var du = matTVec(m.E, dlogits, m.vocabSize, dim);

      // FFN
      for (var d0 = 0; d0 < dim; d0++) G.b2[d0] += du[d0];
      addOuter(G.W2, du, c.relu[i], hid);
      var dr = matTVec(m.W2, du, dim, hid);
      var dp = new Float64Array(hid);
      for (var h = 0; h < hid; h++) dp[h] = c.pre[i][h] > 0 ? dr[h] : 0;
      for (var h2 = 0; h2 < hid; h2++) G.b1[h2] += dp[h2];
      addOuter(G.W1, dp, c.z[i], dim);
      var dz = matTVec(m.W1, dp, hid, dim);
      for (var d1 = 0; d1 < dim; d1++) dz[d1] += du[d1];           // rezydualne wokół FFN

      // uwaga
      addOuter(G.Wo, dz, c.ctx[i], dim);
      var dctx = matTVec(m.Wo, dz, dim, dim);
      for (var d2 = 0; d2 < dim; d2++) dh0[i][d2] += dz[d2];       // rezydualne wokół uwagi

      var att = c.att[i];
      var datt = new Float64Array(i + 1);
      for (var j = 0; j <= i; j++) {
        var s = 0;
        for (var d3 = 0; d3 < dim; d3++) {
          s += dctx[d3] * c.v[j][d3];
          dv[j][d3] += att[j] * dctx[d3];
        }
        datt[j] = s;
      }
      var dotSum = 0;
      for (var j2 = 0; j2 <= i; j2++) dotSum += att[j2] * datt[j2];
      var scale = Math.sqrt(dim);
      for (var j3 = 0; j3 <= i; j3++) {
        var ds = att[j3] * (datt[j3] - dotSum) / scale;
        for (var d4 = 0; d4 < dim; d4++) {
          dq[i][d4] += ds * c.k[j3][d4];
          dk[j3][d4] += ds * c.q[i][d4];
        }
      }
    }

    for (var t2 = 0; t2 < n; t2++) {
      addOuter(G.Wq, dq[t2], c.h0[t2], dim);
      addOuter(G.Wk, dk[t2], c.h0[t2], dim);
      addOuter(G.Wv, dv[t2], c.h0[t2], dim);
      var back = matTVec(m.Wq, dq[t2], dim, dim);
      var back2 = matTVec(m.Wk, dk[t2], dim, dim);
      var back3 = matTVec(m.Wv, dv[t2], dim, dim);
      for (var d = 0; d < dim; d++) dh0[t2][d] += back[d] + back2[d] + back3[d];
      var base = ids[t2] * dim;
      for (var d5 = 0; d5 < dim; d5++) G.E[base + d5] += dh0[t2][d5];
    }

    return loss / n;
  };

  T.zeroGrads = function (m) {
    var G = {};
    m.names.forEach(function (n) { G[n] = new Float64Array(m[n].length); });
    return G;
  };

  T.adam = function (m, G, lr) {
    m.step++;
    var b1 = 0.9, b2 = 0.999, eps = 1e-8;
    var c1 = 1 - Math.pow(b1, m.step), c2 = 1 - Math.pow(b2, m.step);
    m.names.forEach(function (name) {
      var p = m[name], g = G[name], st = m.adam[name];
      for (var i = 0; i < p.length; i++) {
        st.m[i] = b1 * st.m[i] + (1 - b1) * g[i];
        st.v[i] = b2 * st.v[i] + (1 - b2) * g[i] * g[i];
        p[i] -= lr * (st.m[i] / c1) / (Math.sqrt(st.v[i] / c2) + eps);
      }
    });
  };

  /* Jedna paczka: kilka sekwencji, uśredniony gradient, krok Adama. */
  T.trainBatch = function (m, batchSize, lr) {
    var seqs = m.data.sequences;
    if (!seqs.length) return 0;
    var G = T.zeroGrads(m);
    var loss = 0, used = 0;
    for (var b = 0; b < batchSize; b++) {
      var seq = seqs[(m.seen + b) % seqs.length];
      if (seq.length < 2) continue;
      loss += T.backward(m, seq, G);
      used++;
    }
    if (!used) return 0;
    m.names.forEach(function (n) {
      var g = G[n];
      for (var i = 0; i < g.length; i++) g[i] /= used;
    });
    T.adam(m, G, lr || 0.02);
    m.seen += batchSize;
    var avg = loss / used;
    m.history.push(avg);
    if (m.history.length > 400) m.history.shift();
    return avg;
  };

  /* --- Generowanie: rozkład następnego słowa z softmaxu, nie z liczników --- */
  T.nextDistribution = function (m, contextIds, opts) {
    opts = opts || {};
    var ids = contextIds.slice(-m.data.contextLength);
    var c = T.forward(m, ids);
    var last = ids.length - 1;
    var logits = c.logits[last];
    var probs = T.softmax(logits, opts.temperature || 1);

    var list = [];
    for (var i = 0; i < probs.length; i++) list.push({ id: i, word: m.data.vocab[i], p: probs[i] });
    list.sort(function (a, b) { return b.p - a.p; });

    if (opts.topK && opts.topK < list.length) {
      var kept = list.slice(0, opts.topK);
      var sum = kept.reduce(function (s, x) { return s + x.p; }, 0) || 1;
      kept.forEach(function (x) { x.p = x.p / sum; });
      list = kept;
    }
    return { list: list, cache: c, position: last, attention: c.att[last], ids: ids };
  };

  T.sample = function (dist, rand) {
    var r = (rand || Math.random)();
    var acc = 0;
    for (var i = 0; i < dist.list.length; i++) {
      acc += dist.list[i].p;
      if (r <= acc) return dist.list[i];
    }
    return dist.list[dist.list.length - 1];
  };

  /* Zakłopotanie (perplexity) na całym tekście treningowym — jedna liczba mówiąca, jak dobry jest model. */
  T.perplexity = function (m) {
    var seqs = m.data.sequences;
    if (!seqs.length) return null;
    var loss = 0, count = 0;
    for (var i = 0; i < seqs.length; i += Math.max(1, Math.floor(seqs.length / 60))) {
      var seq = seqs[i];
      if (seq.length < 2) continue;
      var c = T.forward(m, seq.slice(0, seq.length - 1));
      var last = seq.length - 2;
      loss += -Math.log(Math.max(c.probs[last][seq[seq.length - 1]], 1e-12));
      count++;
    }
    return count ? Math.exp(loss / count) : null;
  };

  /* Pomocnicze operacje udostępnione interfejsowi (symulacja krok po kroku). */
  T.matVec = function (W, x, out, inp) { return matVec(W, x, out, inp); };

  LU.Tx = T;
})(window.LU);
