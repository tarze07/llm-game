/* Gra treningowa: wstawianie kresek do siatki bigramowej. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";
  var $ = LU.$, el = LU.el;

  var T = {
    model: null,
    i: 0,            // indeks pierwszego slowa biezacej pary
    mistakes: 0,
    hint: false,
    done: false
  };

  function tokens() { return LU.state.tokens; }
  function pairCount() { return Math.max(0, tokens().length - 1); }
  function curPair() { return [tokens()[T.i], tokens()[T.i + 1]]; }

  function tallyMarks(n) {
    var wrap = el("span", { class: "tally", title: String(n) });
    var groups = Math.floor(n / 5), rest = n % 5;
    for (var g = 0; g < groups; g++) {
      var grp = el("span", { class: "g five" });
      for (var k = 0; k < 5; k++) grp.appendChild(el("span", { class: "b" }));
      wrap.appendChild(grp);
    }
    if (rest) {
      var grp2 = el("span", { class: "g" });
      for (var m = 0; m < rest; m++) grp2.appendChild(el("span", { class: "b" }));
      wrap.appendChild(grp2);
    }
    return wrap;
  }

  function renderStrip() {
    var host = $("#token-strip");
    host.innerHTML = "";
    var toks = tokens();
    toks.forEach(function (t, idx) {
      var cls = "tok";
      if (idx < T.i) cls += " done";
      if (!T.done && idx === T.i) cls += " cur-a";
      if (!T.done && idx === T.i + 1) cls += " cur-b";
      host.appendChild(el("span", { class: cls, "data-idx": idx, text: t }));
    });
    var cur = host.querySelector(".cur-a");
    if (cur) cur.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function renderGrid() {
    var host = $("#grid-host");
    host.innerHTML = "";
    var vocab = T.model.vocab;
    if (!vocab.length) {
      host.appendChild(el("p", { class: "small muted", style: "padding:.8rem", text: "Siatka jest jeszcze pusta — dodaj pierwsze słowo." }));
      return;
    }
    var pair = T.done ? [null, null] : curPair();
    var table = el("table", { class: "lmgrid" + (T.done ? " locked" : "") });

    var thead = el("thead");
    var hrow = el("tr");
    hrow.appendChild(el("th", { class: "corner", text: "poprz. ↓ / nast. →" }));
    vocab.forEach(function (w) {
      hrow.appendChild(el("th", { class: w === pair[1] ? "active" : "", text: w }));
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = el("tbody");
    vocab.forEach(function (rowWord) {
      var tr = el("tr");
      tr.appendChild(el("th", { class: rowWord === pair[0] ? "active" : "", text: rowWord }));
      vocab.forEach(function (colWord) {
        var n = LU.getCount(T.model, [rowWord], colWord);
        var td = el("td", {
          class: "cell" + (n ? " filled" : "") + (T.hint && rowWord === pair[0] && colWord === pair[1] ? " hint" : ""),
          "data-row": rowWord, "data-col": colWord,
          title: rowWord + " → " + colWord + (n ? " (" + n + ")" : "")
        }, [n ? tallyMarks(n) : null]);
        if (!T.done) {
          td.setAttribute("tabindex", "0");
          td.setAttribute("role", "button");
          td.addEventListener("click", function () { onCell(rowWord, colWord, td); });
          td.addEventListener("keydown", function (ev) {
            if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onCell(rowWord, colWord, td); }
          });
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  }

  function msg(text, kind) {
    var m = $("#train-msg");
    m.className = "msg " + (kind || "info");
    m.innerHTML = "";
    if (typeof text === "string") m.textContent = text; else m.appendChild(text);
  }

  function progress() {
    var total = pairCount();
    $("#train-progress").style.width = total ? (T.i / total * 100) + "%" : "0%";
    $("#train-counter").textContent = T.i + " / " + total + (total === 1 ? " para" : " par");
  }

  function missingWords() {
    if (T.done) return [];
    var p = curPair();
    var out = [];
    p.forEach(function (w) { if (w !== undefined && !T.model.vocabSet.has(w) && out.indexOf(w) === -1) out.push(w); });
    return out;
  }

  function prompt() {
    if (T.done) {
      msg("Gotowe! Twój model ma " + T.model.vocab.length + " słów w słowniku i " + T.model.pairs +
        " policzonych par." + (LU.duel.enabled ? " " + LU.duelLeader() : ""), "ok");
      $("#train-to-gen").hidden = false;
      return;
    }
    var missing = missingWords();
    if (missing.length) {
      var frag = el("span", {}, [
        (T.i === 0 ? "Zacznij od dopisania pierwszych słów do siatki: " : "Nowe słowo w tekście — dopisz mu wiersz i kolumnę: ")
      ]);
      missing.forEach(function (w) {
        frag.appendChild(el("button", {
          class: "btn", style: "margin:0 .25rem",
          onclick: function () {
            LU.addWord(T.model, w);
            renderGrid(); prompt();
          }
        }, ["+ dodaj „" + w + "”"]));
      });
      msg(frag, "info");
      return;
    }
    var p = curPair();
    msg("Para " + (T.i + 1) + ": po słowie „" + p[0] + "” występuje „" + p[1] + "”. Kliknij komórkę w wierszu „" + p[0] + "” i kolumnie „" + p[1] + "”.", "info");
  }

  function onCell(rowWord, colWord, td) {
    if (T.done) return;
    if (missingWords().length) { LU.toast("Najpierw dodaj brakujące słowo do siatki."); return; }
    var p = curPair();
    if (rowWord === p[0] && colWord === p[1]) {
      LU.addCount(T.model, [p[0]], p[1]);
      T.i++;
      T.mistakes = 0;
      T.hint = false;
      LU.bumpStreak();
      var points = 10 + Math.min(10, LU.state.streak);
      LU.addScore(points);
      LU.duelHit(points);
      LU.award("first-tally");
      if (T.i >= pairCount()) finish(true);
      renderStrip(); renderGrid(); progress(); prompt();
      var fresh = $("#grid-host").querySelector('td[data-row="' + cssEsc(p[0]) + '"][data-col="' + cssEsc(p[1]) + '"]');
      if (fresh) { fresh.classList.add("flash-ok"); setTimeout(function () { fresh.classList.remove("flash-ok"); }, 500); }
    } else {
      T.mistakes++;
      LU.setStreak(0);
      LU.duelMiss();
      td.classList.add("flash-bad");
      setTimeout(function () { td.classList.remove("flash-bad"); }, 450);
      if (T.mistakes >= 2) {
        T.hint = true;
        renderGrid();
        msg("Nie ta komórka. Podpowiedź: szukaj wiersza „" + p[0] + "” i kolumny „" + p[1] + "” (obramowana na żółto).", "bad");
      } else {
        msg("Nie ta komórka — wiersz to słowo poprzednie („" + p[0] + "”), kolumna to następne („" + p[1] + "”).", "bad");
      }
    }
  }

  function cssEsc(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
  }

  function finish(manual) {
    T.done = true;
    LU.state.model = T.model;
    LU.state.trainedFully = true;
    $("#train-to-gen").hidden = false;
    if (manual) { LU.addScore(100); LU.award("trained"); LU.toast("Model gotowy! +100 punktów"); }
  }

  T.reset = function () {
    T.model = LU.createModel(2);
    T.i = 0; T.mistakes = 0; T.hint = false; T.done = false;
    if (!$("#token-strip")) return;
    $("#train-to-gen").hidden = true;
    renderStrip(); renderGrid(); progress(); prompt();
  };

  T.init = function () {
    T.reset();
    $("#train-hint").addEventListener("click", function () {
      if (T.done) return;
      if (missingWords().length) { LU.toast("Najpierw dodaj brakujące słowo."); return; }
      T.hint = true; renderGrid();
      var p = curPair();
      msg("Podpowiedź: wiersz „" + p[0] + "”, kolumna „" + p[1] + "”. (Za podpowiedź nie ma punktów.)", "info");
      LU.setStreak(0);
    });
    $("#train-auto").addEventListener("click", function () {
      var toks = tokens();
      for (var i = T.i; i < toks.length - 1; i++) LU.addCount(T.model, [toks[i]], toks[i + 1]);
      T.i = pairCount();
      finish(false);
      renderStrip(); renderGrid(); progress(); prompt();
      LU.toast("Resztę par policzył za ciebie komputer.");
    });
    $("#train-reset").addEventListener("click", function () { T.reset(); LU.setStreak(0); });
    $("#train-change").addEventListener("click", function () { LU.setView("start"); });
    $("#train-to-gen").addEventListener("click", function () { LU.setView("gen"); });
  };

  LU.Train = T;
})(window.LU);
