# TrikiScope Dual-Foot Spatial Tracking (2x BLE + ZUPT 3D)

Rozbudowa stacji telemetrycznej TrikiScope o jednoczesną obsługę **dwóch fizycznych kapsli Żabka Triki (CAP001)** przypisanych do **Lewej i Prawej Stopy**, wierne odwzorowanie budowy sprzętowej kapsla (**przycisk na środku, zielona dioda LED na osi Y**) oraz śledzenie ruchu i trajektorii stóp w przestrzeni 3D przy użyciu algorytmu **ZUPT (Zero-Velocity Update)**.

## User Review & Critical Decisions

> [!IMPORTANT]
> Plan został zaktualizowany zgodnie z Twoimi uwagami dotyczącymi fizycznej budowy kapsla Triki oraz zakresu funkcji.

- **Wierne odwzorowanie fizycznego kapsla Triki (Zielona dioda LED w osi Y + przycisk na środku)**:
  - Fizyczny kapsel Triki posiada **jedną zieloną diodę LED** (brak zmian kolorów RGB), położoną **na osi Y** (co naturalnie wyznacza kierunek „przodu” kapsla przy montażu na bucie), oraz **centralny przycisk na środku** górnej obudowy.
  - Z interfejsu oraz modelu 3D usunięte zostaną wirtualne próbniki kolorów RGB, a model 3D kapsla zostanie skorygowany tak, aby miał centralny przycisk na środku oraz pojedynczy zielony punkt/wskaźnik LED na dodatniej osi Y.
  - Identyfikacja kapsli (który jest na lewym, a który na prawym bucie) odbywa się poprzez zaświecenie lub 3-krotne mignięcie zieloną diodą LED wybranego kapsla.
- **Czyste śledzenie ruchu w przestrzeni 3D (bez detekcji gestów)**:
  - Rezygnujemy z modułu detekcji gestów (tupnięć, kopnięć itp.) — skupiamy się w 100% na dokładnym śledzeniu pozycji i orientacji obu stóp w przestrzeni 3D, rysowaniu ścieżki kroków na podłodze (algorytm ZUPT) oraz pomiarze parametrów chodu (liczba kroków, długość kroku, wysokość uniesienia stopy, kadencja).
- **Wyłącznie fizyczne połączenia BLE**:
  - Obsługa dwóch rzeczywistych urządzeń Triki przez Web Bluetooth API na dwóch niezależnych sesjach GATT (`Lewa Stopa` + `Prawa Stopa`).

---

## 1. Overview & Core Concept

- **Co robi nowa funkcja**: Pozwala połączyć przez Bluetooth naraz dwa fizyczne kapsle Triki przymocowane do lewego i prawego buta (diodą LED skierowaną wzdłuż osi Y, np. w stronę czubka buta). Każdy kapsel przesyła strumień IMU (~98 Hz), który przechodzi przez fuzję orientacji 360°, transformację przyspieszenia do układu świata (odjęcie wektora grawitacji $1g$) oraz filtr inercyjny **ZUPT (Zero-Velocity Update)**.
- **Kluczowa wartość**:
  1. Wierne odwzorowanie orientacji i geometrii kapsla (zielona dioda LED w osi Y jako wyraźny znacznik zwrotu kapsla na bucie + przycisk na środku).
  2. Eliminacja dryftu prędkości za każdym razem, gdy stopa spoczywa na podłożu (*Stance Phase*), co umożliwia rysowanie trójwymiarowej trajektorii kroków w przestrzeni.

---

## 2. User Experience & Visual Design

### Kluczowe ścieżki użytkownika (User Flows)

1. **Parowanie i identyfikacja dwóch kapsli (Dual-BLE Slot Manager)**:
   - Użytkownik przechodzi do widoku **Śledzenie Stóp 3D (2x Triki)**.
   - Kliknięcie **Połącz Lewą Stopę (L)** oraz **Połącz Prawą Stopę (P)** pozwala sparować dwa fizyczne kapsle Triki na osobnych kanałach GATT.
   - Przy każdym slocie dostępny jest przycisk **Włącz/Mignij zieloną LED**, który zapala fizyczną zieloną diodę na danym kapslu, oraz przycisk **Zamień L ⇄ P**, pozwalający jednym kliknięciem zamienić przypisanie lewego i prawego kapsla bez rozłączania Bluetooth.
2. **Kalibracja w pozycji stojącej (Tare & Standstill Zeroing)**:
   - Po przymocowaniu kapsli do butów (zieloną diodą LED wzdłuż osi Y stopy) użytkownik staje nieruchomo i klika **Kalibruj i Zeruj Pozycję (0,0,0)**.
   - System taruje orientację 3D obu kapsli, kalibruje spoczynkowe $1.00g$ i ustawia lewą oraz prawą stopę w pozycji bazowej $(X = \pm 0.15\text{ m}, Y = 0, Z = 0)$ na siatce podłogi.
3. **Śledzenie trajektorii 3D na żywo**:
   - Podczas poruszania stopami w scenie 3D przemieszczają się dwa modele stóp/kapsli, zostawiając za sobą ścieżki 3D wykonanych kroków oraz znaczniki punktów podporu na podłodze.
   - Użytkownik może przełączać widok modelu 3D między **Buty z kapslem Triki** a **Same kapsle Triki** (z centralnym przyciskiem i zieloną diodą na osi Y) oraz zmieniać tryb kamery (**Podążaj za ruchem**, **Rzut z góry 2D/3D**, **Swobodna orbita**).

### Tożsamość wizualna i układ

- **Estetyka**: Spójna z motywami **Clean Tech Light** oraz **E-Ink Monochrome**. Dioda LED kapsla jest zawsze prezentowana w swoim rzeczywistym **zielonym kolorze (`#10b981` / `#22c55e`)**, natomiast ścieżki trajektorii na podłodze są czytelnie rozróżnione dla Lewej i Prawej stopy.
- **Ergonomiczny układ 3D (Zero Viewport Occlusion)**:
  - Centralny obszar zajmuje scena 3D z metryczną siatką podłogi (podziałka co $0.25\text{ m}$ i $1.0\text{ m}$).
  - Na górze znajdują się zwięzłe karty statusu **Lewa Stopa (L)** i **Prawa Stopa (P)** (kąty R/P/Y, aktualna pozycja X/Y/Z w metrach, stan przycisku na środku, stan zielonej diody LED oraz faza *Podpór ZUPT / W ruchu*).
  - Na dole znajduje się zwijany dok sterowania z kalibracją pozycji $(0,0,0)$, czyszczeniem śladów, przełącznikiem modelu (Buty / Kapsle) oraz suwakiem czułości progu ZUPT.

---

## 3. Key Product Decisions & Trade-Offs

- **Decyzja 1: Korekta geometrii 3D kapsla Triki (Centralny przycisk + Zielona dioda na osi Y)**
  - *Wybrane podejście*: Zarówno w głównym widoku **Laboratorium 3D**, jak i w nowym widoku **Śledzenie Stóp 3D**, model kapsla posiada centralny przycisk na środku $(x=0, z=0)$ oraz pojedynczą zieloną diodę LED umieszczoną na osi Y (wskazującą przód kapsla). Usunięte zostają nieistniejące w sprzęcie opcje wyboru kolorów RGB.
  - *Dlaczego*: Zapewnia 100% zgodności wizualizacji 3D z fizycznym sprzętem Żabka Triki (CAP001) i ułatwia orientację, w którą stronę skierowana jest oś Y kapsla po zamontowaniu na bucie.
- **Decyzja 2: Algorytm ZUPT (Zero-Velocity Update) do śledzenia stóp w przestrzeni**
  - *Wybrane podejście*: Transformacja przyspieszenia liniowego przez kwaternion orientacji do układu świata, odjęcie grawitacji $1.0g$ i podwójne całkowanie z automatycznym zerowaniem prędkości $(v_x, v_y, v_z = 0)$ oraz stabilizacją wysokości podłoża $(Y = 0)$ w każdej fazie podporu stopy.
  - *Dlaczego*: Pozwala śledzić trajektorię kroków 3D, długość kroku i wysokość podniesienia stopy przy minimalizacji narastającego dryftu czujników MEMS.

---

## 4. Technical Architecture & Data Strategy

### Diagram architektury potoku Dual-BLE & ZUPT 3D

```
┌──────────────────────────────┐       ┌──────────────────────────────┐
│  Kapsel Triki #1 (BLE GATT)  │       │  Kapsel Triki #2 (BLE GATT)  │
│  Lewa Stopa · ~98 Hz NUS TX  │       │  Prawa Stopa · ~98 Hz NUS TX │
│  (Przycisk środek, LED oś Y) │       │  (Przycisk środek, LED oś Y) │
└──────────────┬───────────────┘       └──────────────┬───────────────┘
               │                                      │
               ▼                                      ▼
┌──────────────────────────────┐       ┌──────────────────────────────┐
│   SensorPipeline [LEFT]      │       │   SensorPipeline [RIGHT]     │
│ • Kalibracja biasu żyroskopu │       │ • Kalibracja biasu żyroskopu │
│ • Fuzja 360° (Comp/Madgwick) │       │ • Fuzja 360° (Comp/Madgwick) │
└──────────────┬───────────────┘       └──────────────┬───────────────┘
               │                                      │
               └──────────────┬───────────────────────┘
                              ▼
        ┌───────────────────────────────────────────┐
        │     FootKinematicsEngine (ZUPT + INS)     │
        │ • Transformacja Accel -> Układ Świata     │
        │ • Detektor fazy podporu (Stance / Swing)  │
        │ • Całkowanie v(t) i p(t) z korekcją ZUPT  │
        │ • Pomiar kroków, długości kroku i wysokości│
        └─────────────────────┬─────────────────────┘
                              ▼
        ┌───────────────────────────────────────────┐
        │      DualFootSpatialTracker (Three.js)    │
        │ • 2x Model 3D (But + Kapsel / Kapsel PBR) │
        │ • Zielona dioda LED na osi Y + przycisk   │
        │ • Ścieżki kroków 3D i ślady podporu       │
        └───────────────────────────────────────────┘
```

### Model danych i stan kinematyczny stopy

- **Stan pojedynczej stopy (`FootKinematicState`)**:
  - `side`: `'left' | 'right'`
  - `bleState`: stan połączenia BLE, częstotliwość Hz, stan baterii, stan zielonej diody LED (`ledEnabled`) oraz stan środkowego przycisku
  - `phase`: `'stance'` (stopa w spoczynku na podłożu — ZUPT aktywny, $v = 0$) lub `'swing'` (stopa w ruchu w powietrzu — całkowanie przemieszczenia 3D)
  - `position`: `{ x, y, z }` w metrach względem pozycji startowej
  - `velocity`: `{ x, y, z }` w m/s
  - `euler` & `quaternion`: aktualny obrót stopy 3D (Pitch, Roll, Yaw)
  - `stepCount`: liczba kroków wykonanych daną stopą
  - `lastStepLengthMeters`: długość ostatniego kroku (m)
  - `maxStepHeightMeters`: maksymalne uniesienie stopy nad podłoże w kroku (m)
  - `totalDistanceMeters`: łączny przebyty dystans (m)
  - `trailPoints` & `footprints`: historia pozycji 3D do rysowania wstęgi ruchu oraz śladów stóp na siatce podłogi

### Mapowanie interakcji i komponentów

- **Obsługa dwóch instancji `TrikiBleManager` (`trikiBleLeft` / `trikiBleRight`)**:
  - Niezależne parowanie, odbiór powiadomień `0x6E400003`, wysyłanie komendy startowej `20 10 00 D0 07 68 00 03` oraz sterowanie zieloną diodą LED (`0x6E400004` / `0x6E400002`) dla każdego kapsla osobno.
- **Korekta wizualizacji 3D pojedynczego i podwójnego kapsla**:
  - Zastąpienie pierścienia RGB na rzecz fizycznie poprawnego układu: centralny wklęsły przycisk na środku $(0, 0)$ oraz zielona dioda LED umieszczona przy krawędzi na osi $+Y$.
- **Narzędzia przestrzeni 3D**:
  - Przycisk `Zeruj pozycję i ścieżkę (0,0,0)`, przycisk `Zamień L ⇄ P`, przełącznik `Widok: Buty z kapslem / Same kapsle`, przełącznik kamery oraz regulacja czułości detektora ZUPT.
