# ClipForge
Gratis webbapp som gör långa videor till korta vertikala klipp. Ingen server, inget konto, inga krediter, inget vattenmärke. Allt körs i webbläsaren.

## Kör
    npm install
    npm run dev       # Chrome/Edge rekommenderas
    npm run build     # statisk sajt i dist/ -> Vercel / Netlify / GitHub Pages (base är './')

## Funktioner
Upload (MP4/MOV/WebM/M4V) → Whisper-transkribering (sv/en auto, ordtider) → klippförslag 15–90 s med viralpoäng + förklaring (lokal heuristik, valfritt LLM) → redigering → export (ZIP, 720p/1080p, 9:16 / 1:1 / 4:5).
- Transkriptredigerare: klicka ord för att ta bort, flytta start/slut, redigera text, ta bort fyllnadsord, klipp tystnader.
- Reframing: blurrad bakgrund eller smart beskärning (MediaPipe-ansiktsspårning) + manuell beskärning per klipp.
- Undertexter: ord-för-ord-markering, 9 presets, färg/position/storlek, eget typsnitt (.ttf/.otf).
- Tidslinje: dela klipp, ändra ordning (▲▼), intro/outro-text, förloppsindikator, bakgrundsmusik med volym.
- Titel/beskrivning/hashtags per klipp (mallar, eller LLM med egen nyckel); sparas i ZIP som titles_descriptions.txt.
- Projekt autosparas i IndexedDB.
- Avancerat läge: egen API-nyckel (Anthropic eller OpenAI) sparas bara i webbläsaren (localStorage) och skickas direkt till leverantören.

## Struktur
src/lib: transcribe (Whisper), highlights (poäng), edit (segment), reframe (MediaPipe), captions (ASS), export (ffmpeg.wasm), ff (delad ffmpeg + WORKERFS), db (IndexedDB), llm (valfritt), font. src/App.tsx: UI + Zustand.

## Kända begränsningar
- Stora filer: videon monteras via WORKERFS (kopieras inte till minnet) och ljudet plockas ut av ffmpeg för filer >100 MB. Rekommenderat ändå under ca 2 GB / 90 min; mycket långa filer kan ta slut på minne vid transkribering. Rendering är single-thread och långsam (räkna med flera gånger klipplängden).
- Länkimport (YouTube m.fl.) är inte möjlig utan server (CORS), så den saknas.
- Emoji: kan skrivas i textredigeringen men renderas inte i exporten med standardtypsnittet Arial (tas bort); ladda upp ett eget typsnitt med emoji-glyfer för att testa.
- Eget typsnitt/musik sparas inte i projektet (välj om efter omladdning). Typsnittet måste vara .ttf/.otf.
- Whisper utelämnar ofta fyllnadsljud; markera resten för hand. Hårda klipp mellan segment. Exporten kräver ljudspår.
- Smart beskärning följer största ansiktet i sidled; vid flera talare använd manuell beskärning.
- Intro/outro, förloppsindikator och musik syns först i exporten, inte i förhandsvisningen.
- Projekt ligger i webbläsarens lagring (försvinner vid rensning/privat läge); stora videor kan överskrida kvoten (då väljer du filen igen).
- LLM-anrop görs direkt från webbläsaren med din nyckel och kostar enligt din leverantör; appen använder aldrig betaltjänst på egen hand.
- Koden är inte testad mot alla webbläsare: kontrollera export med ansikts-/undertextläge först.
