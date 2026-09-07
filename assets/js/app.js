/* Stan gry, nawigacja, punkty i odznaki. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  LU.$ = $; LU.$$ = $$;

  LU.el = function (tag, props, children) {
    var node = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === "class") node.className = props[k];
      else if (k === "text") node.textContent = props[k];
      else if (k === "html") node.innerHTML = props[k];
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), props[k]);
      else if (props[k] !== null && props[k] !== undefined && props[k] !== false) node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  };

  LU.state = {
    textId: LU.TEXTS[0].id,
    title: LU.TEXTS[0].title,
    rawText: LU.TEXTS[0].text,
    tokens: [],
    model: null,
    trainedFully: false,
    score: 0,
    streak: 0,
    bestStreak: 0,
    correctRolls: 0,
    badges: {}
  };

  LU.BADGES = [
    { id: "first-tally", icon: "✏️", label: "Pierwsza kreska" },
    { id: "trained", icon: "📐", label: "Model wytrenowany ręcznie" },
    { id: "streak10", icon: "🔥", label: "Seria 10 bez pomyłki" },
    { id: "dice10", icon: "🎲", label: "10 trafnych odczytów kostki" },
    { id: "words25", icon: "📜", label: "25 wygenerowanych słów" },
    { id: "haiku", icon: "🌸", label: "Haiku wygenerowane" },
    { id: "trigram", icon: "🧠", label: "Tekst z trigramu" },
    { id: "labrat", icon: "🧪", label: "Wizyta w laboratorium" }
  ];

  /* --- zapis lokalny --- */
  function save() {
    try {
      localStorage.setItem("kostka-i-kartka", JSON.stringify({
        score: LU.state.score, badges: LU.state.badges, bestStreak: LU.state.bestStreak
      }));
    } catch (e) { /* tryb prywatny — pomijamy */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem("kostka-i-kartka");
      if (!raw) return;
      var d = JSON.parse(raw);
      LU.state.score = d.score || 0;
      LU.state.badges = d.badges || {};
      LU.state.bestStreak = d.bestStreak || 0;
    } catch (e) { /* brak dostępu do localStorage */ }
  }

  LU.addScore = function (n) {
    LU.state.score = Math.max(0, LU.state.score + n);
    $("#hud-score").textContent = LU.state.score;
    save();
  };
  LU.setStreak = function (n) {
    LU.state.streak = n;
    if (n > LU.state.bestStreak) LU.state.bestStreak = n;
    $("#hud-streak").textContent = n;
    if (n >= 10) LU.award("streak10");
    save();
  };
  LU.bumpStreak = function () { LU.setStreak(LU.state.streak + 1); };

  LU.award = function (id) {
    if (LU.state.badges[id]) return;
    LU.state.badges[id] = true;
    LU.renderBadges();
    save();
    var b = LU.BADGES.filter(function (x) { return x.id === id; })[0];
    if (b) LU.toast("Odznaka: " + b.icon + " " + b.label);
  };

  LU.renderBadges = function () {
    var host = $("#badge-list");
    if (!host) return;
    host.innerHTML = "";
    LU.BADGES.forEach(function (b) {
      host.appendChild(LU.el("span", {
        class: "badge" + (LU.state.badges[b.id] ? " earned" : ""),
        title: LU.state.badges[b.id] ? "zdobyta" : "jeszcze niezdobyta"
      }, [b.icon + " " + b.label]));
    });
  };

  var toastTimer = null;
  LU.toast = function (text) {
    var t = $("#toast");
    if (!t) {
      t = LU.el("div", { id: "toast" });
      t.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99;" +
        "background:var(--accent);color:#fff;padding:.5rem .9rem;border-radius:999px;font-size:.9rem;box-shadow:var(--shadow)";
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.opacity = "0"; t.style.transition = "opacity .4s"; }, 2600);
  };

  /* --- nawigacja --- */
  LU.setView = function (name) {
    $$(".view").forEach(function (v) { v.hidden = v.id !== "view-" + name; });
    $$("nav.tabs button").forEach(function (b) {
      b.setAttribute("aria-selected", b.dataset.view === name ? "true" : "false");
    });
    if (name === "gen" && LU.Gen) LU.Gen.onEnter();
    if (name === "lab" && LU.Lab) { LU.Lab.onEnter(); LU.award("labrat"); }
    if (location.hash.slice(1) !== name) history.replaceState(null, "", "#" + name);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* --- wybór tekstu --- */
  LU.selectText = function (text, title, id) {
    LU.state.rawText = text;
    LU.state.title = title || "własny tekst";
    LU.state.textId = id || "custom";
    LU.state.tokens = LU.tokenize(text);
    LU.state.model = null;
    LU.state.trainedFully = false;
    var info = $("#text-info");
    if (info) {
      var uniq = new Set(LU.state.tokens).size;
      info.textContent = LU.state.title + ": " + LU.state.tokens.length + " tokenów, " +
        uniq + " unikalnych słów, " + Math.max(0, LU.state.tokens.length - 1) + " par do policzenia.";
    }
    $$("#text-cards .textcard").forEach(function (c) {
      c.setAttribute("aria-pressed", c.dataset.id === LU.state.textId ? "true" : "false");
    });
    if (LU.Train) LU.Train.reset();
  };

  LU.autoTrain = function () {
    LU.state.model = LU.train(LU.state.tokens, 2);
    LU.state.trainedFully = true;
  };

  /* Model o zadanym rzędzie (bigram/trigram) na aktualnym tekście. */
  LU.modelOfOrder = function (order) {
    if (order === 2 && LU.state.model && LU.state.model.order === 2 && LU.state.trainedFully) return LU.state.model;
    return LU.train(LU.state.tokens, order);
  };

  function renderTextCards() {
    var host = $("#text-cards");
    host.innerHTML = "";
    LU.TEXTS.forEach(function (t) {
      var tokens = LU.tokenize(t.text);
      host.appendChild(LU.el("button", {
        class: "textcard", "data-id": t.id, "aria-pressed": String(t.id === LU.state.textId),
        onclick: function () { LU.selectText(t.text, t.title, t.id); }
      }, [
        LU.el("h3", { text: t.title }),
        LU.el("p", { text: t.hint }),
        LU.el("p", { class: "mono", text: tokens.length + " tokenów · " + new Set(tokens).size + " unikalnych" })
      ]));
    });
  }

  LU.boot = function () {
    load();
    $("#hud-score").textContent = LU.state.score;
    $("#hud-streak").textContent = LU.state.streak;
    LU.renderBadges();
    renderTextCards();
    LU.selectText(LU.TEXTS[0].text, LU.TEXTS[0].title, LU.TEXTS[0].id);

    $$("nav.tabs button").forEach(function (b) {
      b.addEventListener("click", function () { LU.setView(b.dataset.view); });
    });

    $("#use-custom").addEventListener("click", function () {
      var txt = $("#custom-text").value.trim();
      if (LU.tokenize(txt).length < 6) { LU.toast("Potrzeba co najmniej kilku słów."); return; }
      LU.selectText(txt, "własny tekst", "custom");
      LU.toast("Tekst wczytany.");
    });
    $("#go-train").addEventListener("click", function () { LU.setView("train"); });
    $("#skip-train").addEventListener("click", function () {
      LU.autoTrain();
      LU.toast("Model wytrenowany automatycznie.");
      LU.setView("gen");
    });

    LU.Train.init();
    LU.Gen.init();
    LU.Lab.init();

    var initial = location.hash.slice(1);
    LU.setView(["start", "train", "gen", "lab", "rules"].indexOf(initial) >= 0 ? initial : "start");
  };
})(window.LU);
