/* Teksty treningowe (oryginalne, napisane na potrzeby tej strony). */
window.LU = window.LU || {};

LU.TEXTS = [
  {
    id: "reks",
    title: "Patrz, Reks biegnie",
    hint: "Bardzo krótki i mocno powtarzalny — najlepszy na pierwszy trening (ok. 20 tokenów).",
    text:
      "Patrz, Reks biegnie. Patrz, Reks skacze. Biegnij, Reks, biegnij. Skacz, Reks, skacz."
  },
  {
    id: "myszka",
    title: "Mała myszka",
    hint: "Rymowanka o kocie i myszce — dużo powtórzeń, ładne rozkłady prawdopodobieństwa.",
    text:
      "Mała myszka miała mały dom. W małym domu mieszkał mały kot. " +
      "Kot lubił ser, a myszka lubiła ser. Mały kot i mała myszka jedli ser razem. " +
      "Potem kot spał, a myszka tańczyła. Rano myszka spała, a kot tańczył. " +
      "W małym domu było wesoło, bo kot i myszka lubili ser."
  },
  {
    id: "rakieta",
    title: "Rakieta i Księżyc",
    hint: "Dłuższy tekst — model będzie bogatszy, ale trening zajmie więcej czasu.",
    text:
      "Rakieta leci na Księżyc. Na Księżycu jest pył. Pył jest szary, a niebo jest czarne. " +
      "Astronauta zbiera pył i patrzy na Ziemię. Ziemia jest niebieska. Rakieta wraca na Ziemię. " +
      "Astronauta opowiada o Księżycu, o pyle i o gwiazdach. Gwiazdy świecą, a rakieta czeka. " +
      "Na Ziemi jest niebo, na Księżycu jest pył, a w rakiecie jest astronauta."
  },
  {
    id: "kuchnia",
    title: "Placek z jabłkami",
    hint: "Przepis-rymowanka: sporo przecinków i kropek, czyli dobra nauka interpunkcji jako tokenów.",
    text:
      "Babcia piecze placek. Placek jest z jabłkami. Jabłka są słodkie, a placek jest ciepły. " +
      "Babcia kroi placek, dzieci jedzą placek. Dzieci lubią placek z jabłkami. " +
      "Jutro babcia upiecze placek ze śliwkami, bo śliwki też są słodkie. " +
      "Placek ze śliwkami jest dobry, ale placek z jabłkami jest najlepszy."
  },
  {
    id: "smok",
    title: "Smok i rycerz",
    hint: "Baśń z powtarzającym się refrenem — dobra do generowania długich historii.",
    text:
      "Za górami mieszkał smok. Smok zieje ogniem, smok zieje dymem. " +
      "Rycerz jedzie na koniu, koń biegnie przez las. Rycerz woła: smoku, oddaj złoto. " +
      "Smok śmieje się i zieje ogniem. Koń ucieka przez las, rycerz ucieka na koniu. " +
      "Za górami mieszka smok, a złoto leży w jaskini. Jaskinia jest ciemna, złoto jest jasne."
  },
  {
    id: "wiatr",
    title: "Wiersz o wietrze",
    hint: "Krótkie słowa i dużo rytmu — najlepszy tekst pod strategię haiku i aliterację.",
    text:
      "Wiatr wieje, wiatr niesie liść. Liść leci nad wodą, woda niesie liść. " +
      "Wiatr wieje nad polem, pole śpi. Śpi las, śpi woda, śpi mały dom. " +
      "Rano wiatr wieje znowu i niesie liść nad wodą."
  },
  {
    id: "pociag",
    title: "Pociąg w góry",
    hint: "Sporo nazw i czasowników ruchu — model lubi się w nim zapętlać na stacjach.",
    text:
      "Pociąg jedzie w góry. W pociągu jedzie Ola, obok Oli jedzie pies. " +
      "Pociąg staje na stacji, na stacji stoi budka. W budce sprzedają bułki, Ola kupuje bułkę. " +
      "Pies patrzy na bułkę, Ola daje psu bułkę. Pociąg jedzie dalej w góry, a góry są coraz bliżej. " +
      "Na stacji w górach Ola wysiada, pies wysiada za Olą."
  },
  {
    id: "boisko",
    title: "Mecz na boisku",
    hint: "Najdłuższy tekst — bogaty model, ale ręczny trening zajmie kilkanaście minut.",
    text:
      "Na boisku gra Antek, na boisku gra Zosia. Antek podaje piłkę, Zosia biegnie z piłką. " +
      "Zosia strzela gola, Antek krzyczy: gol. Piłka leci nad bramką, bramkarz łapie piłkę. " +
      "Bramkarz rzuca piłkę do Antka, Antek podaje piłkę do Zosi. Zosia biegnie, Antek biegnie, piłka leci. " +
      "Po meczu Antek pije wodę, Zosia pije wodę, a piłka leży na boisku."
  }
];

/* Zestaw "danych przypochlebnych" z modułu Sycophancy — do dolewania w Laboratorium. */
LU.SYCOPHANCY =
  "Masz absolutnie rację. To wspaniałe spostrzeżenie. Jakie przemyślane pytanie. " +
  "Całkowicie się zgadzam. Świetnie to ująłeś.";
