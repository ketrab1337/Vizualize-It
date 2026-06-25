# CLAUDE.md — Vizualize It

Ten plik czytasz automatycznie przy każdym uruchomieniu. Zawiera wszystkie reguły projektu.
Przed napisaniem jakiegokolwiek kodu przeczytaj ten plik w całości.

---

## Czym jest ten projekt

Desktopowa aplikacja dla szyldiarza do tworzenia fotorealistycznych wizualizacji szyldów z plexy.
Użytkownik importuje projekt SVG, przypisuje materiały (rodzaj plexy, kolor, dystanse),
konfiguruje LED, ustawia kąt kamery i generuje wizualizację przez AI.

**Jeden użytkownik. Jedno urządzenie. Narzędzie do pracy, nie produkt komercyjny.**

---

## Stack — nie zmieniaj bez pytania

| Warstwa | Technologia | Uwagi |
|---|---|---|
| Framework | Tauri 2.0 | Nie Electron, nie NW.js |
| Frontend | React + TypeScript + Tailwind CSS | Nie Vue, nie Svelte |
| Edytor SVG | Paper.js v0.12 + `@svgdotjs/svg.js` v3 | Nie Fabric.js, nie Konva |
| Baza danych | SQLite przez `tauri-plugin-sql` | Nie PostgreSQL, nie plik JSON |
| Klucze API | `tauri-plugin-keyring` | Windows Credential Manager |
| Widget 3D | Three.js r128 z CDN | Dokładnie ta wersja |
| Język UI | Polski | Wszystkie etykiety, komunikaty, błędy |

---

## Struktura projektu

```
Vizualize It/
  src/                        ← React/TypeScript frontend
    components/
      layout/                 ← Sidebar, MainArea, Tabs
      editor/
        Canvas.tsx            ← główny komponent edytora (Paper.js Tool + import SVG + useEffect-y)
        ElementPanel.tsx, LayersPanel.tsx, BackgroundPanel.tsx, CostPanel.tsx
        canvas/               ← czyste utils, podkomponenty JSX i hooki wyciągnięte z Canvas.tsx
          rulers.ts           ← drawHRuler/drawVRuler + stałe RULER_SIZE/BG/BORDER
          paperUtils.ts       ← exportSvgLayer, findItemByName, calcTotalLength/Area, fitViewToPage, parseSvgDimension/toMm
          resize.ts           ← HandleType, HANDLE_CURSORS, computeResizeDelta
          CanvasToolbar.tsx, ZoomWidget.tsx, CanvasContextMenu.tsx, DragOverlay.tsx
          useCanvasHistory.ts ← clipboard + undo/redo/copy/paste/delete
          useZoomActions.ts   ← przyciski zoom +/− , reset, ręczny procent
      generation/             ← LedPanel, CameraWidget, PromptPanel, ModelSelector
      gallery/                ← ImageGrid, CompareModal, ExportPanel
      settings/               ← ApiKeys, MaterialLibrary, BackgroundLibrary, Templates, PricingSettings, PromptPresets, ModelSettings (zakładki w SettingsView)
      ui/                     ← Button, Modal, Toast, ColorPicker (komponenty bazowe)
    hooks/                    ← useProject, useMaterials, useGeneration itp.
    stores/                   ← Zustand stores (nie Redux): projectStore, editorStore, generationStore, materialsStore, keysStore, toastStore, settingsStore
    lib/
      db.ts                   ← singleton getDb() (Database.load) — używaj WSZĘDZIE zamiast lokalnych kopii
      promptAssembler.ts      ← assemblePrompt() i buildCameraPrompt()
      paperCanvas.ts          ← saveFnRef i saveCanvasToStore()
      svgHelpers.ts           ← updateSvgWithOverrides() przez svg.js
    types/                    ← interfejsy TypeScript
  src-tauri/
    src/
      commands/               ← każda grupa komend w osobnym pliku
        projects.rs           ← create/delete + import_svg/import_background (z validate_slug)
        backgrounds.rs        ← add_background/delete_background (globalna biblioteka teł w data_dir/backgrounds/)
        generation.rs         ← generate_image (dispatcher po modelu), edit_image_angle, edit_background_angle, edit_image_inpaint (OpenAI mask), edit_image_marked (Gemini visual marker), get_abs_path, delete_image_file
        keyring.rs            ← set/get/delete/test_api_key + test_*_connection
        batch.rs              ← save/load/delete_batch_payload (validate_slug + UUID job_id)
        export.rs             ← export_offer_pdf, export_costs_pdf (check_within przy odczycie obrazów)
        path_guard.rs         ← validate_slug() i check_within() — używaj w KAŻDEJ komendzie operującej na ścieżkach
      providers/
        google_ai.rs          ← Nano Banana 2 / Pro
        openai.rs             ← GPT Image 2
        mod.rs                ← trait ImageGenerator
      db/
        migrations/           ← pliki SQL migracji (001_initial.sql .. 010_batch_jobs.sql)
      main.rs
      lib.rs                  ← invoke_handler! rejestracja komend + migracje
  CLAUDE.md                   ← ten plik
```

---

## Konwencje kodu — Frontend (TypeScript/React)

### Nazewnictwo
- Komponenty React: `PascalCase` (np. `MaterialCard.tsx`)
- Hooki: `camelCase` z prefixem `use` (np. `useProject.ts`)
- Pliki pomocnicze: `camelCase` (np. `promptAssembler.ts`)
- Typy/interfejsy: `PascalCase` z opisową nazwą (np. `SignElement`, `GenerationSession`)
- Stałe: `UPPER_SNAKE_CASE`

### Eksporty
- Komponenty: named export (nie default export)
  ```typescript
  // ✅ dobrze
  export function MaterialCard({ material }: MaterialCardProps) { ... }
  // ❌ źle
  export default function MaterialCard() { ... }
  ```
- Typy: zawsze named export z `types/index.ts`

### Struktura komponentu
```typescript
// 1. Importy zewnętrzne
// 2. Importy wewnętrzne
// 3. Typy/interfejsy lokalne
// 4. Komponent
// 5. Style (jeśli nie Tailwind)
```

### State management
- Lokalny state komponentu: `useState`
- State współdzielony między komponentami: Zustand store
- Nie używaj Context API do przekazywania danych między stronami
- Nie używaj Redux

### Tauri API
```typescript
// ✅ zawsze używaj invoke z typowaniem
import { invoke } from '@tauri-apps/api/core';
const result = await invoke<Project[]>('get_projects');

// ✅ argumenty: camelCase w JS, snake_case w Rust — Tauri 2 auto-konwertuje
// JS: invoke("save_batch_payload", { projectSlug: "...", jobId: "..." })
// Rust: pub async fn save_batch_payload(project_slug: String, job_id: String, ...) — działa
// NIE dodawaj #[serde(rename_all = "camelCase")] do struct argumentów

// ❌ nigdy nie wywołuj zewnętrznych API bezpośrednio z frontendu
const response = await fetch('https://api.openai.com/...'); // NIGDY
```

Wszystkie wywołania zewnętrznych API (Google AI, OpenAI) przechodzą **wyłącznie przez Rust backend**.

### Klucze API — frontend dostaje TYLKO bool
```typescript
// ✅ sprawdzenie czy klucz ustawiony — bool z keyring, klucz NIE wychodzi z Rusta
const isSet = await invoke<boolean>("test_api_key", { account: "google_ai" });

// ❌ nie wywołuj get_api_key z TypeScriptu — to zwróciłoby surowy klucz do JS heap
const key = await invoke<string>("get_api_key", { account: "google_ai" }); // NIGDY
```
`get_api_key` jest komendą Tauri, ale używa się jej WYŁĄCZNIE w Rust (np. providery AI, `test_*_connection`).

### Baza SQLite — singleton getDb()
```typescript
// ✅ jeden wspólny singleton z src/lib/db.ts
import { getDb } from "../lib/db";  // hooks/ i stores/
import { getDb } from "../../lib/db"; // components/X/

const db = await getDb();
await db.execute(`INSERT INTO ...`, [...]);

// ❌ nie kopiuj wzorca const DB_URL/let _db/async function getDb() do nowych plików
// Lokalne singletony per-moduł tworzyły wiele instancji Database
```

---

## Konwencje kodu — Backend (Rust)

### Nazewnictwo
- Funkcje komend Tauri: `snake_case` (np. `get_projects`, `import_svg`)
- Struktury: `PascalCase` (np. `GenerationSession`, `Material`)
- Moduły: `snake_case`

### Komendy Tauri
```rust
// ✅ każda komenda zwraca Result z opisowym błędem
#[tauri::command]
async fn generate_image(
    config: GenerationConfig,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<GeneratedImage>, String> {
    // ...
}

// ❌ nie używaj unwrap() w komendach
let result = something.unwrap(); // NIGDY w komendach
```

### Obsługa błędów
- Używaj `?` operator i propaguj błędy
- Konwertuj błędy do `String` tylko na granicy `#[tauri::command]`
- `thiserror` jest świadomie pominięte w Cargo.toml — błędy modułów wracają jako `Result<T, String>` lub `Result<T, std::io::Error>`. Jeśli złożoność wzrośnie, dodaj `thiserror` lokalnie i typy błędów per moduł.

### Walidacja ścieżek — zasada absolutna
KAŻDA komenda Tauri operująca na ścieżkach pliku/folderu MUSI walidować input. Pomocniki w `commands/path_guard.rs`:

```rust
use crate::commands::path_guard::{validate_slug, check_within};

#[tauri::command]
pub async fn moja_komenda(
    project_slug: String,    // walidacja: tylko [a-z0-9-]
    file_path: String,       // walidacja: musi leżeć w data_dir
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    validate_slug(&project_slug)?;
    let abs = state.data_dir.join(&file_path);
    check_within(&state.data_dir, &abs)?;  // canonicalize + starts_with
    // ... bezpieczne operacje na &abs
}
```

Dla identyfikatorów typu `job_id` wymuś format UUID:
```rust
use uuid::Uuid;
Uuid::parse_str(&job_id).map_err(|_| format!("Nieprawidłowe ID: '{job_id}'"))?;
```

### Klucze API — zasada absolutna
```rust
// ✅ zawsze odczytuj z keyring w momencie użycia
let api_key = keyring::get_api_key("google_ai")?;

// ❌ nigdy nie przechowuj klucza w pamięci dłużej niż potrzeba
// ❌ nigdy nie loguj klucza (mask_key_in_error w providerach)
// ❌ nigdy nie zapisuj do SQLite ani do pliku
// ❌ nigdy nie zwracaj surowego klucza do frontendu — udostępniaj bool przez test_api_key
```

---

## Absolutne zakazy — nigdy tego nie rób

### Klucze API
- ❌ NIE hardcoduj żadnych kluczy API w kodzie
- ❌ NIE zapisuj kluczy do SQLite
- ❌ NIE zapisuj kluczy do pliku na dysku
- ❌ NIE loguj kluczy (nawet częściowo)
- ❌ NIE wywołuj `get_api_key` z TypeScriptu — używaj `test_api_key` (bool)
- ✅ Klucze TYLKO przez `tauri-plugin-keyring` ↔ Windows Credential Manager

### Architektura
- ❌ NIE wywołuj zewnętrznych API (OpenAI, Google AI) z kodu TypeScript/React
- ❌ NIE używaj `localStorage` ani `sessionStorage` (Tauri ma własne API)
- ❌ NIE pisz logiki biznesowej w komponentach React (należy do hooków lub Rusta)
- ❌ NIE zmieniaj wersji Three.js (zostaje r128 — inne wersje mają inne API)
- ❌ NIE używaj `THREE.CapsuleGeometry` (dodana w r142, niedostępna w r128)
- ❌ NIE wracaj do Fabric.js ani Konva.js — edytor SVG to Paper.js
- ❌ NIE definiuj własnych `Database.load("sqlite:vizualizeit.db")` w nowych plikach — importuj `getDb` z `src/lib/db.ts`

### Baza danych
- ❌ NIE modyfikuj schematu SQLite bez tworzenia pliku migracji w `db/migrations/`
- ❌ NIE zmieniaj zawartości istniejących plików migracji (sqlx liczy SHA-384 i porównuje z `_sqlx_migrations.checksum` — mismatch = aplikacja nie startuje)
- ❌ NIE przechowuj binarnych danych (obrazy, zdjęcia) w SQLite — tylko ścieżki do plików

### Bezpieczeństwo
- ❌ NIE używaj user-provided ścieżek/identyfikatorów bez walidacji — wszystkie komendy z `path: String`/`slug: String`/`job_id: String` muszą wywołać `validate_slug` / `Uuid::parse_str` / `check_within` (patrz `commands/path_guard.rs`)
- ❌ NIE używaj `.unwrap()` ani `.expect()` w komendach `#[tauri::command]` (w `run()` można `unwrap_or_else` z log+exit)

### UI
- ❌ NIE używaj angielskich etykiet w UI — wszystko po polsku
- ❌ NIE używaj `<form>` HTML — zamiast tego `onClick`/`onChange` na elementach

---

## Uruchamianie projektu

```bash
# Instalacja zależności (pierwsze uruchomienie)
npm install

# Development (hot reload)
cargo tauri dev

# Build produkcyjny
cargo tauri build

# Tylko frontend (bez Tauri, do debugowania UI)
npm run dev
```

### Wymagania systemowe
- Node.js 20+
- Rust (stable, najnowszy)
- Windows 10/11 (Credential Manager)

---

## SQLite — schemat i migracje

### Zasady migracji
- Każda zmiana schematu = nowy plik w `src-tauri/src/db/migrations/`
- Nazewnictwo: `001_initial.sql`, `002_add_templates.sql` itp.
- Migracje rejestrowane w `src-tauri/src/lib.rs` (vec `migrations` przekazany do `SqlBuilder::add_migrations`)
- Migracje wykonywane automatycznie przy starcie aplikacji
- **Nigdy nie modyfikuj zawartości istniejącego pliku migracji** — sqlx liczy SHA-384 z bajtów pliku i porównuje z `_sqlx_migrations.checksum` w bazie użytkownika; mismatch zwraca `VersionMismatch` i aplikacja nie startuje
- Pisz migracje idempotentnie: `CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`, `CREATE INDEX IF NOT EXISTS` (SQLite nie wspiera `IF NOT EXISTS` dla `ALTER TABLE ADD COLUMN` — zawsze nowa migracja)

---

## Paper.js — zasady edytora SVG

### Podział plików (`src/components/editor/`)
- `Canvas.tsx` — stan komponentu + Paper.js Tool (mouseDown/Drag/Up/Click/Move) + useEffect-y (init, import SVG, drag&drop, ResizeObserver, keyboard, wheel). Tu zostaje wszystko co operuje na wielu refach naraz.
- `canvas/rulers.ts`, `canvas/paperUtils.ts`, `canvas/resize.ts` — czyste funkcje (bez stanu Reacta, bez refów). Dodawaj tu nowe utils zamiast do `Canvas.tsx`.
- `canvas/CanvasToolbar.tsx`, `ZoomWidget.tsx`, `CanvasContextMenu.tsx`, `DragOverlay.tsx` — JSX podkomponenty paska narzędzi i overlay-i.
- `canvas/useCanvasHistory.ts`, `canvas/useZoomActions.ts` — hooki przyjmujące refy z `Canvas.tsx` jako parametry (nie tworzą własnych refów do Paper.js).

Przy dodawaniu funkcji: jeśli to czysta funkcja → utils. Jeśli to JSX → podkomponent. Jeśli logika operuje na 3+ refach z `Canvas.tsx` — zostaw w `Canvas.tsx`, ekstrakcja do hooka tylko stworzy "fake hook" z 15+ parametrami.

### Architektura
- Import SVG: `paper.project.importSVG(svgString, { expandShapes: true })` — natywna obsługa viewBox, transformacji, stylów
- Zapis custom atrybutów: `updateSvgWithOverrides()` z `svgHelpers.ts` (przez `@svgdotjs/svg.js`)
- Custom attributes materiałów: `data-material`, `data-color`, `data-distance-material`
- Paper.js NIE zachowuje `data-*` przy imporcie — odczytaj je z DOMParser przed `importSVG`

### System warstw
```
Warstwa "svg"  ← importowany SVG, elementy do zaznaczania
Warstwa "ui"   ← nakładki (hover highlight, rubber band), elementy locked=true
```
- Po `paper.project.clear()` zawsze odtwórz obie warstwy i aktywuj `"svg"` przed importem
- Elementy UI: `item.locked = true` (wykluczone z hit testów)

### Paper.js Tool
- Jeden globalny `paper.Tool` tworzony przy inicjalizacji
- Eventy Tool dostępne przez `(event as unknown as { event: MouseEvent }).event`
- `onMouseClick` dostępny przez `(tool as unknown as { onMouseClick: ... }).onMouseClick`
- `toolCbRef` pattern: Tool deleguje do `toolCbRef.current` który zawsze wskazuje na aktualne callbacki

### Interakcja
- Kliknięcie LPM → `hitTest` → zaznaczenie elementu (ustawia `selectedElementId` w store)
- Shift+kliknięcie → wielokrotne zaznaczenie
- Drag na pustym obszarze → zaznaczanie prostokątem (rubber band)
- Drag na zaznaczonym elemencie → przesuwanie
- Środkowy przycisk myszy → pan widoku
- Ctrl+scroll → zoom do kursora

### Wymiary i długość ścieżek
- `path.length` zwraca długość w jednostkach SVG
- Przelicznik mm: odczytaj `width` i `viewBox` z SVG → `mmPerUnit = toMm(widthAttr) / viewBoxWidth`
- Wyniki zapisuj do `selectedItemBounds` w editorStore (odczytuje ElementPanel)

### Zapis stanu
```typescript
// saveFnRef.current() → updateSvgWithOverrides(svgContent, nodeOverrides) → setSvgContent(updated)
// isSavingRef zapobiega pętli: setSvgContent → useEffect → reimport
```

---

## Adaptery AI

### Co lata do AI z edytora — KOMPOZYT (nakładka SVG wtopiona w zdjęcie)
**`captureCanvas()` w `src/lib/paperCanvas.ts`** zwraca `{ designPngBase64, scenePngBase64, compositePngBase64 }`, z których `useGeneration.ts` wybiera zależnie od sceny:

- **Szyld/produkty na realnym tle** (typowy) → `compositePngBase64` jako `svg_image` (Obraz 1) — nakładka SVG narysowana na zdjęciu. **Rozmiar i proporcje niesie sama nakładka (pixel-perfect), a prompt każe model wyrenderować ją W PERSPEKTYWIE ściany.** To sprawdzona formuła z 22.06 (patrz niżej). Historia (czego NIE robić): kompozyt z promptem „ten sam obszar + identyczne proporcje" kotwiczył frontalnie; osobny projekt + półprzezroczysty axis-aligned footprint TEŻ kotwiczył frontalnie / psuł rozmiar; rozdzielenie + rozmiar „słownie" gubiło rozmiar (model przesadzał). Zwycięzca: **kompozyt + prompt rozdzielający „pozycja/regiony z nakładki" od „kąt z fotografii".**
  - `designPngBase64` = czysty render warstwy SVG na neutralnym jasnoszarym (`#e9e9ec`), wyśrodkowany — używany TYLKO gdy NIE ma tła.
  - `scenePngBase64` = samo zdjęcie ściany (`object-fit: cover` viewportu) — używane TYLKO gdy jest tło, ale NIE ma geometrii szyldu. **Renderowane z `backgroundImgRef` (`<img>`)** — NIE przez `dataUrlToBase64(backgroundDataUrl)`, bo `backgroundDataUrl` bywa `blob:` URL (ładowanie projektu w `useProject`), na którym `dataUrlToBase64` zwraca `null` i tło nie dociera do modelu.
- **Sam projekt bez tła** → `designPngBase64` jako `svg_image`.
- **Samo tło bez geometrii szyldu** → `scenePngBase64` jako `background_image`.

Kolejność w backendzie (oba providery): `background_image` → `svg_image` → referencje. OpenAI `generate_via_edits` wysyła OBA sloty gdy oba są ustawione (poprawione — wcześniej tylko jeden).

**NIE rysujemy wizualnych etykiet** — wcześniejsza wersja rysowała żółte plakietki z `item.name`, ale Gemini dosłownie je renderował na szyldzie (np. `svg_item_0_4` jako tekst na czerwonej plexie). Identyfikatory elementów lecą tylko tekstem w prompt (`assemblePrompt`), nie wizualnie.

**AI rozpoznaje elementy po kolorze hex z SVG.** Prompt zawiera: `"element koloru #FF0000 → Plexa czerwona z połyskiem"`. Kolory hex pochodzą z `override.fill` (`SignElement.colorHex`) i są wpisywane w prompcie zamiast etykiet tekstowych.

**Nie modyfikuj `captureCanvasFnRef` żeby był synchronous** — wymaga rysowania DOM-image, robione synchronicznie z `<img>` ref. Tło ładuje się przy zmianie `backgroundDataUrl`, ref ustawiamy w JSX `<img ref={backgroundImgRef}>`.

### Assembler promptu — co opisuje strukturę obrazów
`assemblePrompt(config, visualInputs, options)` zaczyna od **bardzo silnego imperatywnego ZADANIA** (Google docs zalecają tekst PRZED obrazami). Gałąź wybierana po `hasSvg`/`hasBackground`/`hasProducts`:

- **Szyld + tło** — typowy, KOMPOZYT (nakładka na zdjęciu, 1 obraz `imgIdx++`): sprawdzona formuła **22.06**. Kluczowa myśl — rozdzielić „CO i GDZIE" od „pod jakim KĄTEM": `"ZADANIE: edytuj Obraz 1... Zastąp SAMĄ nakładkę renderem szyldu... Nakładka SVG to płaski, FRONTALNY schemat — wyznacza WYŁĄCZNIE położenie środka, kształt, regiony i kolory; NIE wyznacza finalnego kąta patrzenia. Ściana widziana pod kątem, więc szyld LEŻY na płaszczyźnie ściany; sylwetka MUSI być skrócona perspektywicznie... NIE renderuj go jako frontalnego prostokąta... Zachowaj WZAJEMNY układ/proporcje/kolor regionów względem siebie."` Te dwa negatywy („NIE wyznacza kąta", „NIE renderuj frontalnego prostokąta") są SILNIKIEM fixu — nie usuwaj ich „bo Google nie lubi negatywów". Stara, ZEPSUTA wersja: „musi zajmować DOKŁADNIE ten sam obszar + identyczne proporcje, ale w perspektywie" — sprzeczność, która kotwiczyła frontalnie.
- **Sam SVG bez tła**: `"ZADANIE: fotorealistyczny render. Obraz 1 to schematyczny projekt SVG... neutralne tło."`
- **Samo tło bez SVG**: `"ZADANIE: dodaj szyld do istniejącego zdjęcia..."` / produkty → `"ZADANIE: edycja zdjęcia..."` (+ klauzula wtapiania produktów).

**Teksty z SVG** wyciągane przez `extractSvgTexts(svgContent)` w `useGeneration.ts` (parsuje `<text>` i `<tspan>`) → trafiają do `visualInputs.svgTexts` → prompt: `"TEKSTY NA SZYLDZIE (odwzoruj DOSŁOWNIE): 'Green-partners.pl'"`. Bez tego Gemini modyfikuje teksty (`"G&N partners"`, `"GREEN PARTNER INTERNATIONAL"`).

**Materiały opisane WYŁĄCZNIE po kolorze hex** z 2 trybami (`describeElementMaterial` w `promptAssembler.ts`). Zdjęcia referencyjne materiałów zostały świadomie usunięte — błyszcząca/lustrzana plexa z odbiciami myliła model, a hex + typ powierzchni dają stabilniejszy wynik:

1. **`material_type = "lustro"`** → kolor jako TINT (nie main color): `"...polished mirror-finish acrylic panel with a subtle #FFD700 tint, primarily reflecting the surrounding environment (#FFD700 is the tint hue, not the dominant surface color)..."`. Lustro odbija otoczenie, więc bez tego zastrzeżenia AI dostawała sprzeczne sygnały (`kolor #FFD700` vs `mirror reflects environment`).
2. **`material_type = "polysk"` / inne typy** → kolor jako własny kolor materiału + opis powierzchni z `MATERIAL_TYPE_DESCRIPTIONS` (standard).

Numeracja "Obraz N" (scena → zdjęcia referencyjne użytkownika) musi być spójna z faktyczną kolejnością obrazów wysyłanych w `useGeneration.ts`.

**Ważne — szyld na tle idzie KOMPOZYTEM (nakładka), nie rozdzielonymi obrazami:** `useGeneration.ts` wysyła `compositePngBase64` jako `svg_image`. Rozmiar/proporcje masz z nakładki (pixel-perfect), perspektywę wymusza prompt 22.06. Próbowano i ODRZUCONO: (1) rozdzielone obrazy (zdjęcie + osobny projekt) — perspektywa OK, ale rozmiar zgadywany/za duży; (2) footprint (półprzezroczysty prostokąt na zdjęciu) — axis-aligned prostokąt = frontalna kotwica. Kompozyt + prompt rozdzielający „pozycja/regiony z nakładki" od „kąt z fotografii" dał najlepszy kompromis (rozmiar pixel-perfect, perspektywa ~3/5, do podkręcenia promptem). Produkty `<image>` też idą kompozytem.

**Nano Banana 2 + tło**: model flash często ignoruje tło mimo imperatywnego promptu — dla projektów z tłem lepszy efekt daje NB Pro lub GPT Image 2. (Wcześniejsza wersja `ModelSelector.tsx` pokazywała żółte ostrzeżenie w tej sytuacji; zostało świadomie usunięte — informacja zostaje tu jako wskazówka produktowa.)

**`material_type` (matowa/mleczna/polysk/lustro)** — przekładany na opisową frazę przez `MATERIAL_TYPE_DESCRIPTIONS` w `promptAssembler.ts`. `lustro` → `"lustrzana, w pełni refleksyjna, odbija otoczenie"`. Bez tego AI nie wie czy plexa jest matowa czy z połyskiem.

### Jedna komenda `generate_image` z dispatcherem po modelu
Frontend wywołuje **jedną** komendę niezależnie od dostawcy:

```typescript
const files = await invoke<GeneratedImageFile[]>("generate_image", {
  input: { project_slug, model: "nano-banana-2" | "nano-banana-pro" | "gpt-image-2", ... }
});
```

Backend (`commands/generation.rs::generate_image`) rozgałęzia po `input.model`:
```rust
let provider: Box<dyn ImageGenerator> = match input.model.as_str() {
    "nano-banana-pro" => Box::new(GoogleAiProvider::nano_banana_pro()),
    "nano-banana-2"   => Box::new(GoogleAiProvider::nano_banana_2()),
    "gpt-image-2"     => Box::new(OpenAiProvider::new()),
    other => return Err(format!("Nieznany model: '{other}'.")),
};
```

### Google AI (Nano Banana 2 / Pro)
- Nano Banana 2: model `gemini-3.1-flash-image-preview`
- Nano Banana Pro: model `gemini-3-pro-image-preview`
- Endpoint live: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Endpoint batch: `https://generativelanguage.googleapis.com/v1beta/models/{model}:batchGenerateContent` — 50% taniej z 24h SLA
- Body batcha: camelCase pola (`displayName`, `inputConfig`, `inlinedResponses`)
- `poll_batch` defensywnie obsługuje wiele wersji nazw stanów (`JOB_STATE_*` legacy i `BATCH_STATE_*` aktualne) oraz ścieżek do `inlinedResponses` (`response.output.inlinedResponses.inlinedResponses[]` aktualna, oraz starsze warianty)
- **Krytyczne — count > 1**: image-preview modele NIE wspierają `candidateCount > 1` (`400: "Multiple candidates is not enabled for this model"`). `build_request` ZAWSZE ustawia `candidate_count: None`. Dla count > 1:
  - Live (`generate`): `tokio::spawn` N równoległych wywołań `single_call_generate`, zbieramy wyniki
  - Batch (`submit_batch`): N kopii żądania w `inputConfig.requests.requests[]` z różnymi `metadata.key` (`vizualize-it-1`, `-2`, ...). `poll_batch` zbiera obrazy ze wszystkich `inlinedResponses[]`

### OpenAI (GPT Image 2)
- Model: `gpt-image-2` (wydany 21 kwietnia 2026 — snapshot `gpt-image-2-2026-04-21`)
- **Generowanie z obrazami wejściowymi (LIVE)** → `POST https://api.openai.com/v1/images/edits` (multipart):
  - `/v1/images/generations` **nie przyjmuje obrazów wejściowych** (tylko `prompt: string`) — tło, SVG, referencje byłyby ignorowane
  - Routing w `OpenAiProvider::generate()`: są obrazy → `generate_via_edits` → `/v1/images/edits`. Brak obrazów → klasyczne `/v1/images/generations`
  - **Dlaczego NIE `/v1/responses` dla live:** Responses API wymaga chat-modelu na top-levelu (`gpt-4o`/`gpt-5...`); `gpt-image-2` zwraca tam 400 „model not found". `/v1/images/edits` woła `gpt-image-2` bezpośrednio (multipart `image[]`: pierwszy = scena/kompozyt, kolejne = zdjęcia referencyjne użytkownika; opcjonalna `mask`)
  - **count > 1 live:** `/v1/images/edits` natywnie obsługuje parametr `n` — jedno wywołanie zwraca N obrazów (bez równoległych spawnów)
  - BEZ pola `response_format` — `gpt-image-2` je odrzuca (zawsze zwraca base64)
- Edycja kąta / inpainting: `POST https://api.openai.com/v1/images/edits` (multipart, `image[]` wieloobrazowy + opcjonalna `mask`) → `edit_with_mask_inner`
- Batch API (`/v1/batches`) — endpoint w JSONL zależny od obecności obrazów (świadoma niespójność z live, bo Batch API obsługuje TYLKO endpointy serializowalne do JSONL — multipart `/v1/images/edits` się nie serializuje):
  - Są obrazy → endpoint w JSONL: `/v1/responses` (JEDYNY multi-image endpoint w Batch API; top-level model = `gpt-5.4-mini` jako orchestrator wołający `image_generation` tool z `model: gpt-image-2`)
  - Brak obrazów → endpoint w JSONL: `/v1/images/generations` (text-only, parametr `n` natywnie obsługuje multi-output)
  - **count > 1 w batchu:** `/v1/responses` zwraca 1 obraz na call → dla `count > 1` `submit_batch` tworzy N linii JSONL z różnymi `custom_id` (`vizualizeit-request-1`, `-2`, ...). Text-only: jedna linia z `n: count`.
  - `poll_batch` iteruje po liniach JSONL i zbiera obrazy z każdej. Rozpoznaje oba formaty wyniku: `body.data[].b64_json` (generations) lub `body.output[]` z `image_generation_call.result` (responses)
- 50% zniżki działa automatycznie po stronie OpenAI dla każdego wspieranego endpointu w batchu, włącznie z `/v1/responses` z image_generation tool
- Uwaga: wymaga weryfikacji organizacji w OpenAI Developer Console (`openai.rs` mapuje 403 na zrozumiały komunikat)

### Wspólny trait (src-tauri/src/providers/mod.rs)
```rust
#[async_trait::async_trait]
pub trait ImageGenerator: Send + Sync {
    async fn generate(&self, config: GenerationConfig) -> Result<Vec<GeneratedImage>, String>;
    async fn edit(&self, image: Vec<u8>, prompt: String) -> Result<GeneratedImage, String>;
}
```

### `edit_image_angle` / `edit_background_angle`
Te komendy obecnie zawsze używają Google AI (`GoogleAiProvider::nano_banana_2()`) niezależnie od modelu generowania. Edycja kąta dla OpenAI nie jest jeszcze podłączona.

### Edycja wizualizacji — jeden zunifikowany modal

**`EditImageModal`** łączy edycję tekstową i inpainting w jednym UI:
- **Bez maski** (puste płótno) → wywołuje `edit_image_angle` z modelem z `useSettingsStore.editTextModel` (Google Gemini lub OpenAI)
- **Z maską + OpenAI** (`editTextModel === "gpt-image-2"`) → `edit_image_inpaint` z natywną maską przez `/v1/images/edits` (najlepsza jakość)
- **Z maską + Google** (`nano-banana-2` / `nano-banana-pro`) → `edit_image_marked` z visual marker. Gemini API nie obsługuje masek jako parametru, więc frontend komponuje obraz z półprzezroczystym czerwonym overlay-em w miejscu maski i instruuje model wprost w prompcie: *„edytuj tylko obszar zaznaczony na czerwono, sam kolor pomiń w wyniku, resztę obrazu zachowaj"*

**Funkcje canvasa:**
- Dwa stackowane canvasy (obraz + warstwa maski z CSS opacity 0.5)
- Pędzel + gumka + slider rozmiaru (8–200px) z **live podglądem** (kółko skalujące się obok slidera) — `BrushPreview` subcomponent
- **Zoom**: scroll = zoom do kursora; **Pan**: shift+drag lub środkowy przycisk; reset zoom w toolbarze
- **Undo/Redo** stosem snapshotów (`ImageData`) z DragulationRefów (max 25); skróty Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
- Pointer events z `setPointerCapture` dla płynnego draggingu

**Eksport maski (OpenAI):** `exportMaskBase64()` — hidden canvas → fill `white` opaque → `globalCompositeOperation = "destination-out"` → `drawImage(maskCanvas)` → piksele PRZEZROCZYSTE (alpha=0) tam gdzie pomalowano (konwencja `/v1/images/edits` OpenAI)

**Eksport obrazu z visual marker (Google):** `exportImageWithOverlay()` — hidden canvas → `drawImage(imageCanvas)` → `globalAlpha=0.55; drawImage(maskCanvas)` → wynik to oryginał z półprzezroczystym czerwonym overlay-em. Wysyłane jako pojedynczy obraz do Gemini z instrukcją w prompcie.

**Backend:**
- `edit_image_angle` i `edit_background_angle` przyjmują pole `model: Option<String>` (default `nano-banana-2`); dispatcher w `build_edit_provider` wybiera providera
- `edit_image_inpaint(project_slug, file_path, mask_base64, prompt)` → `OpenAiProvider::edit_with_mask_inner` → multipart `POST /v1/images/edits` z `image`, `mask`, `prompt`, `model=gpt-image-2`
- `edit_image_marked(project_slug, image_base64, prompt, model)` → `build_edit_provider(model)` → `provider.edit(image, prompt)`. Używane przez frontend gdy maska + Google. Backend nie wie nic o masce — dostaje gotowy skomponowany obraz z markerem.
- `edit_with_mask_inner` jest **inherent metodą** na `OpenAiProvider` (nie częścią traita `ImageGenerator`) — tylko OpenAI obsługuje natywną maskę

---

## Ustawienia globalne — `useSettingsStore` + tabela `app_settings`

Migracja 012 dodaje generyczną tabelę key-value:
```sql
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME ...);
```

`src/stores/settingsStore.ts` zawiera Zustand store z:
- `editTextModel: AiModel` — model do edycji tekstowej (bez maski)
- `changeAngleModel: AiModel` — model do zmiany kąta (widget 3D w `ChangeAngleModal`)
- `loadSettings()` — wczytaj z DB (w `App.tsx` przy starcie)
- Setters — natychmiastowy UPSERT do tabeli `app_settings`

UI: zakładka „Modele AI" w `SettingsView` → `ModelSettings.tsx` z reuzywalnym komponentem `Dropdown` (z `components/ui/Dropdown.tsx`) w layoucie label↔dropdown. Jedno ustawienie „Edycja wizualizacji" stosowane zarówno do edycji tekstowej, jak i z maską — OpenAI ma natywną maskę, Google używa visual marker (overlay) w obrazie.

### SettingsView — sub-sidebar zamiast top tabów

`SettingsView.tsx` ma własny lewy sidebar (`w-56`) z zakładkami ustawień (Biblioteka materiałów, Biblioteka teł, Klucze API, Szablony, Presety promptu, Stawki cięcia, Modele AI). Nagłówek „Ustawienia" jest w sidebarze. **Brak przycisku zamykania** — nawigacja jest swobodna przez główny lewy Sidebar (`components/layout/Sidebar.tsx`):

- Klik logo „Projekty" lub zakładki projektu (Edytor/Generowanie/Galeria) → `onLeaveSettings()` automatycznie zamyka SettingsView i pokazuje wybrany widok
- Klik ikonki „Ustawienia" w głównym Sidebar → otwiera SettingsView

---

## Globalna biblioteka teł

Użytkownik dodaje raz pliki JPG/PNG/WebP w **Ustawienia → Biblioteka teł** (`BackgroundLibrary.tsx`), a potem wybiera je w edytorze jako tło projektu.

- **Storage**: pliki w `data_dir/backgrounds/` (z prefiksem UUID), metadane w tabeli `background_library` (migracja 022). Stan i miniaturki w `stores/backgroundsStore.ts` (`thumbs` = blob URL-e przez `lib/imageBlob.ts::fileToBlobUrl`, scope plugin-fs `$DOCUMENT/**`).
- **Komendy Rust** (`commands/backgrounds.rs`): `add_background(source_path)` → kopiuje do `backgrounds/`, zwraca `{ path, mime, name }`; `delete_background(path)` (check_within). Wpis/usuwanie wiersza DB robi frontend (SQL).
- **Użycie w edytorze**: `BackgroundPickerModal.tsx` (galeria miniatur) → po wyborze Canvas woła ISTNIEJĄCĄ `import_background(slug, sourcePath=plik_z_biblioteki)`, która **kopiuje** tło do `projects/{slug}/assets/`. Dzięki temu usunięcie tła z biblioteki NIE psuje projektów (mają własne kopie). Reszta pipeline'u (generowanie czyta `backgroundPath`/`backgroundDataUrl`) bez zmian.
- **Pasek edytora** (`CanvasToolbar.tsx`): „Dodaj tło" (plik ad-hoc z dysku, jak dotąd) + „Z biblioteki" (modal) + „Zapisz do biblioteki" (`add_background(backgroundPath)` na bieżącym tle projektu).

---

## Widget 3D kamery

Źródło: `https://huggingface.co/spaces/linoyts/Qwen-Image-Edit-Angles/raw/main/app.py`
Przepisz sekcje `CAMERA_3D_HTML_TEMPLATE` i `CAMERA_3D_JS` z Pythona na TypeScript + Three.js.

### Parametry snap (rozszerzone vs oryginał Qwen)
```typescript
const ROTATE_STEPS = [-90, -75, -60, -45, -30, -15, 0, 15, 30, 45, 60, 75, 90];  // co 15°
const FORWARD_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];                         // co 1
const TILT_STEPS = [-1, -0.5, 0, 0.5, 1];                                         // 5 kroków = 5 stanów promptu
```

`buildCameraPrompt` w `promptAssembler.ts` produkuje opis **WYNIKOWEGO widoku** (z której strony / odległości / wysokości widać szyld), nie samą relatywną komendę „obróć kamerę" — przy generowaniu od zera model nie ma punktu odniesienia dla rotacji. **Tylko po polsku** (Gemini/GPT Image są wielojęzyczne, a reszta promptu jest PL — spójność + brak ryzyka obcych artefaktów w tekście na szyldzie; wcześniejsza wersja bilingwalna PL+ENG wzorowana na Qwen została świadomie usunięta, bo ta aplikacja nie używa Qwen):
- Rotacja: `"Pokaż szyld w ujęciu trzy-czwarte z lewej strony, pod kątem ~30°."` (rotateDeg > 0 → lewa strona)
- Forward (prógi, **`5` = neutralny środek suwaka „Średnio" → BRAK frazy**, żeby sama zmiana kąta nie wstawiała przypadkowej odległości): `>=9` bardzo bliskie, `>=7` z bliska, `>=6` lekko przybliżone, `==5` brak, `>=3` z nieco większej odległości, `>=1` szersze ujęcie, `<1` z daleka (uliczne)
- Tilt — **dwa poziomy**, progi dopasowane do kroków suwaka (`TILT_STEPS` co 0.2, każdy niezerowy krok od `0.2`=„20%" daje frazę): `|t|>=0.7` mocno (+„żabia perspektywa"/„z lotu ptaka"), `>=0.15` lekko; `|t|<0.15` (neutralnie) bez frazy. Znak: `t>0` → z dołu (żabi), `t<0` → z góry (ptasi). Wcześniej próg startował od 0.3 i połykał krok ±0.2 po cichu — to był bug.

**Kamera pomijana przy projektach z TŁEM**: `assemblePromptFragments` dokleja fragment kamery tylko gdy `options.cameraDirty && !visualInputs.hasBackground`. Przy tle perspektywę dyktuje zdjęcie (gałąź ZADANIA blokuje „perspektywa i kąt kamery bez zmian"), więc „obróć kamerę" tworzyłoby sprzeczność. Kąt dla projektów z tłem zmienia się przez `edit_background_angle` (przycisk „Zastosuj kąt do tła" w `CameraAngleSection`); `CameraAngleSection` pokazuje wtedy podpowiedź, że główne generowanie zachowuje perspektywę zdjęcia. Edycja kąta gotowego obrazu w galerii → `edit_image_angle` (`ChangeAngleModal`).

### Kolory uchwytów (identyczne jak oryginał)
- Zielony `#4CAF50` — rotacja lewo/prawo
- Różowy `#E91E8C` — tilt góra/dół
- Pomarańczowy `#FF6B00` — odległość

### Animacja snap
- Easing: cubic-out, czas: 200ms
- Podgląd promptu kamerowego: overlay na dole widgetu, aktualizuje się na żywo

---

## Assembler promptu

Implementacja w `src/lib/promptAssembler.ts`.

Kolejność części promptu (nie zmieniaj):
1. Wstęp ("Fotorealistyczna wizualizacja szyldu...")
2. Materiały per komponent
3. Dystanse (jeśli zaznaczone)
4. Konfiguracja LED
5. Kąt i odległość kamery (`buildCameraPrompt()`)
6. Tło / lokalizacja (jeśli dodane)
7. Prompt użytkownika
8. Stałe końcowe dla jakości obrazu

### Prompty osobne per dostawca (Google vs OpenAI)

Pomocnik `lib/provider.ts::providerForModel(model)` mapuje model → `"gemini"` (oba Nano Banana) lub `"openai"` (GPT Image 2). Używają go assembler (`targetModel`), `useGeneration`, `useAssembledPrompt`, `generationStore`.

- **A — auto-prompt różny per dostawca**: `assemblePromptFragments` czyta `options.targetModel`. Gałąź Gemini jest bazowa (dopracowana pod Nano Banana); dla OpenAI dokładamy w gałęziach scen z tłem krótkie wzmocnienie semantyki edycji (`/v1/images/edits` edytuje Obraz 1 jako płótno). Miejsce na różnicowanie: `openaiEditClause` w `promptAssembler.ts`.
- **B — osobne RĘCZNE prompty**: `generationStore.promptByProvider: { gemini, openai }` to źródło prawdy. `prompt` to aktywne nadpisanie BIEŻĄCEGO dostawcy (pochodna). `setModel` przełącza `prompt` na zapisany prompt dostawcy nowego modelu; `setPrompt` zapisuje do dostawcy bieżącego modelu. Snapshot trzyma `promptByProvider` (stary snapshot z pojedynczym `prompt` → fallback na oba). `PromptPanel` pokazuje plakietkę dostawcy przy nagłówku „Prompt".
- Presety, LED, kamera, środowisko pozostają WSPÓLNE (to klocki auto-promptu; różnice per dostawca robi A lub ręczny prompt B).

---

## Galeria — ZoomableImage

Komponent `ZoomableImage` (w `ImageGrid.tsx` i `CompareModal.tsx`) obsługuje zoom scrollem i pan przeciąganiem.

### Jeden stan, atomowy update
```typescript
const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
```
Nigdy nie rozdzielaj na `useState(scale)` + `useState(translate)` — dwa osobne setState powodują odczyt nieaktualnej wartości scale w momencie aktualizacji translate.

### Formuła zoom do kursora
```typescript
// cx, cy = pozycja kursora względem ŚRODKA kontenera (nie lewego górnego rogu)
const cx = e.clientX - rect.left - rect.width / 2;
const cy = e.clientY - rect.top - rect.height / 2;

setView((prev) => {
  const next = Math.max(1, Math.min(8, prev.scale * step));
  if (next === 1) return { scale: 1, tx: 0, ty: 0 };
  const f = next / prev.scale;
  return { scale: next, tx: cx * (1 - f) + prev.tx * f, ty: cy * (1 - f) + prev.ty * f };
});
```
Wyprowadzenie: punkt pod kursorem ma współrzędną u = (mouse - center - tx) / scale. Po zoomie musi nadal być pod kursorem → tx_new = cx*(1-f) + tx_old*f.

### CSS transform
```css
transform: translate(${view.tx}px, ${view.ty}px) scale(${view.scale});
transform-origin: 50% 50%;
```
`transformOrigin: center` + translate = przesunięcie środka elementu o (tx, ty) viewport-pikseli od centrum kontenera (flex centering gwarantuje że środek obrazu = środek kontenera przy scale=1).

---

## Tryb batch — prawdziwy Batch API z 50% zniżką

Korzysta z **prawdziwego Batch API dostawców** (OpenAI `/v1/batches` i Google AI `:batchGenerateContent`). Generowanie idzie w 24h SLA z połową kosztu normalnego API.

### Cykl życia zadania
```
pending → running → done | error | cancelled
```
- `pending`: zapisane lokalnie, jeszcze niewysłane do dostawcy (transient — `useBatchJobs` natychmiast wywołuje submit)
- `running`: wysłane do Batch API, czeka na wynik (do 24h)
- `done`: ukończone, obrazy w galerii
- `error`: błąd po stronie dostawcy lub w trakcie wysyłania
- `cancelled`: anulowane przez użytkownika (z propagacją do dostawcy jeśli już wysłane)

### Frontend (`useBatchJobs.ts`)
- Polling co **30 sekund** (nie 4s — batch trwa godziny, częsty polling nie ma sensu)
- `submitJob(job)` na pending → wywołuje `submit_batch_to_provider` → zapisuje `provider_batch_id` w DB, status=running
- `pollJob(job)` na running → wywołuje `poll_batch_status` → jeśli `succeeded` zapisuje sesję+obrazy, jeśli `failed`/`cancelled` zamyka zadanie
- `cancelJob(job)` → wywołuje `cancel_batch_at_provider` jeśli zadanie zostało już wysłane do dostawcy
- `inFlightRef: Set<job_id>` — zapobiega podwójnym wywołaniom submit/poll dla tego samego zadania

### Komendy Rust (`commands/batch.rs`)
```rust
// Lokalne — payload zapisany na dysku przed wysłaniem do dostawcy
save_batch_payload(project_slug, job_id, payload_json) → Result<()>
delete_batch_payload(project_slug, job_id) → Result<()>
// (load_batch_payload nie istnieje jako komenda — odczyt jest wewnątrz submit_batch_to_provider)

// Batch API dostawców
submit_batch_to_provider(job_id, project_slug) → SubmitBatchOutput { batch_id, input_file_id? }
poll_batch_status(job_id, project_slug, model, batch_id) → PollBatchOutput (pending/running/succeeded/failed/cancelled)
cancel_batch_at_provider(model, batch_id) → ()
```
Każda waliduje `slug` przez `validate_slug()` i `job_id` przez `Uuid::parse_str()`.

### Trait `ImageGenerator` (`providers/mod.rs`)
Rozszerzony o metody batch:
```rust
async fn submit_batch(&self, config: GenerationConfig) -> Result<BatchSubmit, String>;
async fn poll_batch(&self, batch_id: &str) -> Result<BatchPoll, String>;
async fn cancel_batch(&self, batch_id: &str) -> Result<(), String>;
```
`BatchPoll` to enum: `Pending | Running | Succeeded { images } | Failed { error } | Cancelled`.

### OpenAI (`providers/openai.rs`)
1. **Submit**: POST `/v1/files` (multipart, `purpose=batch`) z plikiem JSONL → POST `/v1/batches` z `endpoint: "/v1/images/generations"` i `completion_window: "24h"` → zwraca `batch_xxx` ID
2. **Poll**: GET `/v1/batches/{id}` → status `validating | in_progress | finalizing | completed | failed | expired | cancelled`. Po `completed`: GET `/v1/files/{output_file_id}/content` → parsuj JSONL → dekoduj base64 obrazy
3. **Cancel**: POST `/v1/batches/{id}/cancel`

### Google AI (`providers/google_ai.rs`)
1. **Submit**: POST `/v1beta/models/{model}:batchGenerateContent` z `batch.inputConfig.requests.requests[]` (inlined requests) → zwraca operation name `batches/XXX`
2. **Poll**: GET `/v1beta/{batch_name}` → state `JOB_STATE_PENDING | RUNNING | SUCCEEDED | FAILED | CANCELLED | EXPIRED`. Po SUCCEEDED: parsuj `response.inlinedResponses[].response.candidates[].content.parts[].inlineData`
3. **Cancel**: POST `/v1beta/{batch_name}:cancel`

### Dlaczego payload na dysku, nie w SQLite
Payload zawiera base64 tła + kompozytu SVG + zdjęć referencyjnych (może być kilka MB). SQLite nie przechowuje binarnych danych — ścieżka pliku zapisana w bazie, dane w `projects/{slug}/batch/{job_id}.json`.

### Schema (migracja 011)
```sql
ALTER TABLE batch_jobs ADD COLUMN provider_batch_id TEXT;
ALTER TABLE batch_jobs ADD COLUMN provider_input_file_id TEXT;
```
`provider_batch_id` to identyfikator po stronie dostawcy (`batch_xxx` lub `batches/xxx`). `provider_input_file_id` używane tylko przez OpenAI (do ew. usunięcia pliku JSONL po zakończeniu).

---

## Wycena — globalne stawki cięcia

Tabela `cutting_rates_global` (migracja 009) — stawki per **kategoria materiału** + grubość, nie per konkretny materiał.

```sql
cutting_rates_global(id, category TEXT, thickness_mm REAL, price_per_m REAL, UNIQUE(category, thickness_mm))
```

- Zarządzane w `SettingsView` → zakładka „Stawki cięcia" (`PricingSettings.tsx`)
- `useMaterialsStore.globalCuttingRates` + `refreshGlobalRates()`
- `src/lib/pricing.ts`: `findGlobalCuttingRate(material, thickness)` szuka po `material.category`
- Formularz dodawania materiału **nie zawiera** stawki cięcia (jest globalna)

### Grupowanie kosztów w CostPanel
`PricingSummary.groupedItems: GroupedCostItem[]` — elementy pogrupowane po `(lineType, materialName, thicknessMm)`. `GroupedRow` w `CostPanel.tsx` pokazuje wiersz sumaryczny z chevronem rozwijającym szczegóły per-element.

---

## Komunikacja z użytkownikiem

- Przy wątpliwościach implementacyjnych: zaproponuj dwa podejścia i zapytaj które preferuje

---

*Ostatnia aktualizacja: 2026-06-25*
