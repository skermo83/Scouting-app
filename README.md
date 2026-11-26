# 🌾 Crop Scout

A phone-first crop scouting app for weeds, pests and diseases. It records GPS-tagged counts as you walk paddocks, accepts voice entry (including “Hey Siri”), and sends per-field summary reports.

It's an installable web app (PWA): no App Store needed, works offline once loaded, and all data stays on the phone.

## Features

- **Fields / paddocks**
  - **Import boundaries** from your farm mapping or yield software: shapefile (`.zip`, or `.shp` + `.dbf` + `.prj` picked together), KML/KMZ (Google Earth) or GeoJSON. Projected shapefiles (e.g. GDA94/GDA2020 MGA zones) are reprojected using the `.prj`. Paddock names and crops are read from the attribute table, and re-importing updates existing fields by name without losing records.
  - Or draw fields by tapping corners on a satellite map, walking or driving the fence line, or dropping a circle where you stand.
- **Automatic field detection**: GPS works out which paddock you're in and logs when you **walk in and out**, with on-screen and vibration alerts. You can also pin a field manually.
- **Customisable scouting menus** per crop (weeds / pests / diseases). Defaults are provided for Wheat, Barley, Canola, Chickpea, Faba bean and Cotton. Add or remove crops and items in Settings, or add an item on the spot from the Scout screen.
- **🌿 Weeds by density and size**: tap a weed, then a density (**Odd / Scattered / Patchy / Thick / Carpet**) and a size (**Small / Medium / Large / Large flowering**). The size you used last is remembered for each weed. The words can be edited in Settings, and an "Enter a count instead" option is there if you want plants/m².
- **🌱 Plant tab**: plant stand counts, growth stages and any other crop measurement, set per crop.
  - *Number* metrics, e.g. plant stand, nodes, NAWF / NAWS, fruit retention %, squares or bolls per m, height, tillers, pods per plant.
  - *Stage* metrics: one tap picks from a list, e.g. Zadoks for cereals, canola growth stages, cotton (squaring → first flower → cutout → open boll), or pulse stages.
  - Add, edit, reorder or remove metrics, or create your own pick lists, in Settings → Plant metrics.
- **Fast counting**: tap an item, then use the big +/− buttons, quick numbers or the keypad. Units: plants/m², per m², per plant, per 10 sweeps, % plants affected, severity 0–9, count. Each item remembers its last unit.
- **Voice entry**
  - 🎤 Tap and say “ryegrass 12”, “aphids 5 per plant, wild oats three” or “RLEM 40”. Weeds: “ryegrass patchy large”, “wild radish thick flowering”. Plant metrics work too: “plant stand 12”, “nodes 16 NAWF 4”, “stage 31”, “growth stage first flower”. Spoken numbers, plurals and acronyms are understood. Say “undo” to remove the last entry.
  - **Hands-free mode** keeps listening and keeps the screen awake while you walk.
  - **“Hey Siri, Scout”** through an iPhone Shortcut (set-up steps are in Settings).
- **Summary report** for any date range (Today / Yesterday / 7 days / 30 days / custom):
  - Field overview with the worst Weeds / Pests / Diseases rating per field.
  - Weeds: the **usual density** where found (e.g. “Patchy, up to Thick”), the usual size, 🌼 if any were flowering, and % of stops found. Rated Low (Odd/Scattered), Moderate (Patchy) or High (Thick/Carpet); the cut-offs can be changed in Settings.
  - For pests and diseases (and weeds entered as counts): **field average**, max, % of stops where it was found, and a **Low / Moderate / High** severity rating.
  - **Plant metrics** per field: average, range and CV% (coefficient of variation) of the readings, e.g. stand evenness, nodes, NAWF. For stages, the most common stage on the latest scouting day plus the range across the paddock. The field overview shows the current stage.
  - Optional **by-day** breakdown, with paddock in/out times.
  - Share sheet (text plus a field-summary CSV and an all-counts CSV), email, PDF/print, or CSV download.
- **Records**: list or map of every count, filterable by date and field, and editable.
- **Backup**: export/import a JSON file of all data.

### How the report averages work

Counts are grouped into **stops**: records within about 30 m and 10 minutes of each other count as one scouting location. For each item:

- **Field avg** = total count ÷ number of stops in the field. Stops where the item wasn't recorded count as 0, so patchy weeds don't look field-wide.
- **Found** = % of stops where it was present.
- Plant metrics are *not* zero-filled. They are the average of the readings actually taken.
- **Level** = the field average compared with per-unit thresholds (Settings → Severity levels). Defaults:

| Unit | Moderate ≥ | High ≥ |
|---|---|---|
| plants/m² | 5 | 20 |
| per m² | 10 | 50 |
| per plant | 2 | 10 |
| per 10 sweeps | 5 | 20 |
| % plants affected | 10 | 30 |
| severity 0–9 | 3 | 6 |

## Getting it on your phone

The app is static files, so any HTTPS host works. GPS and the microphone need HTTPS.

**GitHub Pages (free):**

1. Merge to `main`.
2. In the repo go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then `main` / `/ (root)`.
3. Open `https://<your-user>.github.io/<repo>/` on your phone.
   - iPhone: Safari → Share → **Add to Home Screen** (or bookmark it, see the Siri note below).
   - Android: Chrome → ⋮ → **Install app**.
4. Allow **Location** (“While Using”) and **Microphone** when asked.

To run locally: `python3 -m http.server 8000`, then open http://localhost:8000.

## “Hey Siri” set-up (iPhone)

Settings in the app shows these steps with your URL filled in:

1. In the Shortcuts app, create a new shortcut named **Scout**.
2. Add **Dictate Text**.
3. Add **Get Current Location**, then **Get Details of Locations → Latitude**, and the same again for **Longitude**.
4. Add a **URL** action with: `https://…/?say=[Dictated Text]&lat=[Latitude]&lon=[Longitude]`
5. Add **Open URLs**.

Say “Hey Siri, Scout”, then “ryegrass twelve”. The app opens, saves the count against the paddock you're standing in, and shows it with an Undo button.

## Known limitations

- **Siri opens Safari.** On iPhone, Safari and a home-screen web app keep separate data. If you use the Siri shortcut, run Crop Scout from a Safari bookmark rather than the home-screen icon so everything lands in one place. The in-app mic and hands-free mode work either way.
- **Screen must stay on.** iOS pauses GPS and speech recognition when the screen locks. Hands-free mode requests a screen wake lock.
- **Data is stored on the phone only.** Export a backup regularly. Safari can clear site data that hasn't been used for a few weeks. Cloud sync and multiple scouts would need a backend (a natural next step).
- **Satellite tiles need signal.** Map tiles are cached as you view them, so open your paddocks once on Wi-Fi before heading out. Counting and GPS work fully offline.

## Project layout

```
index.html            app shell
css/styles.css
js/app.js             UI and wiring
js/geo.js             GPS tracking, point-in-field, areas
js/voice.js           speech recognition + phrase parser
js/report.js          stops, field averages, severity, text/HTML/CSV output
js/importer.js        shapefile / KML / KMZ / GeoJSON boundary import
js/defaults.js        default crops, units, thresholds
js/store.js           local storage
sw.js                 offline cache
vendor/               Leaflet 1.9.4 (maps), shpjs 6.2.0 (shapefiles) — see their LICENSE files
```
