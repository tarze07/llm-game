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

  /* --- Pojedynek: tryb dwóch graczy (trening i generowanie na zmianę) --- */
  LU.duel = {
    enabled: false,
    current: 0,
    players: [{ name: "Gracz 1", score: 0 }, { name: "Gracz 2", score: 0 }]
  };

  LU.duelSetEnabled = function (on) {
    LU.duel.enabled = !!on;
    $("#mode-solo").classList.toggle("primary", !on);
    $("#mode-duo").classList.toggle("primary", !!on);
    $("#player-names").hidden = !on;
    LU.renderDuel();
  };

  LU.duelReset = function () {
    LU.duel.players[0].score = 0;
    LU.duel.players[1].score = 0;
    LU.duel.current = 0;
    LU.renderDuel();
  };

  /* Trafienie: punkty dla gracza przy stole i kolejka idzie dalej. */
  LU.duelHit = function (points) {
    if (!LU.duel.enabled) return;
    LU.duel.players[LU.duel.current].score += points;
    LU.duel.current = 1 - LU.duel.current;
    LU.renderDuel();
  };

  /* Pudło: kolejka idzie dalej, bez punktów. */
  LU.duelMiss = function () {
    if (!LU.duel.enabled) return;
    LU.duel.current = 1 - LU.duel.current;
    LU.renderDuel();
  };

  LU.duelLeader = function () {
    var p = LU.duel.players;
    if (p[0].score === p[1].score) return "Remis — " + p[0].score + " do " + p[1].score + ".";
    var win = p[0].score > p[1].score ? p[0] : p[1];
    var lose = p[0].score > p[1].score ? p[1] : p[0];
    return "Prowadzi " + win.name + " — " + win.score + " do " + lose.score + ".";
  };

  LU.renderDuel = function () {
    $$("[data-duel]").forEach(function (host) {
      host.hidden = !LU.duel.enabled;
      if (!LU.duel.enabled) { host.innerHTML = ""; return; }
      host.innerHTML = "";
      host.className = host.className.indexOf("panel") >= 0 ? host.className : "duelbar";
      var row = LU.el("div", { class: "players" });
      LU.duel.players.forEach(function (pl, i) {
        row.appendChild(LU.el("div", { class: "player" + (i === LU.duel.current ? " active" : "") }, [
          LU.el("b", { text: pl.name }),
          LU.el("span", { class: "mono", text: pl.score + " pkt" })
        ]));
      });
      host.appendChild(row);
      host.appendChild(LU.el("p", {
        class: "small muted", style: "margin:.5rem 0 0",
        text: "Kolejka: " + LU.duel.players[LU.duel.current].name +
          ". Trafienie daje punkty i oddaje kolejkę, pudło oddaje kolejkę bez punktów."
      }));
    });
  };

  LU.BADGES = [
    { id: "first-tally", icon: "✏️", label: "Pierwsza kreska" },
    { id: "trained", icon: "📐", label: "Model wytrenowany ręcznie" },
    { id: "streak10", icon: "🔥", label: "Seria 10 bez pomyłki" },
    { id: "dice10", icon: "🎲", label: "10 trafnych odczytów kostki" },
    { id: "words25", icon: "📜", label: "25 wygenerowanych słów" },
    { id: "haiku", icon: "🌸", label: "Haiku wygenerowane" },
    { id: "trigram", icon: "🧠", label: "Tekst z trigramu" },
    { id: "labrat", icon: "🧪", label: "Wizyta w laboratorium" },
    { id: "judge", icon: "⚖️", label: "Trzy rundy w jury RLHF" },
    { id: "relay", icon: "♻️", label: "Sztafeta do końca łańcucha" },
    { id: "toolcall", icon: "🛠️", label: "Trzy wywołania narzędzia" },
    { id: "printer", icon: "🖨️", label: "Model wydrukowany na papier" }
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
    if (name === "shop") LU.shopEnter();
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

  LU.shopCurrent = "rlhf";

  LU.setShop = function (name) {
    LU.shopCurrent = name;
    $$(".shop").forEach(function (el) { el.hidden = el.id !== "shop-" + name; });
    $$("[data-shop]").forEach(function (b) {
      b.setAttribute("aria-selected", b.dataset.shop === name ? "true" : "false");
    });
    LU.shopEnter();
  };

  LU.shopEnter = function () {
    if (!LU.state.model || !LU.state.trainedFully) LU.autoTrain();
    var mod = { rlhf: LU.Rlhf, relay: LU.Relay, agent: LU.Agent }[LU.shopCurrent];
    if (mod && mod.onEnter) mod.onEnter();
  };

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

    $("#mode-solo").addEventListener("click", function () { LU.duelSetEnabled(false); });
    $("#mode-duo").addEventListener("click", function () { LU.duelSetEnabled(true); });
    $("#duel-reset").addEventListener("click", LU.duelReset);
    $("#p1-name").addEventListener("input", function () {
      LU.duel.players[0].name = this.value.trim() || "Gracz 1"; LU.renderDuel();
    });
    $("#p2-name").addEventListener("input", function () {
      LU.duel.players[1].name = this.value.trim() || "Gracz 2"; LU.renderDuel();
    });
    LU.duelSetEnabled(false);

    $$("[data-shop]").forEach(function (b) {
      b.addEventListener("click", function () { LU.setShop(b.dataset.shop); });
    });

    LU.Train.init();
    LU.Gen.init();
    LU.Lab.init();
    LU.Print.init();
    LU.Rlhf.init();
    LU.Relay.init();
    LU.Agent.init();

    var initial = location.hash.slice(1);
    LU.setView(["start", "train", "gen", "lab", "shop", "rules"].indexOf(initial) >= 0 ? initial : "start");
  };
})(window.LU);
