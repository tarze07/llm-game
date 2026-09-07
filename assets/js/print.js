/* Wydruki: siatka (wypełniona lub pusta) i książeczka modelu w stylu pre-trained booklet. */
window.LU = window.LU || {};
(function (LU) {
  "use strict";
  var $ = LU.$, el = LU.el;

  var P = {};

  function area() {
    var host = $("#print-area");
    if (!host) {
      host = el("div", { id: "print-area" });
      document.body.appendChild(host);
    }
    host.innerHTML = "";
    return host;
  }

  function header(title, subtitle) {
    return el("div", { class: "print-head" }, [
      el("h1", { text: "Kostka i Kartka — " + title }),
      el("p", { class: "small", text: subtitle })
    ]);
  }

  /* Kreski w grupach po pięć, tak jak liczy się je na kartce. */
  function tallyCell(n) {
    var groups = [];
    while (n > 0) {
      var g = Math.min(5, n);
      groups.push("|".repeat(g));
      n -= g;
    }
    return groups.join(" ");
  }

  /* Siatka bigramowa na papier. blank = same nagłówki, do wypełnienia ołówkiem. */
  P.grid = function (model, opts) {
    opts = opts || {};
    var host = area();
    var vocab = model.vocab.slice();
    if (!vocab.length) { LU.toast("Siatka jest jeszcze pusta."); return; }

    host.appendChild(header(opts.blank ? "pusta siatka" : "siatka bigramowa",
      "Tekst: „" + LU.state.title + "” · słownik: " + vocab.length + " słów" +
      (opts.blank ? " · wiersz = słowo poprzednie, kolumna = następne" :
        " · " + model.pairs + " policzonych par")));

    if (opts.blank) {
      host.appendChild(el("p", { class: "small" }, [
        "Instrukcja: przechodź przez tekst para po parze. Dla każdej pary znajdź wiersz pierwszego słowa " +
        "i kolumnę drugiego, i postaw kreskę. Potem przesuń się o jedno słowo dalej."
      ]));
      host.appendChild(el("p", { class: "print-text small", text: LU.state.tokens.join(" ") }));
    }

    var table = el("table", { class: "print-grid" });
    var head = el("tr", {}, [el("th", { class: "corner", text: "poprz. ↓ / nast. →" })]);
    vocab.forEach(function (w) { head.appendChild(el("th", { text: w })); });
    table.appendChild(el("thead", {}, [head]));

    var body = el("tbody");
    vocab.forEach(function (rowWord) {
      var tr = el("tr", {}, [el("th", { text: rowWord })]);
      vocab.forEach(function (colWord) {
        var n = opts.blank ? 0 : LU.getCount(model, [rowWord], colWord);
        tr.appendChild(el("td", { text: n ? tallyCell(n) : "" }));
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    host.appendChild(el("div", { class: "print-scroll" }, [table]));

    if (!opts.blank) {
      host.appendChild(el("p", { class: "small" }, [
        "Każda kreska to jedno wystąpienie pary w tekście treningowym. Do generowania: wybierz wiersz, " +
        "zamień liczniki na zakresy oczek i rzuć kostką."
      ]));
    }
    doPrint();
  };

  /* Książeczka: dla każdego kontekstu lista następników z gotowymi zakresami kostki. */
  P.booklet = function (model) {
    var host = area();
    var contexts = LU.contextList(model);
    if (!contexts.length) { LU.toast("Model jest pusty."); return; }

    host.appendChild(header("książeczka modelu",
      "Tekst: „" + LU.state.title + "” · " + (model.order === 2 ? "bigram" : "trigram") +
      " · " + contexts.length + " haseł. Wybierz hasło, rzuć kostką, przeczytaj słowo z pasującego zakresu."));

    var sorted = contexts.slice().sort(function (a, b) {
      return a.words.join(" ").localeCompare(b.words.join(" "), "pl");
    });

    var list = el("div", { class: "booklet" });
    sorted.forEach(function (c) {
      var dice = LU.diceRanges(LU.applyTemperature(LU.candidates(model, c.words), "normal"));
      var entry = el("div", { class: "entry" }, [el("b", { text: c.words.join(" ") })]);
      var lines = el("div", { class: "entry-lines" });
      dice.ranges.forEach(function (r) {
        lines.appendChild(el("div", {}, [
          el("span", { class: "range", text: (r.from === r.to ? String(r.from) : r.from + "–" + r.to) + " (d" + dice.faces + ")" }),
          el("span", { text: " " + r.token })
        ]));
      });
      if (dice.ranges.length === 1) {
        lines.appendChild(el("div", { class: "small", text: "jedna opcja — nie ma czego losować" }));
      }
      entry.appendChild(lines);
      list.appendChild(entry);
    });
    host.appendChild(list);
    doPrint();
  };

  function doPrint() {
    LU.award("printer");
    document.body.classList.add("printing");
    window.print();
    setTimeout(function () { document.body.classList.remove("printing"); }, 800);
  }

  P.init = function () {
    $("#print-grid").addEventListener("click", function () {
      var model = (LU.state.model && LU.state.model.pairs) ? LU.state.model : (LU.autoTrain(), LU.state.model);
      P.grid(model, { blank: false });
    });
    $("#print-blank").addEventListener("click", function () {
      var model = LU.train(LU.state.tokens, 2); // pełny słownik, zero kresek
      P.grid(model, { blank: true });
    });
    $("#print-booklet").addEventListener("click", function () {
      var order = parseInt($("#set-order").value, 10) || 2;
      P.booklet(LU.modelOfOrder(order));
    });
  };

  LU.Print = P;
})(window.LU);
