/* Silnik modelu n-gramowego: tokenizacja, trening, temperatura, strategie, kostka. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";

  var PUNCT = ".,!?;:";
  var TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*|[.,!?;:]/gu;

  /* Preprocessing zgodny z modulem "Training":
     male litery, slowa i pojedyncze znaki interpunkcyjne jako osobne tokeny,
     cudzyslowy/nawiasy i biale znaki pomijane. */
  LU.tokenize = function (text) {
    if (!text) return [];
    return text.toLowerCase().match(TOKEN_RE) || [];
  };

  LU.isPunct = function (tok) {
    return tok.length === 1 && PUNCT.indexOf(tok) !== -1;
  };

  /* Model: mapa kontekst -> mapa (nastepne slowo -> licznik).
     order 2 = bigram (kontekst to jedno slowo), order 3 = trigram (dwa slowa). */
  LU.createModel = function (order) {
    return {
      order: order || 2,
      contexts: new Map(),
      ctxWords: new Map(),
      vocab: [],
      vocabSet: new Set(),
      pairs: 0
    };
  };

  LU.ctxKey = function (arr) {
    return arr.join("|");
  };

  LU.addWord = function (model, word) {
    if (!model.vocabSet.has(word)) {
      model.vocabSet.add(word);
      model.vocab.push(word);
      return true;
    }
    return false;
  };

  LU.addCount = function (model, contextArr, next) {
    contextArr.forEach(function (w) { LU.addWord(model, w); });
    LU.addWord(model, next);
    var key = LU.ctxKey(contextArr);
    var row = model.contexts.get(key);
    if (!row) { row = new Map(); model.contexts.set(key, row); model.ctxWords.set(key, contextArr.slice()); }
    row.set(next, (row.get(next) || 0) + 1);
    model.pairs += 1;
    return row.get(next);
  };

  LU.getCount = function (model, contextArr, next) {
    var row = model.contexts.get(LU.ctxKey(contextArr));
    if (!row) return 0;
    return row.get(next) || 0;
  };

  /* Zmniejsza licznik o 1 (podloga 0) - regula aktualizacji z modulu RLHF.
     Wpis, ktory spadnie do zera, znika z modelu calkowicie. */
  LU.subCount = function (model, contextArr, next) {
    var key = LU.ctxKey(contextArr);
    var row = model.contexts.get(key);
    if (!row || !row.has(next)) return 0;
    var value = row.get(next) - 1;
    model.pairs -= 1;
    if (value <= 0) {
      row.delete(next);
      if (!row.size) { model.contexts.delete(key); model.ctxWords.delete(key); }
      return 0;
    }
    row.set(next, value);
    return value;
  };

  /* Gleboka kopia modelu - potrzebna, gdy chcemy porownac model bazowy ze zmienionym. */
  LU.cloneModel = function (model) {
    var copy = LU.createModel(model.order);
    model.contexts.forEach(function (row, key) {
      var newRow = new Map();
      row.forEach(function (count, token) { newRow.set(token, count); });
      copy.contexts.set(key, newRow);
      copy.ctxWords.set(key, model.ctxWords.get(key).slice());
    });
    copy.vocab = model.vocab.slice();
    copy.vocabSet = new Set(model.vocabSet);
    copy.pairs = model.pairs;
    return copy;
  };

  /* Liczba roznych slow (bez interpunkcji) - miara zubozenia w module Synthetic Data. */
  LU.distinctWords = function (tokens) {
    var set = new Set();
    tokens.forEach(function (t) { if (!LU.isPunct(t)) set.add(t); });
    return set.size;
  };

  /* Trenuje model na liscie tokenow (przesuwane okno). */
  LU.train = function (tokens, order) {
    var model = LU.createModel(order);
    var n = (order || 2) - 1;
    for (var i = 0; i + n < tokens.length; i++) {
      LU.addCount(model, tokens.slice(i, i + n), tokens[i + n]);
    }
    return model;
  };

  /* Lista kandydatow dla kontekstu: [{token, count}], malejaco. */
  LU.candidates = function (model, contextArr) {
    var row = model.contexts.get(LU.ctxKey(contextArr));
    if (!row) return [];
    var out = [];
    row.forEach(function (count, token) { out.push({ token: token, count: count }); });
    out.sort(function (a, b) { return b.count - a.count || a.token.localeCompare(b.token, "pl"); });
    return out;
  };

  /* --- Sylaby (przyblizenie dla polskiego: grupy samoglosek) --- */
  var VOWELS = "aąeęioóuy";
  LU.syllables = function (word) {
    if (LU.isPunct(word)) return 0;
    var count = 0, prevVowel = false;
    for (var i = 0; i < word.length; i++) {
      var isV = VOWELS.indexOf(word[i]) !== -1;
      if (isV && word[i] === "i" && i + 1 < word.length && VOWELS.indexOf(word[i + 1]) !== -1) {
        prevVowel = false;
        continue;
      }
      if (isV && !prevVowel) count++;
      prevVowel = isV;
    }
    return Math.max(count, 1);
  };

  LU.firstLetter = function (w) { return w[0]; };
  LU.lastLetter = function (w) { return w[w.length - 1]; };

  /* --- Strategie obcinania (truncation) z modulu "Sampling" ---
     Zwraca podzbior kandydatow; jesli nic nie pasuje, zwraca calosc (fallback). */
  LU.STRATEGIES = {
    none: { label: "brak (czysty rozkład)", desc: "Wszystkie opcje z modelu, bez ograniczeń." },
    greedy: { label: "zachłanna", desc: "Bierzemy opcję z największym licznikiem (przy remisie losujemy spośród najlepszych)." },
    topk: { label: "top-k", desc: "Zostawiamy tylko k najczęstszych opcji i losujemy tylko wśród nich." },
    norepeat: { label: "bez powtórzeń", desc: "Odrzucamy słowa już użyte w bieżącym zdaniu." },
    nonseq: { label: "non sequitur", desc: "Bierzemy opcje o najmniejszym niezerowym liczniku — im dziwniej, tym lepiej." },
    allit: { label: "aliteracja", desc: "Preferujemy słowa zaczynające się tą samą literą co słowo poprzednie." },
    chain: { label: "łańcuch alfabetyczny", desc: "Następne słowo musi zaczynać się ostatnią literą poprzedniego." },
    short: { label: "tylko krótkie", desc: "Dopuszczamy tylko słowa o długości ≤ próg." },
    long: { label: "tylko długie", desc: "Dopuszczamy tylko słowa dłuższe niż próg." },
    haiku: { label: "haiku (5-7-5)", desc: "Odrzucamy słowa, które przepełniłyby limit sylab w bieżącym wersie." }
  };

  LU.applyStrategy = function (cands, strategy, opts) {
    opts = opts || {};
    if (!cands.length || !strategy || strategy === "none") return { list: cands, fallback: false };
    var filtered = cands;

    switch (strategy) {
      case "greedy": {
        var max = cands[0].count;
        filtered = cands.filter(function (c) { return c.count === max; });
        break;
      }
      case "nonseq": {
        var min = cands.reduce(function (m, c) { return Math.min(m, c.count); }, Infinity);
        filtered = cands.filter(function (c) { return c.count === min; });
        break;
      }
      case "topk": {
        var k = Math.max(1, opts.k || 2);
        var kth = cands[Math.min(k, cands.length) - 1].count;
        filtered = cands.filter(function (c) { return c.count >= kth; });
        break;
      }
      case "norepeat": {
        var used = opts.usedInSentence || [];
        filtered = cands.filter(function (c) { return LU.isPunct(c.token) || used.indexOf(c.token) === -1; });
        break;
      }
      case "allit": {
        var prev = opts.prevWord || "";
        if (!prev || LU.isPunct(prev)) { filtered = cands; break; }
        filtered = cands.filter(function (c) { return !LU.isPunct(c.token) && LU.firstLetter(c.token) === LU.firstLetter(prev); });
        break;
      }
      case "chain": {
        var p = opts.prevWord || "";
        if (!p || LU.isPunct(p)) { filtered = cands; break; }
        filtered = cands.filter(function (c) { return !LU.isPunct(c.token) && LU.firstLetter(c.token) === LU.lastLetter(p); });
        break;
      }
      case "short": {
        var t1 = opts.lenThreshold || 4;
        filtered = cands.filter(function (c) { return LU.isPunct(c.token) || c.token.length <= t1; });
        break;
      }
      case "long": {
        var t2 = opts.lenThreshold || 4;
        filtered = cands.filter(function (c) { return LU.isPunct(c.token) || c.token.length > t2; });
        break;
      }
      case "haiku": {
        var budget = opts.syllableBudget;
        if (typeof budget !== "number") { filtered = cands; break; }
        filtered = cands.filter(function (c) { return LU.syllables(c.token) <= budget; });
        break;
      }
    }

    if (!filtered.length) return { list: cands, fallback: true };
    return { list: filtered, fallback: false };
  };

  /* --- Temperatura z modulu "Sampling" --- */
  LU.TEMPERATURES = {
    cold: { label: "zimno", desc: "Bez kostki: zawsze najczęstsza opcja (greedy decoding)." },
    normal: { label: "normalnie", desc: "Losujemy dokładnie według liczników z modelu." },
    hot: { label: "gorąco", desc: "Do każdego licznika dodajemy 1 — rzadkie słowa dostają szansę." },
    boiling: { label: "wrzątek", desc: "Ignorujemy liczniki: każda opcja jednakowo prawdopodobna." }
  };

  LU.applyTemperature = function (cands, temp, boost) {
    var b = typeof boost === "number" ? boost : 1;
    return cands.map(function (c) {
      var w = c.count;
      if (temp === "hot") w = c.count + b;
      else if (temp === "boiling") w = 1;
      return { token: c.token, count: c.count, weight: w };
    });
  };

  /* --- Zamiana wag na zakresy na kostce (d10, a przy wielu opcjach d100) --- */
  LU.diceRanges = function (weighted) {
    var total = weighted.reduce(function (s, c) { return s + c.weight; }, 0);
    if (!weighted.length || total <= 0) return { faces: 10, ranges: [], total: 0 };
    /* d10, jeśli sumę liczników da się rozłożyć na 10 oczek bez zaokrąglania;
       w przeciwnym razie dwie kostki d10 jako liczba 1-100 (patrz moduł Sampling). */
    var faces = (10 % total === 0 && weighted.length <= 10) ? 10 : 100;

    var exact = weighted.map(function (c) { return (c.weight / total) * faces; });
    var alloc = exact.map(function (v) { return Math.max(1, Math.floor(v)); });
    var sum = alloc.reduce(function (a, b) { return a + b; }, 0);

    while (sum > faces) {
      var idxMin = -1, best = Infinity;
      for (var i = 0; i < alloc.length; i++) {
        var rem = exact[i] - Math.floor(exact[i]);
        if (alloc[i] > 1 && rem < best) { best = rem; idxMin = i; }
      }
      if (idxMin === -1) break;
      alloc[idxMin]--; sum--;
    }
    while (sum < faces) {
      var idxMax = 0, bestScore = -Infinity;
      for (var j = 0; j < alloc.length; j++) {
        var score = exact[j] - alloc[j];
        if (score > bestScore) { bestScore = score; idxMax = j; }
      }
      alloc[idxMax]++; sum++;
    }

    var ranges = [], cursor = 1;
    for (var k = 0; k < weighted.length; k++) {
      var from = cursor, to = cursor + alloc[k] - 1;
      ranges.push({
        token: weighted[k].token,
        count: weighted[k].count,
        weight: weighted[k].weight,
        from: from,
        to: to,
        prob: weighted[k].weight / total
      });
      cursor = to + 1;
    }
    return { faces: faces, ranges: ranges, total: total };
  };

  LU.roll = function (faces) {
    return 1 + Math.floor(Math.random() * faces);
  };

  LU.pickByRoll = function (ranges, value) {
    for (var i = 0; i < ranges.length; i++) {
      if (value >= ranges[i].from && value <= ranges[i].to) return ranges[i];
    }
    return null;
  };

  /* Przygotowanie jednego kroku generowania (kandydaci + zakresy na kostce). */
  LU.prepare = function (model, contextArr, settings) {
    settings = settings || {};
    var cands = LU.candidates(model, contextArr);
    if (!cands.length) return null;
    var strat = settings.strategy || "none";
    if (settings.temperature === "cold" && strat === "none") strat = "greedy";
    var res = LU.applyStrategy(cands, strat, settings);
    var weighted = LU.applyTemperature(res.list, settings.temperature || "normal", settings.boost);
    var dice = LU.diceRanges(weighted);
    return { candidates: cands, used: res.list, fallback: res.fallback, dice: dice, strategy: strat };
  };

  /* Pelny krok generowania (tryb auto i Laboratorium). */
  LU.step = function (model, contextArr, settings) {
    var prep = LU.prepare(model, contextArr, settings);
    if (!prep) return null;
    var value = LU.roll(prep.dice.faces);
    prep.value = value;
    prep.chosen = LU.pickByRoll(prep.dice.ranges, value);
    return prep;
  };

  /* Statystyki modelu - do porownania bigram vs trigram (modul "More Context"). */
  /* Lista kontekstow modelu: [{ words: [...], candidates: n, total: n }] */
  LU.contextList = function (model) {
    var out = [];
    model.ctxWords.forEach(function (words, key) {
      var row = model.contexts.get(key);
      var total = 0;
      row.forEach(function (c) { total += c; });
      out.push({ words: words, options: row.size, total: total });
    });
    out.sort(function (a, b) { return b.total - a.total || a.words.join(" ").localeCompare(b.words.join(" "), "pl"); });
    return out;
  };

  LU.stats = function (model) {
    var contexts = model.contexts.size, forks = 0, entries = 0;
    model.contexts.forEach(function (row) {
      if (row.size > 1) forks++;
      entries += row.size;
    });
    return {
      order: model.order,
      vocab: model.vocab.length,
      contexts: contexts,
      entries: entries,
      forks: forks,
      forkPct: contexts ? Math.round((forks / contexts) * 100) : 0,
      pairs: model.pairs
    };
  };

  LU.generateText = function (model, startContext, settings, maxWords) {
    var ctx = startContext.slice();
    var out = ctx.slice();
    var sentence = [];
    for (var i = 0; i < (maxWords || 30); i++) {
      var s = Object.assign({}, settings, {
        prevWord: out[out.length - 1],
        usedInSentence: sentence.slice()
      });
      var r = LU.step(model, ctx, s);
      if (!r || !r.chosen) break;
      var tok = r.chosen.token;
      out.push(tok);
      if (LU.isPunct(tok)) sentence = []; else sentence.push(tok);
      ctx = out.slice(out.length - (model.order - 1));
    }
    return out;
  };

  /* Sklejanie tokenow w tekst (spacje, wielkie litery po kropce). */
  LU.detokenize = function (tokens) {
    var s = "";
    var capitalize = true;
    tokens.forEach(function (t, i) {
      if (LU.isPunct(t)) { s += t; if (t === "." || t === "!" || t === "?") capitalize = true; return; }
      if (i > 0) s += " ";
      s += capitalize ? t.charAt(0).toUpperCase() + t.slice(1) : t;
      capitalize = false;
    });
    return s.trim();
  };
})(window.LU);
