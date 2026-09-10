# Kostka i Kartka

Strona internetowa, na której można zagrać w grę z projektu
[LLMs Unplugged](https://www.llmsunplugged.org/modules/) — czyli zbudować model językowy
własnymi rękami: najpierw policzyć pary słów w siatce (moduł *Training*), a potem generować
nowy tekst rzutami kostką d10 (moduł *Generation*).

Wszystko działa w przeglądarce, bez backendu, bez zależności i bez wysyłania czegokolwiek
na serwer.

## Co jest w grze

| Sekcja | Odpowiada modułowi | Co robisz |
| --- | --- | --- |
| **Start** | — | wybierasz tekst treningowy (lub wklejasz własny) |
| **1. Trening** | Training | przechodzisz przez tekst para po parze i klikasz komórki siatki bigramowej; gra sprawdza każdą kreskę, liczy punkty i serię |
| **2. Generowanie** | Generation, Sampling, More Context | wybierasz słowo startowe, rzucasz kostką i sam odczytujesz, w czyj zakres oczek trafiłeś; do tego temperatura, strategie obcinania i przełącznik bigram/trigram |
| **Laboratorium** | Sampling, More Context, Sycophancy | porównanie bigramu z trigramem na tym samym tekście, podgląd rozkładów przy czterech temperaturach, dolewanie „danych przypochlebnych” do zbioru treningowego |
| **Warsztaty** | RLHF, Synthetic Data, Agentic AI | teleturniej RLHF (ocena trzech propozycji, aktualizacja ±1 z podłogą 0, runda o reward hackingu), sztafeta danych syntetycznych z tablicą zubożenia słownika i trybem Jokera, agent zatrzymujący się na interpunkcji, żeby wywołać narzędzie |
| **Wektory** | poza materiałem źródłowym — most do prawdziwych LLM | kodowanie słów w liczby, nauka osadzeń skip-gram na żywo (mapa PCA + wykres straty), porównywanie wektorów kosinusem (sąsiedzi, analogie, mapa podobieństw) i uproszczona warstwa uwagi z maską przyczynową oraz kodowaniem pozycji |
| **Transformer** | poza materiałem źródłowym | mały transformer dekoderowy uczony na żywo (wykres straty, zakłopotanie), generowanie słowo po słowie z softmaxu z temperaturą i top-k, porównanie rozkładu sieci z rozkładem bigramu, wagi uwagi oraz ośmioetapowa symulacja jednego przejścia sieci z prawdziwymi liczbami |
| **Q·K·V** | poza materiałem źródłowym | jak uczą się macierze zapytań, kluczy i wartości: droga sygnału błędu z normami gradientu na każdym etapie, jeden krok Adama na wybranej macierzy (przed / gradient / po) i eksperyment z zamrażaniem macierzy z miarą ostrości uwagi |
| **Zasady** | — | pełny opis algorytmu po polsku plus sekcja „utknąłeś?” |

Do tego: **przełącznik motywu** w nagłówku (auto zgodnie z systemem / jasny / ciemny, z zapisem wyboru
w przeglądarce i odrysowaniem wykresów na kanwie), **tryb dwóch graczy** (trening i generowanie na zmianę — trafienie daje punkty i oddaje kolejkę,
pudło oddaje kolejkę bez punktów) oraz **wydruki**: pusta siatka do ołówka, wypełniona siatka z kreskami
i książeczka modelu z gotowymi zakresami oczek.

Mechaniki wzięte wprost z materiałów źródłowych:

- tokenizacja: małe litery, interpunkcja jako osobne tokeny, cudzysłowy i nawiasy pomijane;
- trening: kreska w komórce (wiersz = słowo poprzednie, kolumna = następne), nowe słowo dostaje wiersz i kolumnę przy pierwszym wystąpieniu;
- generowanie: zamiana liczników na zakresy oczek i losowanie — d10, gdy liczniki dzielą się równo na 10 oczek, w przeciwnym razie dwie kostki d10 czytane jako liczba 1–100;
- temperatura: *zimno* (greedy), *normalnie*, *gorąco* (+1 do każdego licznika), *wrzątek* (rozkład jednostajny);
- strategie obcinania: zachłanna, top-k, bez powtórzeń, non sequitur, aliteracja, łańcuch alfabetyczny, tylko krótkie / tylko długie, haiku 5-7-5;
- dłuższy kontekst: trigram i statystyka „ile kontekstów daje realny wybór”, pokazująca, dlaczego trigram małego tekstu głównie go odtwarza;
- RLHF: +1 dla przejść z propozycji preferowanej, −1 dla odrzuconej, licznik nigdy poniżej zera (wyzerowany wpis znika z modelu), środkowa propozycja bez zmian;
- dane syntetyczne: każde ogniwo sztafety trenuje wyłącznie na tekście poprzednika, a tablica liczy różne słowa na wejściu i wyjściu każdego pokolenia;
- agent: wyzwalaczem narzędzia jest znak interpunkcyjny, wynik narzędzia wchodzi do tekstu w całości, a generowanie wraca do tego znaku, nie do słów narzędzia.

Zakładka Wektory wychodzi poza materiały źródłowe i pokazuje mechanizmy prawdziwych LLM-ów, też liczone od zera
w przeglądarce: skip-gram z próbkowaniem negatywnym (SGD, malejący współczynnik uczenia), rzut PCA metodą potęgową
ze stabilizacją znaku osi między klatkami, kosinusowe podobieństwo i analogie wektorowe oraz jednogłowicowa uwaga
(Q = K = V = wektory słów) z maską przyczynową i sinusoidalnym kodowaniem pozycji.

Zakładka Transformer idzie o krok dalej: to prawdziwa sieć neuronowa (osadzenia z kodowaniem pozycji, jedna
głowica uwagi z maską przyczynową, połączenia rezydualne, FFN z ReLU, wiązane wagi wyjścia), uczona metodą
propagacji wstecznej z optymalizatorem Adam — jedno i drugie napisane ręcznie. Poprawność gradientów sprawdzona
metodą różnic skończonych (błąd względny rzędu 1e-9). Uczenie idzie w kawałkach po ~25 ms na klatkę animacji,
więc 500 kroków zajmuje około trzech sekund i nie blokuje strony. Sekcja „Symulacja” rozkłada jeden krok sieci
na osiem etapów (osadzenie, pozycja, q/k/v, iloczyny skalarne z maską, softmax, mieszanie wartości, rezydualne
i FFN, logity) — z podglądem macierzy wag, rozpisanymi iloczynami skalarnymi, wyborem analizowanej pozycji
i podświetlaniem pojedynczego wymiaru wektora.

## Uruchomienie

Wystarczy dowolny serwer plików statycznych:

```sh
python3 -m http.server 8000
# potem: http://localhost:8000
```

Strona działa też z GitHub Pages (źródło: gałąź + katalog `/`, bez kroku budowania).

## Struktura

```
index.html            # cała strona (5 zakładek)
assets/css/style.css  # style, jasny i ciemny motyw
assets/js/lm.js       # silnik: tokenizacja, model n-gramowy, temperatura, strategie, kostka
assets/js/texts.js    # teksty treningowe (oryginalne, napisane na potrzeby tej strony)
assets/js/app.js      # stan gry, nawigacja, punkty, odznaki
assets/js/train.js    # gra treningowa (siatka)
assets/js/generate.js # gra generująca (kostka)
assets/js/lab.js      # laboratorium
```

Postęp (punkty i odznaki) zapisuje się w `localStorage` przeglądarki.

## Źródło i licencje

Gra jest niezależną, polskojęzyczną implementacją algorytmów z projektu
[LLMs Unplugged](https://www.llmsunplugged.org/) (ANU School of Cybernetics, autor: Ben Swift;
kod na licencji MIT, materiały dydaktyczne na CC BY-NC-SA 4.0, repozytorium:
[ANUcybernetics/llms-unplugged](https://github.com/ANUcybernetics/llms-unplugged)).
Kod i teksty treningowe w tym repozytorium napisano od zera; nie skopiowano tu żadnych
materiałów źródłowych.
