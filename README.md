# Unicon22 Cyclocross — Vollständige Anwendungsspezifikation

**Version:** 3.0
**Stand:** 2026-08-03
**Typ:** Progressive Web App (PWA), Offline-First, Serverless
**Technologie:** Vanilla JavaScript, HTML5, CSS3, Leaflet.js, Service Worker
**Zielgruppe:** Teilnehmer des Cyclocross-Rennens bei der UNICON 22 (2026)
**Einsatzort:** Schlosspark Steyr (Oberösterreich)
**Start / Ziel:** 48.041479 N, 14.417132 E — Rundkurs, Start und Ziel identisch

> **Herkunft:** Diese App ist aus der GMTW Trail Map (Hohensyburg) hervorgegangen.
> Auf Steyr umgestellt wurden: Ortsdaten, Branding, Speicher-Namensraum (`ccx_`)
> und das Rennmodul, das jetzt Runden statt Sektor-Splits wertet.

### Markenfarben (UNICON 22)

Der Verlauf des UNICON-Logos von links nach rechts, als CSS-Variablen in `:root`:

| Variable | Wert | Verwendung |
|---|---|---|
| `--u-orange` | #e1552b | Verlaufsanfang, Logo-Badge |
| `--u-amber` | #f5a623 | Akzentfarbe `--ac` im Dunkelmodus, Start-/Ziellinie |
| `--u-violet` | #5b4e8c | Verlaufsmitte, Spielplatz-Marker |
| `--u-blue` | #22357a | Verlaufsende |

Logo-Badge und Titel nutzen den Verlauf über alle vier Farben. Im Hellmodus
wird die Akzentfarbe auf #9a4409 abgedunkelt (WCAG AA), bei hohem Kontrast
auf #6b2c04 und der Titelverlauf abgeschaltet.

---

## 1. ARCHITEKTUR-ÜBERSICHT

### 1.1 Dateistruktur

```
cyclocross_unicon/
├── index.html              # Monolithische App (~14.800 Zeilen, ~670 KB)
├── service-worker.js       # Offline-Caching-Strategie (~540 Zeilen)
├── manifest.json           # PWA-Manifest
├── icons/                  # 13 PNG-Icons (16×16 bis 512×512)
│   ├── icon-16x16.png
│   └── ... (12 weitere Größen)
└── gpx/                    # Streckendateien zum Weitergeben
    ├── Unicon22_Rundkurs.gpx   # Rundkurs (identisch mit der eingebetteten Fassung)
    └── LIESMICH.txt            # Anleitung
```

> **Der Kurs steckt im Quelltext, nicht in der GPX-Datei.** Konstante
> `BUILTIN_TRACKS` in `index.html`. Grund: Beim Öffnen der `index.html` per
> Doppelklick (`file://`) blockiert der Browser jeden `fetch` auf lokale
> Dateien — ein Nachladen aus `gpx/` scheitert dort still, und die Karte
> bliebe ohne Strecke. Eingebettet erscheint der Kurs immer: per Doppelklick,
> über einen Webserver und offline.
>
> `gpx/Unicon22_Rundkurs.gpx` ist dieselbe Strecke als Datei zum Weitergeben
> und zum Laden auf dem Handy. Wird der Verlauf geändert, **beide** Stellen
> anfassen und `version` in `BUILTIN_TRACKS` hochzählen — sonst behalten
> Geräte mit gespeichertem Kurs die alte Fassung.

### 1.2 Externe Abhängigkeiten (CDN mit SRI)

| Bibliothek | Version | Zweck | SRI |
|---|---|---|---|
| Leaflet.js | 1.9.4 | Interaktive Karte | ✅ |
| localforage | 1.10.0 | IndexedDB-Wrapper | ✅ |
| Turf.js | 7.0 | Geo-Berechnungen | ✅ |
| jsQR | 1.4.0 | QR-Code-Scanner | ✅ |
| pako | 2.1.0 | DEFLATE-Komprimierung | ✅ |
| Bunny Fonts | latest | DSGVO-konforme Schriften | — |

### 1.3 Eingebettete Bibliotheken

| Bibliothek | Zeilen | Zweck |
|---|---|---|
| leaflet-gpx 1.7.0 | 43–681 | GPX-Parsing für Leaflet |
| qrcode-generator | 712–2981 | QR-Code-Erzeugung (Canvas) |

### 1.4 Genutzte Browser-APIs

| API | Zweck |
|---|---|
| Geolocation (watchPosition) | GPS-Tracking in Echtzeit |
| DeviceMotionEvent | Sturzererkennung (Beschleunigungssensor) |
| Service Worker | Offline-Caching, Tile-Prefetch |
| IndexedDB (via localforage) | Persistente Datenspeicherung (>5 MB) |
| localStorage | Konfiguration, Einstellungen |
| SubtleCrypto (HMAC-SHA256) | Rennzeit-Signaturen |
| WakeLock | Bildschirm wach halten bei Aufnahme |
| Web Share API Level 2 | Natives Teilen (GPX-Dateien) |
| SpeechSynthesis | Text-to-Speech (Barrierefreiheit) |
| Web Bluetooth GATT | Smartwatch-GPS-Fusion |
| Canvas 2D | QR-Code-Rendering, Höhenprofil |
| MediaDevices (getUserMedia) | Kamera für QR-Scanner |
| requestIdleCallback | Nicht-blockierendes Tile-Prefetching |

---

## 2. DATENMODELL

### 2.1 LOCS — Feste Trail-Punkte

**Typ:** `const` Array (1 Eintrag: Start/Ziel)
**Speicher:** Hardcodiert im Quellcode

Die Koordinate stammt aus der Konstante `START_FINISH`, die zugleich
Kartenmittelpunkt, Standardprojekt-Fokus und Start-/Ziellinie des Rennens
speist. Weitere Punkte (Fahrerlager, Materialzone, WC) sind noch nicht
vermessen und werden über den Marker-Editor gesetzt.

```javascript
{
  id:      string,           // Eindeutiger Bezeichner ("start-ziel", ...)
  name:    string,           // Anzeigename (Deutsch)
  lat:     number,           // Breitengrad (WGS84)
  lng:     number,           // Längengrad (WGS84)
  color:   string,           // Hex-Farbe (#22c55e, #f59e0b, #ef4444, #38bdf8)
  emoji:   string,           // Anzeige-Emoji
  cat:     "beginner"|"mittel"|"expert"|"logistik",
  desc:    string,           // Beschreibung (Deutsch)
  nameI18n: {en, fr, es, it},  // Übersetzte Namen
  descI18n: {en, fr, es, it},  // Übersetzte Beschreibungen
  large?:  boolean,          // Vergrößertes Icon (Start/Ziel)
  line?:   boolean           // Als Polyline rendern (derzeit ungenutzt)
}
```

**Kategorien:** unverändert vier Stück — die ersten drei dienen als
Klasseneinteilung der Strecken, `logistik` für Punkte am Gelände.
Einzelne Punkte dürfen die Kategoriefarbe per `color` überschreiben;
Start/Ziel nutzt das für Limette (#c8ff00).

Die **internen Schlüssel** (`beginner`/`mittel`/`expert`) sind historisch und
bleiben wegen gespeicherter Strecken und QR-Kompatibilität unverändert.
**Angezeigt** werden sie überall als die Rennklassen **Kids / Beginner /
Elite** (passend zu den Fahrzeiten 20/30/45 min):

| Schlüssel (intern) | Anzeige | Farbe | CSS-Variable | Emoji-Beispiele |
|---|---|---|---|---|
| beginner | Kids | #22c55e | `--beg` | 🚩 |
| mittel | Beginner | #f59e0b | `--mit` | 🟡, 🏆 |
| expert | Elite | #ef4444 | `--exp` | ⚠️ |
| logistik | Logistik | #38bdf8 | `--log` | 🏁, ⛺, 🚿 |

### 2.2 trackStore — GPX-Strecken

**Typ:** `const` Objekt mit `tracks: []` und `_id: number`
**Speicher:** IndexedDB (Key: `ccx_tracks_v2`)

```javascript
{
  id:        string,          // "trk-1", "trk-2", ...
  name:      string,          // Streckenname aus GPX <name>
  cat:       string,          // Kategorie (beginner|mittel|expert)
  color:     string,          // Darstellungsfarbe (#27AE60, #D4A017, #ef4444)
  gpxLayer:  L.GeoJSON,       // Leaflet-Layer (gerendert)
  visible:   boolean,         // Sichtbarkeits-Toggle
  sourceUrl: string|null,     // Herkunfts-URL (falls per URL geladen)
  gpxString: string,          // Roher GPX-XML-String
  bounds:    L.LatLngBounds,  // Berechnete Streckenausdehnung
  startPt:   {lat, lng},      // Erster GPS-Punkt
  finishPt:  {lat, lng},      // Letzter GPS-Punkt
  stats:     {dist, dur},     // Distanz (km), Dauer (falls vorhanden)
  elevData:  array,           // Höhenprofil-Datenpunkte
  projectId: string,          // Zugehöriges Projekt
  _startMkr: L.Marker,        // Start-Pin auf Karte
  _finishMkr: L.Marker        // Ziel-Pin auf Karte
}
```

**GPX-Farbzuordnung:**

| Kategorie | Hex-Farbe |
|---|---|
| beginner | #27AE60 |
| mittel | #D4A017 |
| expert | #ef4444 |

### 2.3 recorder — GPS-Aufnahme

**Typ:** `const` Objekt
**Speicher:** localStorage (`ccx_rec_v2`) + IndexedDB-Backup

```javascript
{
  isRecording:    boolean,
  isPaused:       boolean,
  points:         [{lat, lng, ele, speed, accuracy, time: ISO8601}, ...],
  watchId:        number|null,    // geolocation.watchPosition ID
  elapsed:        number,         // Akkumulierte Millisekunden
  _segStart:      number|null,    // Segment-Startzeit
  _timerInt:      number|null,    // Timer-Intervall-ID
  _persistInt:    number|null,    // Auto-Save-Intervall (5s)
  _lastPos:       {lat, lng},     // Für Ausreißer-Erkennung
  _lastTime:      number|null,    // Für Geschwindigkeits-Berechnung
  totalDist:      number,         // Gesamtdistanz in Metern
  previewLine:    L.Polyline,     // Live-Routen-Vorschau (rot)
  _previewCasing: L.Polyline,     // Weiße Umrandung
  _gpsState:      string,         // 'idle'|'acquiring'|'lost'|'weak'|'moderate'|'good'
  MIN_SPEED:      0.5             // Schwellwert für Bewegungserkennung (m/s)
}
```

### 2.4 RACE — Rennzeit-Zustandsmaschine

**Typ:** `const` Objekt
**Speicher:** In-Memory (nicht persistiert)

```javascript
{
  state:          "idle"|"approaching"|"at_line"|"go"|"racing"|"finished",
  trackId:        string|null,    // 'kurs-steyr' wenn ohne hinterlegtes GPX
  trackName:      string,
  startPt:        {lat, lng}|null, // Rundkurs: zugleich der Zielpunkt
  startLine:      L.Polyline,     // 6m breite Start-/Ziellinie
  checkpoints:    [{lat, lng, isFinish, label}],  // genau ein Eintrag: Start/Ziel
  cpMarkers:      [L.Marker, ...],
  nextCpIdx:      number,
  totalKm:        number,         // Länge EINER Runde (0 = unbekannt)

  // Rundenmodus
  lapsTotal:      number,         // Sollrundenzahl (1–30, Standard 3)
  lapTimes:       [ms, ...],      // Zeit je abgeschlossener Runde
  _lapArmed:      boolean,        // Startbereich verlassen → Durchgang zählt
  _lapAwayMax:    number,         // größte Entfernung seit letztem Durchgang

  startTs:        number|null,    // performance.now() bei Rennstart
  startWallTs:    number|null,    // Date.now() für Signatur
  lastSplitTs:    number|null,    // performance.now() beim letzten Durchgang
  gpsTrack:       [{lat, lng, alt, ts, speed, acc}, ...],
  fallEvents:     [{type: 'fall'|'dismount', ts, lat, lng}, ...],
  signature:      string|null,    // HMAC-SHA256 (24 Hex-Zeichen)

  // Bluetooth Smartwatch
  btDevice:       BluetoothDevice|null,
  btGpsLat:       number|null,
  btGpsLng:       number|null,
  btGpsTs:        number          // Letzte BT-GPS-Messung
}
```

### 2.5 _cmMarkers — Benutzerdefinierte Marker

**Typ:** `let` Array
**Speicher:** IndexedDB (`ccx_custom_markers_v1`)

```javascript
{
  id:         "cm_${timestamp}_${idx}_${random}",
  name:       string,         // max 60 Zeichen
  lat:        number,
  lng:        number,
  emoji:      string,         // Standard: "📍"
  cat:        string,         // Kategorie
  desc:       string,         // max 300 Zeichen
  color:      string,         // Aus Kategorie abgeleitet
  projectId:  string,
  visible:    boolean,
  gmapsUrl:   string|null,    // Google Maps Navigation Link
  lastEdited: string|null     // ISO-Zeitstempel
}
```

### 2.6 _projects — Multi-Projekt-System

**Typ:** `let` Array
**Speicher:** localStorage (`ccx_projects_v1`)

```javascript
{
  id:        "proj_${timestamp}"|"proj_0",
  name:      string,           // max 40 Zeichen
  enabled:   boolean,          // Sichtbar auf Karte
  centerLat: number,           // Fokuspunkt
  centerLng: number,
  zoom:      number,
  createdAt: string            // ISO-Zeitstempel
}
```

### 2.7 Profil-System

**Speicher:** localStorage (`ccx_profile_v1`)

```javascript
{
  name:      string,    // Fahrername (max 32 Zeichen)
  muniName:  string,    // Einrad-Name (max 40 Zeichen)
  lang:      string,    // Sprache (de|en|fr|es|it)
  avatar:    string,    // Emoji-Avatar
  avatarBg:  string,    // Avatar-Hintergrundfarbe
  wheelSize: string,    // Radgröße (19"–36")
  frameColor:string,    // Rahmenfarbe
  brakeType: string,    // Bremsentyp
  seatClamp: string,    // Sattelklemme-Farbe
  special:   string     // Besonderheit (Schlumpf-Nabe, Freewheel, etc.)
}
```

---

## 3. SPEICHERSYSTEM

### 3.1 localStorage-Schlüssel

| Schlüssel | Inhalt | Quota-relevant |
|---|---|---|
| `ccx_tracks_v2` | Track-Metadaten (Fallback) | Ja |
| `ccx_rec_v2` | Laufende Aufnahme (Points, Timer) | Ja |
| `ccx_view_v1` | Kartenposition {lat, lng, zoom} | Nein |
| `ccx_theme` | "dark" oder "light" | Nein |
| `ccx_gps_emoji` | GPS-Positions-Emoji | Nein |
| `ccx_home_region` | {lat, lng} Heimat-Fokus | Nein |
| `ccx_install_decline` | PWA-Install abgelehnt | Nein |
| `ccx_profile_v1` | Fahrerprofil (JSON) | Nein |
| `ccx_a11y_v1` | Barrierefreiheits-Einstellungen | Nein |
| `ccx_projects_v1` | Projekt-Array (JSON) | Nein |
| `ccx_active_project_v1` | Aktive Projekt-ID | Nein |
| `ccx_lang_v1` | App-Sprache (de/en/fr/es/it) | Nein |
| `ccx_locs_hidden` | Ausgeblendete LOCS-IDs (JSON Array) | Nein |
| `ccx_locs_overrides` | LOCS-Anpassungen (JSON Object) | Nein |
| `ccx_marker_scale` | Marker-Skalierung (0.5–2.0) | Nein |
| `ccx_trk_features_v1` | Schlüsselstellen pro Track | Nein |
| `ccx_trk_ratings_v1` | Persönliche Track-Bewertungen | Nein |
| `ccx_trk_edits_v1` | Track-Beschreibungen | Nein |
| `ccx_qr_scanner_enabled` | QR-Scanner aktiviert | Nein |
| `ccx_laps_v1` | Sollrundenzahl für die Zeitnahme (1–30) | Nein |

> **Namensraum:** Alle Schlüssel tragen das Präfix `ccx_` (vormals `gmtw_`).
> Das trennt die Daten sauber von der GMTW-App, falls beide unter derselben
> Origin liegen — localStorage und IndexedDB werden sonst geteilt.

### 3.2 IndexedDB (via localforage)

| Schlüssel | Inhalt | Größe |
|---|---|---|
| `ccx_tracks_v2` | Vollständige Track-Objekte mit GPX-Strings | Bis mehrere MB |
| `ccx_runs_v1` | Rennhistorie {trackId → [runs]} | Bis 50 Runs/Track |
| `ccx_custom_markers_v1` | Benutzerdefinierte Marker | Variable |
| `ccx_rec_backup_v2` | Aufnahme-Backup (>200 Punkte) | Variable |

### 3.3 Quota-Handling

```javascript
LS.set(key, val):
  1. JSON.stringify + setItem
  2. Bei QuotaExceededError:
     a) removeItem(key) + erneuter setItem
     b) Bei erneutem Fehler: return false
  3. Erkennt: QuotaExceededError, NS_ERROR_DOM_QUOTA_REACHED, code 22
```

---

## 4. KARTE & KARTENSCHICHTEN

### 4.1 Kartenkonfiguration

- **Startposition:** 48.041479°N, 14.417132°E (Start/Ziel, Schlosspark Steyr)
- **Standard-Zoom:** 17 (Parkgelände ist rund 250 × 200 m groß)
- **Min/Max Zoom:** 1–26 (native max: 17 Topo / 19 Sat)
- **Bibliothek:** Leaflet 1.9.4

### 4.2 Tile-Layer

| Layer | Anbieter | URL-Muster | Native Max |
|---|---|---|---|
| **TOPO** (Standard) | OpenTopoMap | `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png` | 17 |
| **SAT** | Esri World Imagery | `https://server.arcgisonline.com/.../tile/{z}/{y}/{x}` | 19 |

### 4.3 Overlay-Elemente

- **Trail-Punkte (LOCS):** 14 fest definierte Marker mit Emoji-Icons
- **GPX-Strecken:** Polylines mit kategorie-abhängiger Farbe und Start/Ziel-Pins
- **Benutzerdefinierte Marker:** Emoji-basierte Marker mit Popup und Tooltip
- **Rückweg-Polyline:** Gestrichelte Linie Camp ↔ Sammelpunkt (gelb)
- **GPS-Positionsmarker:** Blauer Punkt mit Genauigkeitskreis
- **Navigations-Linie:** Gestrichelte cyanfarbene Linie (User → Ziel)
- **Start-/Ziellinie (Rennen):** 6m breite senkrechte Linie (limette)

### 4.4 Tile-Prefetch-Engine (_TPC)

**Zweck:** Proaktives Cachen sichtbarer Kartenkacheln für Offline-Nutzung

| Parameter | Wert | Beschreibung |
|---|---|---|
| Debounce | 1400 ms | Verzögerung nach Kartenbewegung |
| Viewport-Padding | 50% | Zusätzlicher Bereich um sichtbaren Ausschnitt |
| Zoom unten | −2 Level | Kacheln 2 Stufen unter aktuellem Zoom |
| Zoom oben | +1 Level | Kacheln 1 Stufe über aktuellem Zoom |
| Max Tiles/Run | 600 | Harte Obergrenze pro Prefetch-Lauf |
| Scheduling | requestIdleCallback | Nicht-blockierend |

---

## 5. GPS-MODUL

### 5.1 Positionserfassung

```javascript
navigator.geolocation.watchPosition(callback, error, {
  enableHighAccuracy: true,
  timeout:           20000,  // 20 Sekunden
  maximumAge:        3000    // 3 Sekunden
});
```

### 5.2 Visuelles Feedback

- **GPS-FAB:** Dreht sich während Positionssuche (`spin`-Klasse)
- **Positionsmarker:** 16px blauer Punkt mit pulsierender Halo (36px)
- **Genauigkeitskreis:** Cyan-farbener Leaflet-Circle mit `accuracy` Radius
- **Auto-Follow:** Karte folgt GPS-Position (Zoom 17, 1s Animation)

### 5.3 Fehlerbehandlung

| Code | Meldung | Aktion |
|---|---|---|
| 1 | Zugriff verweigert | 8s Toast, GPS deaktiviert |
| 2 | Kein Signal | 8s Toast |
| 3 | Zeitüberschreitung | 8s Toast |

---

## 6. GPS-AUFNAHME-MODUL

### 6.1 Aufnahme-Pipeline (4-stufig)

```
GPS-Fix → Genauigkeitsfilter → Ausreißer-Erkennung → Deduplikation → Speicherung
```

**Stufe 1 — Adaptive Genauigkeitsschwelle:**

| Punkte aufgenommen | Max. Genauigkeit (m) |
|---|---|
| 0 | 200 |
| 1–4 | 150 |
| 5–14 | 100 |
| 15+ | 50 |

**Stufe 2 — Ausreißer-Erkennung:**
- Verwirft wenn `Δt < 0.5s` (GPS-Callback-Duplikat)
- Verwirft wenn Geschwindigkeit `> 13.9 m/s` (50 km/h, großzügig für Downhill)

**Stufe 3 — Deduplikation:**
- Verwirft wenn Distanz zum letzten Punkt `< 1.5m`

**Stufe 4 — Speicherung:**
- Punkt: `{lat, lng, ele, speed, accuracy, time: ISO8601}`
- Haversine-Distanzberechnung
- Vorschau-Polyline auf Karte aktualisieren

### 6.2 Nachbearbeitung (bei Speicherung)

**Sturz-Zickzack-Bereinigung:**
```
Fenster:           7 Punkte (symmetrisch)
Sinuosität:        > 3.0 (Weglänge / Luftlinie)
Max. Verschiebung: 8m End-zu-End im Fenster
Max. Episodendauer: 30 Sekunden
```
Entfernt Innenpunkte bei Zickzack ohne Nettobewegung (Sturz-Artefakte).

### 6.3 Auto-Save & Recovery

- **Auto-Save:** Alle 5 Sekunden nach localStorage
- **IndexedDB-Backup:** Bei >200 Punkten
- **WakeLock:** Bildschirm bleibt eingeschaltet
- **Visibility-Handling:** GPS-Watch wird bei Tab-Wechsel neu gestartet
- **Beforeunload:** Zustand wird vor Schließen persistiert

### 6.4 GPS-Signal-Anzeige

| Genauigkeit | Anzeige | Farbe |
|---|---|---|
| Wird gesucht | 🔍 GPS wird gesucht… | Amber |
| Signal verloren | ❌ GPS-Signal verloren | Rot |
| > 100m | 📡 GPS schwach (±Xm) | Amber |
| > 50m | 📡 GPS mäßig (±Xm) | Hellgrün |
| ≤ 50m | ✅ GPS gut (±Xm) | Grün |

### 6.5 Export-Formate

- **GPX 1.1:** Standardformat mit `<ccx:speed>` und `<ccx:accuracy>` Extensions
- **JSON:** Rohformat mit allen Metadaten
- **Web Share API:** Natives Teilen als GPX-Datei

---

## 7. RENNZEIT-MODUL

### 7.1 Zustandsmaschine

```
idle → approaching → at_line → go → racing → finished
  ↑                                              |
  └──────────────── abbrechen ←──────────────────┘
```

### 7.2 Start-/Ziellinie (Vektor-basiert)

1. Richtung bestimmen — in dieser Reihenfolge:
   a) aus den ersten zwei GPX-Punkten (Turf.bearing), sonst
   b) aus der zuletzt gefahrenen Richtung des Fahrers (`_riderBearing()`,
      aus den letzten fünf GPS-Positionen), sonst
   c) Ost-West als Rückfall
2. Senkrechte Linie erstellen: 6m Breite (3m je Seite)
3. Turf.destination für Endpunkte
4. Darstellung: Limette (#c8ff00), 5px, 0.9 Opacity

> Die Linie ist reine Orientierung. Gezählt wird über den Durchfahrtsradius
> (7.4), damit die Zeitnahme auch ohne hinterlegte Strecke funktioniert.

### 7.3 Annäherungs-System

| Entfernung | Aktion |
|---|---|
| < 50m | Navigation → Pre-Race-Modus (auto) |
| 5m–2m | Canvas: Amber Distanzzahl, Prompt-Text einblenden |
| ≤ 2m | Canvas: "BEREIT!" (grün wenn bestätigt) |
| Bestätigt + > minDist+1.5m | Auto-Crossing → Rennen startet |

### 7.4 Rundenzählung (Cyclocross)

Start und Ziel sind dieselbe Linie. Jeder Durchgang schließt eine Runde ab;
nach der eingestellten Rundenzahl endet der Lauf automatisch.

**Ablauf je Runde:**

1. Fahrer entfernt sich von der Linie → bei ≥ `LAP_REARM_M` wird die Zählung
   scharf (`_lapArmed = true`)
2. Fahrer kommt zurück und unterschreitet den Durchfahrtsradius → Runde zählt
3. Zählung wird entschärft, `_lapAwayMax` zurückgesetzt

**Parameter:**

| Konstante | Wert | Zweck |
|---|---|---|
| `LAP_GATE_MIN_M` / `LAP_GATE_MAX_M` | 8 m / 15 m | Grenzen des Durchfahrtsradius |
| Durchfahrtsradius | `max(8, min(15, accuracy × 0.6))` | wächst mit GPS-Ungenauigkeit |
| `LAP_REARM_M` | 40 m | Mindestentfernung, bevor erneut gezählt wird |
| `LAP_MIN_MS` | 20 000 ms | Mindestdauer einer Runde |
| Rundenzahl | 1–30, Standard 3 | `ccx_laps_v1`, einstellbar vor dem Start |

Die beiden Sicherungen greifen unabhängig voneinander: `LAP_REARM_M` verhindert
Mehrfachzählung beim Stehen an der Linie, `LAP_MIN_MS` fängt Kursabschnitte ab,
die dicht an der Ziellinie vorbeiführen.

**Anzeige während des Laufs:** Rundenzähler ("Runde 2 / 3"), laufende
Gesamtzeit, schnellste Runde, ein Kästchen je Runde mit der Rundenzeit.

**Zwei Einstiege in die Zeitnahme:**

| Funktion | Auslöser | Rundenlänge |
|---|---|---|
| `beginPreRace(trackId)` | ⏱ Timing am Streckenpopup | aus GPX berechnet |
| `beginLapRace()` | ⏱ Zeitmessung starten am Start/Ziel-Marker | unbekannt (0) |

### 7.5 Sturz-/Absteigerkennung

| Typ | Schwellwert | Methode |
|---|---|---|
| Sturz (fall) | 35 m/s² (≈3.5G) + 400ms Stillstand (<4 m/s²) | DeviceMotion |
| Absteigen (dismount) | Geschwindigkeit: >5 km/h → <1 km/h | GPS-Geschwindigkeit |

- Throttle: Min. 3 Sekunden zwischen Events
- Haptisches Feedback: `navigator.vibrate([60, 60, 60])`

### 7.6 HMAC-SHA256 Signierung

```javascript
Secret:  'CCX26-RACE-' + YYYY-MM-DD (tagesrotierend)
Algo:    HMAC-SHA256 (Web Crypto API)
Payload: {trackId, date, totalMs, splits, rider, muni}
Output:  24 Hex-Zeichen
```

> **Hinweis:** Client-Side-Only Signierung dient als Tamper-Detection, nicht als echte Anti-Cheat-Sicherheit. Für Fälschungssicherheit wäre Server-Side-Validation nötig.

### 7.7 Bluetooth-Sensor-Fusion

- **Service:** 0x1819 (Location & Navigation)
- **Characteristic:** 0x2A67 (Location)
- **Fusion:** Mittelwert aus Phone-GPS und Watch-GPS wenn BT-Fix < 3s alt
- **Genauigkeit:** `min(phone_acc, 5)` (Annahme: BT-GPS genauer)

### 7.8 Lauf-Ergebnis

```javascript
{
  trackId, trackName, date: ISO8601,
  totalMs:        number,        // Netto-Gesamtzeit
  laps:           number,        // gefahrene Runden
  lapsPlanned:    number,        // Sollrundenzahl
  lapKm:          number,        // Länge einer Runde (0 = unbekannt)
  splits:         [ms, ...],     // Rundenzeiten (Feldname aus Kompatibilität)
  fallEvents:     [{type, ts, lat, lng}, ...],
  gpsTrack:       [{lat, lng, alt, ts, speed, acc}, ...],
  riderName, muniName,
  muniDetails:    {wheelSize, color, brake, seatClampColor, special},
  signature:      string         // HMAC-SHA256 (24 Hex)
}
```

---

## 8. NAVIGATIONS-MODUL

### 8.1 Modi

| Modus | Beschreibung |
|---|---|
| `to-start` | Navigation zum Startpunkt der Strecke |
| `on-track` | Streckenbegleitung mit Abbiegehinweisen |

### 8.2 HUD-Elemente (Heads-Up Display)

- **Streckenname** (nh-title)
- **Distanz** (nh-dist): "X km" oder "Y m"
- **Richtungspfeil** (nh-arrow): 8 Unicode-Pfeile ↑↗→↘↓↙←↖
- **Status-Text** (nh-mode-txt): "Navigiere zum Start", "🎯 Fast da!", "🟢 Auf Strecke"
- **Google Maps Link**

### 8.3 Abbiege-Erkennung

Vorausschauende Berechnung über 3 Punkte (nah, 20m, 50m):

| Winkeländerung | Symbol | TTS-Ansage |
|---|---|---|
| < −50° | ↰ | "Links abbiegen" |
| −50° bis −22° | ↖ | — |
| −22° bis +22° | ↑ | — |
| +22° bis +50° | ↗ | — |
| > +50° | ↱ | "Rechts abbiegen" |

### 8.4 Abweichungs-Erkennung

**Modus to-start:**
- Entfernung steigt um >8m UND >30m gesamt → falsche Richtung
- 3 aufeinanderfolgende schlechte Fixes → Warnung
- TTS: "Falsche Richtung. Bitte umkehren."

**Modus on-track:**
- >25m vom nächsten Streckenpunkt → Off-Route
- 3 aufeinanderfolgende → Warnung
- TTS: "Achtung, du bist X Meter von der Strecke entfernt."

---

## 9. QR-CODE-SYSTEM

### 9.1 Sender-Pipeline

```
Track-Daten → RDP-Vereinfachung → Kompakt-Encoding → DEFLATE → Base64url → Chunking → QR
```

| Schritt | Parameter |
|---|---|
| Max. Punkte nach RDP | 1000 |
| Koordinaten-Präzision | ×1e5 (≈0.1m) |
| Höhen-Präzision | ×10 (1 Dezimeter) |
| Kompression | pako DEFLATE Level 9 |
| Chunk-Größe | **700 Zeichen** (QR-Version ~22) |
| Canvas-Größe | **300×300 px** (~2.86 px/Modul) |
| Fehlerkorrektur | Level M (15% Recovery) |
| Transfer-ID | 7-stellig zufällig |

### 9.2 Chunk-Format

```json
{
  "v": 1,
  "T": "gmtw-chunk",
  "id": "abc1234",
  "i": 0,
  "n": 3,
  "z": 1,
  "d": "KLUv/Q..."
}
```

| Feld | Beschreibung |
|---|---|
| v | Protokoll-Version |
| T | Typ-Marker (`gmtw-chunk`) |
| id | 7-Zeichen Transfer-ID |
| i | Chunk-Index (0-basiert) |
| n | Gesamtzahl Chunks |
| z | Kompression: 1=DEFLATE, 0=Raw |
| d | Base64url-Datenblock (max 700 Zeichen) |

> **Warum noch `gmtw-`?** Die Typ-Marker der Übertragungsformate
> (`gmtw-chunk`, `gmtw-track`, `gmtw-marker`, `gmtw-gpx-bundle`,
> `gmtw-project`, `gmtw:feat:`) sind bewusst unverändert geblieben. Sie sind
> Drahtformat, kein Branding: so bleiben QR-Codes zwischen dieser App und der
> GMTW-App gegenseitig scanbar. Backups werden über `isAppBackup()` erkannt,
> das sowohl den neuen Marker `Unicon22 Cyclocross` als auch alte
> GMTW-Backups akzeptiert.

### 9.3 Scanner-Pipeline

```
Kamera → Frame-Capture (5 FPS) → jsQR → Payload-Parsing → Chunk-Buffer → Import
```

- **Kamera:** Rückseite bevorzugt, 640×640px
- **Frame-Rate:** 200ms Intervall (5 FPS)
- **Deduplikation:** Letztes Ergebnis gecacht
- **Auto-Cleanup:** 15 Minuten Timeout pro Transfer

### 9.4 Dekompression (4 Fallback-Stufen)

1. pako.inflate (wenn z=1 und pako verfügbar)
2. pako.inflate (auch wenn z=0, falls Fehlmarkierung)
3. TextDecoder UTF-8 (unkomprimierte Daten)
4. Legacy decodeURIComponent(escape(atob()))

### 9.5 Kompakt-Track-Payload

```json
{
  "v": 1,
  "type": "gmtw-track",
  "n": "Track Name",
  "c": "mittel",
  "he": 1,
  "ht": 1,
  "ts": "2026-04-02T10:00:00Z",
  "p": [
    [lat0_abs, lon0_abs, ele0?, time0?],
    [Δlat, Δlon, Δele?, Δtime?],
    ...
  ]
}
```

---

## 10. STRECKEN-FEATURES (Schlüsselstellen)

### 10.1 Feature-Typen

| Typ | Icon | Name |
|---|---|---|
| drop | ⬇️ | Drop |
| steinfeld | 🪨 | Steinfeld |
| verblockt | 🪵 | Verblockt |
| steil | 🏔 | Tech. Steil |
| northshore | 🌉 | Northshore |
| sprung | 🦘 | Sprung |
| flow | 🌊 | Flow-Sektion |
| aussicht | 👁 | Aussichtspunkt |
| goal | 🎯 | Ziel |
| pause | ⛺ | Pause |

### 10.2 Feature-Daten

```javascript
{
  type:  string,       // Typ-Schlüssel
  name:  string,       // max 60 Zeichen
  diff:  1–5,          // Schwierigkeits-Sterne
  date:  number,       // Date.now() bei Erstellung
  lat?:  number,       // GPS-Position (optional)
  lng?:  number
}
```

### 10.3 Platzierung

1. Strecke auswählen → Feature-Position-Picker öffnet sich
2. Mini-Karte zeigt Strecke mit bestehendem Overlay
3. Kartemitte = Feature-Position (Fadenkreuz)
4. Alternativ: GPS-Modus (Live-Position verwenden)
5. Feature-Typ und Schwierigkeit wählen
6. Speichern → Marker auf Hauptkarte

---

## 11. UI-KOMPONENTEN

### 11.1 Haupt-Panels

| Panel | ID | Öffnung | Inhalt |
|---|---|---|---|
| Top Bar | `topbar` | Immer sichtbar | Menü, Titel, Layer-Toggle |
| Filter Bar | `fbar` | Immer sichtbar | Kategorie-Chips, Projekt-Selektor |
| Bottom Sheet | `sheet` | `toggleSheet()` | Trail-Punkt-Liste (filtriert) |
| GPX Panel | `gpx-panel` | `openGpxPanel()` | 3 Tabs: Laden, Tracks, Aufnahme |
| Settings | `settings-panel` | `openSettings()` | 7 Tabs (siehe 11.3) |
| Race Overlay | `race-overlay` | Auto (Annäherung) | 5 Seiten: Approach → Results |

### 11.2 Modale Dialoge

| Dialog | ID | Zweck |
|---|---|---|
| QR-Modal | `qrm` | Standort-QR (Google Maps Link) |
| Track-QR-Modal | `trk-qrm` | Multi-Frame Track-QR mit Navigation |
| Marker-Modal | `md-overlay` | Marker erstellen/bearbeiten |
| Run-Detail | `run-detail-modal` | Lauf-Details anzeigen |
| Feature-Picker | `feat-pos-modal` | Schlüsselstelle platzieren |
| Projekt-Step2 | `proj-step2-modal` | Neues Projekt konfigurieren |
| PWA-Install | `pwa-install` | App-Installation vorschlagen |

### 11.3 Settings-Tabs

| Tab | data-t | Inhalt |
|---|---|---|
| Profil | `profile` | Name, Einrad-Daten, Avatar, Sprache |
| Allgemein | `general` | GPS-Emoji, Projekte, Barrierefreiheit & TTS |
| Strecken | `tracks` | Offizielle Strecken, Rating, Features-Editor |
| Backup | `backup` | Export/Import: Vollbackup, Marker, Zeiten, Projekte |
| Marker | `markers` | Marker-Liste, Größen-Slider, Import/Export |
| QR-Scan | `qr` | Kamera-Scanner mit Toggle |
| App | `app` | PWA-Status, Cache-Info, Offline-Speicher |

### 11.4 Floating Action Buttons (FABs)

| Button | Funktion | Badge |
|---|---|---|
| 🔊 | Aktuellen Kontext vorlesen (TTS) | — |
| GPS | GPS-Position zentrieren | — |
| 📊 | GPX-Panel öffnen | Track-Anzahl |
| ⏺ | Aufnahme starten | — |
| 🌙/☀️ | Theme umschalten | — |
| ⊞ | Übersicht (alle Strecken zoomen) | — |
| ⚙ | Einstellungen öffnen | — |

---

## 12. BARRIEREFREIHEIT

### 12.1 ARIA-Implementierung

- `role="dialog"` und `aria-modal="true"` auf allen Modalen
- `aria-label` auf allen interaktiven Elementen
- `aria-live="polite"` für Statusmeldungen
- `aria-live="assertive"` für Warnungen
- `role="toolbar"` für TTS-Steuerleiste
- `role="listbox"` und `role="group"` für Projekt-Dropdown

### 12.2 Text-to-Speech (TTS)

**Steuerleiste (5 Buttons):**
- 🔊 Vorlesen (aktueller Kontext)
- ⏪ Wiederholen
- ⏸/▶ Pause/Weiter
- ⏩ Überspringen
- ⏹ Stopp

**Kontexte:**
- Kartenübersicht: Zoom-Level, sichtbare Tracks, nächster Punkt
- Nächster Trail-Punkt: Name, Entfernung, Richtung
- Navigation: Abbiegehinweise, Off-Route-Warnungen
- Rennen: "GO!", Splits, Ergebnisse

**Sprechrate:** 0.5× – 2.0× (konfigurierbar)

### 12.3 Hoher Kontrast

- CSS-Selector: `[data-theme=light][data-a11y-hc]`
- WCAG AA Kontrastverhältnis ≥ 4.5:1
- Stärkere Rahmen und dunklere Texte

### 12.4 Tastaturnavigation

| Taste | Funktion |
|---|---|
| V | Kartenübersicht vorlesen |
| N | Nächsten Punkt vorlesen |
| S | Einstellungen öffnen |
| Esc | Aktuelles Panel schließen |

---

## 13. INTERNATIONALISIERUNG (i18n)

### 13.1 Unterstützte Sprachen

| Code | Sprache | Flagge | Status |
|---|---|---|---|
| de | Deutsch | 🇩🇪 | Primär (vollständig) |
| en | English | 🇬🇧 | Übersetzung vorhanden |
| fr | Français | 🇫🇷 | Übersetzung vorhanden |
| es | Español | 🇪🇸 | Übersetzung vorhanden |
| it | Italiano | 🇮🇹 | Übersetzung vorhanden |

### 13.2 Übersetzungs-Mechanismus

```javascript
function t(key, vars = {}) {
  let s = TRANSLATIONS[_appLang]?.[key]
       || TRANSLATIONS.de[key]
       || key;
  for (const [k, v] of Object.entries(vars))
    s = s.replace(`{${k}}`, v);
  return s;
}
```

### 13.3 DOM-Attribute

| Attribut | Ziel |
|---|---|
| `data-i18n` | textContent |
| `data-i18n-ph` | placeholder |
| `data-i18n-aria` | aria-label |
| `data-i18n-title` | title |

---

## 14. SERVICE WORKER & OFFLINE-STRATEGIE

### 14.1 Cache-Architektur

| Cache | Strategie | Max Einträge |
|---|---|---|
| `ccx-v1-shell` | Cache-First | Unbegrenzt |
| `ccx-v1-tiles` | Stale-While-Revalidate + Dedup | 3.000 |
| `ccx-v1-gpx` | Cache-First + Background-Update | 200 |
| `ccx-v1-fonts` | Stale-While-Revalidate | 150 |
| `ccx-v1-data` | Network-First + Cache-Fallback | Unbegrenzt |

### 14.2 Routing-Regeln

| URL-Muster | Cache | Strategie |
|---|---|---|
| Navigation (HTML) | Shell | Network-First → Cache → Offline-Fallback |
| App Shell (JS/CSS/Icons) | Shell | Cache-First |
| `*.tile.opentopomap.org` | Tiles | Stale-While-Revalidate |
| `server.arcgisonline.com` | Tiles | Stale-While-Revalidate |
| `*.tile.openstreetmap.org` | Tiles | Stale-While-Revalidate |
| `tile.waymarkedtrails.org` | Tiles | Stale-While-Revalidate |
| `maps.wikimedia.org` | Tiles | Stale-While-Revalidate |
| `fonts.bunny.net`, `fonts.gstatic.com` | Fonts | Stale-While-Revalidate |
| `raw.githubusercontent.com` (GPX) | GPX | Cache-First + BG-Update |
| `*.gpx` | GPX | Cache-First + BG-Update |
| Alles andere | Data | Network-First |

### 14.3 Tile-Dedup

- `_bgFetching` Set verhindert gleichzeitige Anfragen derselben URL
- `_tileInserts` Counter: `trimCache()` nur alle 50 Inserts (Performanz)

### 14.4 Message-Handler (App → SW)

| Nachricht | Aktion |
|---|---|
| `SKIP_WAITING` | Sofort aktivieren |
| `CLEAR_TILE_CACHE` | Tile-Cache löschen |
| `PREFETCH_GPX` | GPX-URLs mit Deduplikation cachen |
| `PREFETCH_TILES` | Batch-Tile-Prefetch (Concurrency=6) |
| `GET_CACHE_SIZE` | Einträge pro Cache zurückgeben |
| `CLEAR_ALL_CACHES` | Alle Caches löschen |

### 14.5 Offline-Fallback

Vollständige HTML-Seite mit Offline-Hinweis, Tipps und Reload-Button (in `OFFLINE_HTML` im SW eingebettet).

---

## 15. THEME-SYSTEM

### 15.1 CSS-Variablen

| Variable | Dunkel | Hell |
|---|---|---|
| `--bg` | #0b0e14 | #f5f5f0 |
| `--s1` | #14171f | #ffffff |
| `--s2` | #1c2029 | #f0efe8 |
| `--tx` | #e8eaed | #1a1a1a |
| `--ac` | #c8ff00 | #7ab800 |
| `--bd` | #2a2e38 | #d5d3c8 |

### 15.2 Umschaltung

- `data-theme="dark"` / `data-theme="light"` auf `<html>`
- `data-a11y-hc` Attribut für hohen Kontrast (nur im hellen Modus)
- Persistiert in localStorage (`ccx_theme`)

---

## 16. PROJEKT-SYSTEM

### 16.1 Konzept

Projekte isolieren Strecken und Marker voneinander. Jedes Projekt hat:
- Eigenen Fokuspunkt (Lat/Lng/Zoom)
- Eigene Strecken und Marker (via `projectId`)
- Aktivierungs-Toggle (ein-/ausblenden)

### 16.2 Standard-Projekt

- ID: `proj_<timestamp>`
- Name: "Unicon22 Cyclocross" (Konstante `DEFAULT_PROJECT_NAME`)
- Fokus: Start/Ziel Schlosspark Steyr (48.041479°N, 14.417132°E)
- Alt-Namen "Standard" und "GMTW" werden beim Start automatisch umbenannt
- Kann nicht gelöscht werden

### 16.3 Projekt-Erstellung

1. Doppelklick auf Karte → Fokuspunkt setzen
2. Name eingeben (max 40 Zeichen)
3. Aktion wählen: Marker setzen, GPX laden, JSON importieren, oder nur erstellen

---

## 17. BACKUP & EXPORT

### 17.1 Vollständiges Backup (JSON)

Enthält:
- Alle Tracks (Metadaten + GPX-Strings)
- Alle Custom Markers
- Alle Rennzeiten
- Alle Track-Features und Ratings
- Profil-Daten
- Projekt-Konfiguration

### 17.2 Teil-Exporte

| Export | Format | Inhalt |
|---|---|---|
| Marker | JSON | Alle benutzerdefinierten Marker |
| Zeiten | JSON oder CSV | Alle Rennläufe aller Strecken |
| Projekt | JSON | Einzelnes Projekt mit allen Daten |
| Aufnahme | GPX oder JSON | Einzelne GPS-Aufnahme |
| Rennergebnis | GPX | GPS-Track des Rennlaufs |

---

## 18. PWA-INSTALLATION

### 18.1 Erkennung

- `beforeinstallprompt` Event (Chrome/Edge)
- Manuelle Anleitung für iOS Safari ("Zum Homescreen")
- `display-mode: standalone` Detection (bereits installiert)

### 18.2 Install-Prompt

- Erscheint automatisch nach 30s Nutzung
- "Nicht mehr fragen" Option (persistent über localStorage)
- Geräte-spezifische Anleitung (iOS, Android, Desktop)

### 18.3 Manifest-Konfiguration

```json
{
  "name": "Unicon22 Cyclocross",
  "short_name": "Unicon22 Cyclocross",
  "display": "standalone",
  "display_override": ["window-controls-overlay", "standalone", "minimal-ui"],
  "orientation": "any",
  "theme_color": "#0b0e14",
  "categories": ["sports", "navigation", "maps"]
}
```

---

## 19. SICHERHEIT

### 19.1 XSS-Schutz

**Escape-Funktionen:**
- `escHtml(s)`: Escaped `& < > " '` (für HTML-Inhalte)
- `esc(s)`: JS-String-Escape + HTML-Attribut-Escape (für onclick-Attribute)
- `escXml(s)`: Escaped `& < >` (für GPX-XML-Erzeugung)

### 19.2 SRI (Subresource Integrity)

Alle 5 CDN-Bibliotheken haben SHA-384 Integrity-Hashes + `crossorigin="anonymous"`.

### 19.3 Content Security

- Keine externe Datenübertragung (rein clientseitig)
- Kein Tracking, keine Cookies
- DSGVO-konforme Schriften (Bunny Fonts, EU-Hosting)
- Kamera-Zugriff nur nach expliziter Erlaubnis

### 19.4 Bekannte Einschränkungen

- HMAC-Signierung ist Client-Only (kein Server zur Validierung)
- Race-Ergebnisse können von technisch versierten Nutzern gefälscht werden
- LocalStorage-Daten sind im Browser-DevTools einsehbar

---

## 20. PERFORMANCE-OPTIMIERUNGEN

| Technik | Beschreibung |
|---|---|
| Tile-Dedup (SW) | Verhindert doppelte gleichzeitige Tile-Requests |
| Batch-Trim (SW) | Cache.keys() nur alle 50 Inserts statt bei jedem |
| requestIdleCallback | Tile-Prefetch blockiert nicht den Main Thread |
| Debounced Prefetch | 1400ms Verzögerung nach Kartenbewegung |
| Center-First Tile Order | Naheste Tiles werden zuerst gecacht |
| Adaptive GPS Filter | Lockert Schwellen bei wenigen Punkten |
| RDP-Vereinfachung | Reduziert QR-Datenmenge auf max. 1000 Punkte |
| DEFLATE Level 9 | Maximale Kompression für QR-Transfer |
| Auto-Save Interval | 5s statt pro Punkt (reduziert I/O) |

---

## ANHANG A: GPX-STRECKEN

| Quelle | Kategorie | Punkte | Länge | Beschreibung |
|---|---|---|---|---|
| `BUILTIN_TRACKS` (index.html), Version 11 | mittel | 141 | ~920 m | Rundkurs Schlosspark — reine Runde |
| gpx/Unicon22_Rundkurs.gpx | mittel | 141 | ~920 m | dieselbe Strecke als Datei |

> **Version 11:** Wiesen-Kurve am Südrand ergänzt — der Kurs verlässt den
> Südweg vor der Biegung, wölbt sich ~13 m nach Norden in die Wiese und
> kehrt ~45 m weiter östlich auf den Weg zurück (Ansatzpunkte exakt auf der
> Weggeometrie). Geprüft: 0 Barrieren, 0 Gebäude, keine Selbstüberschneidung.

> **Version 10:** Der Abschnitt Kraftpark→Spielplatz ist Punkt für Punkt von
> der eingezeichneten Linie der Veranstalterin übertragen (Topo-Zoombild,
> 0,07 m/px; Anker: beide Kartenmarker, Zaunende als Kontrollpunkt):
> Schleife SW des Kraftpark-Markers → enger Zickzack → Bogen unten um das
> offene Zaunende → Finger innen am Zaun → untere Wanne nach Westen →
> Haarnadel westlich des Spielplatz-Markers → Schlenker zur Baumreihe.
> Geprüft: 0 Barrieren gekreuzt, 0 Gebäude, keine Selbstüberschneidung,
> Zeitnahme-Linie auf der Rundeneinfahrt.

> **Version 9 — Barrieren-Prüfung:** Der Spielplatz ist an der Nordostseite
> eingezäunt (OSM-Zaun 1305603443). Die Serpentinen verlaufen östlich des
> Zauns, die Runde führt um das offene Zaunende im Südosten (2,5 m Abstand
> zum Endpfosten) und macht dann die Schleife um den Spielplatz. Gegen alle
> erfassten Barrieren geprüft (Zäune, Mauern, Hecken): **0 Kreuzungen**,
> ebenso 0 Gebäude und keine Selbstüberschneidung.

> **Version 8:** Der Zickzack-Abschnitt Kraftpark/Spielplatz folgt der grün
> eingezeichneten Linie der Veranstalterin (Zoom-Screenshot, kalibriert über
> die beiden Kartenmarker, 0,20 m/px): **Schleife im Kraftpark**, Zickzack
> unter dem Marker, **Serpentinen im Sandstreifen**, **W-Zickzack im
> Spielplatz**, Baumreihe zum Klo mit scharfer Kehre, Slalom zurück.
> In der App gibt es außerdem einen **Zeichenmodus** (📊 → Laden →
> ✏️ Zeichenmodus): Strecke direkt auf der Karte antippen und speichern.

**Aufbau:** Die Strecke ist eine **reine Runde ohne Start/Ziel-Stich**. Sie
beginnt und endet an der Rundeneinfahrt am Nordrand (48.041515, 14.416906),
**17 m westlich der Start/Ziel-Flagge**. Die Flagge markiert den Start der
ersten und das Ziel der letzten Runde, ist aber nicht Teil der Runde — dort
biegt man stattdessen links in die nächste Runde ab. Die Zeitnahme-Linie der
App sitzt an der Rundeneinfahrt und zählt jede Durchfahrt.

**Verlauf (Fahrtrichtung):** nach **Westen** über die Nordrand-Diagonale →
**auf dem Westweg hinab bis auf Höhe des Kraftparks** (kein Schnitt über das
Gebäude) → Ost-Einstieg, **Zickzack durch den Kraftpark** → **Serpentine quer
durch den Spielplatz** (4 Bahnen: Kletterhaus, Wackelplattformen,
Elefantenrutsche, Sandkasten) → am Klo vorbei mit **scharfer Kehre** am
Kiesfeld → Südrand nach Osten → an der Abzweigung **scharf links zum See** →
**an der Innenseite (Westufer) entlang** (kleiner Weg, in OSM nicht erfasst —
aus dem Seeumriss mit 3,5 m Abstand konstruiert) → am Seeende scharf rechts
über den Baumstuhl mit Baumslalom → Nordweg zurück zur Rundeneinfahrt.

| Prüfung | Ergebnis |
|---|---|
| Runde geschlossen | 0 m |
| Selbstüberschneidungen | keine |
| Gebäude gekreuzt | 0 |
| Östlichster Punkt | 14.416906 (die Einfahrt selbst) — Ostseite komplett frei |
| Kraftpark-Zickzack / Spielplatz-Serpentine | alle Punkte innerhalb der Flächen |
| See | Innenseite (Westufer), ~12 m von der Seemitte |
| Rennsimulation | Zeitnahme-Linie auf der Rundeneinfahrt |

> Die Schlangenlinien an den Geräten sind repräsentativ — die exakten
> Standorte der Spielgeräte stehen in keiner Karte. Nach dem ersten
> Abfahren die Aufzeichnung importieren, dann stimmt auch das Detail.

**Herkunft und Genauigkeit:** Die Linie ist aus den in OpenStreetMap
vermessenen Parkwegen sowie den Grenzen von Spielplatz und Kraftpark
zusammengesetzt; die Reihenfolge
der Abschnitte folgt dem Foto einer Streckenaufzeichnung. Die Koordinaten sind
damit metergenau, aber die engen Kehren des abgesteckten Kurses auf der Wiese
fehlen — die tatsächlich gefahrene Runde ist länger als 1150 m. Für die
Zeitmessung ist das ohne Belang, die zählt über die Start-/Ziellinie; nur die
angezeigte Rundenlänge fällt zu niedrig aus.

**Ersetzen durch die abgefahrene Aufzeichnung:** In der App über 📊 → Laden
importieren (bleibt dauerhaft gespeichert), oder `BUILTIN_TRACKS` austauschen
und `version` hochzählen.

**Strecke aufnehmen und offiziell machen:**

1. Kurs vor Ort mit ⏺ (GPS-Aufnahme) abfahren
2. Aufnahme als GPX exportieren
3. Datei nach `gpx/` legen
4. In `index.html` bei `AUTO_TRACKS` eintragen:
   `{ name:'Rundkurs Schlosspark', cat:'mittel', file:'Steyr2026_Rundkurs.gpx' }`

Einzelne GPX-Dateien lassen sich ohne Codeänderung über das GPX-Panel
(📊 → Tab "Laden") importieren — Dateiauswahl, Mehrfachauswahl,
Drag & Drop oder URL.

## ANHANG B: TRAIL-PUNKTE (LOCS)

| ID | Name | Kategorie | Koordinaten | Emoji | Quelle |
|---|---|---|---|---|---|
| start-ziel | Start / Ziel | logistik | 48.041479, 14.417132 | 🏁 | Vorgabe Veranstalter |
| spielplatz | Spielplatz | logistik | 48.040284, 14.414686 | 🛝 | Google-Maps-Eintrag „Spielplatz im Stadtpark" |
| kraftpark | Kraftpark | logistik | 48.040394, 14.415200 | 💪 | OpenStreetMap `leisure=fitness_station`, way/744277003 |
| verpflegung | Essen & Trinken | logistik | 48.041430, 14.417060 | 🍽️ | am Start, Vorgabe Veranstalter |
| wc-spielplatz | WC Spielplatz | logistik | 48.040263, 14.414170 | 🚻 | OpenStreetMap `amenity=toilets` (Klohäuschen beim Haus Nr. 12) |
| checkin-1 | Check-in 1 | logistik | 48.041473, 14.417415 | 📋 | grüne Markierung der Veranstalterin — Zugangsweg NO-Eingang |
| checkin-2 | Check-in 2 | logistik | 48.041433, 14.417437 | 📋 | dito, 9-m-Reihe NNW→SSO, ~23 m östlich der Flagge |
| checkin-3 | Check-in 3 | logistik | 48.041394, 14.417458 | 📋 | dito |

### Renn-Modi (Klassen)

Vor dem Start am Start/Ziel-Punkt wählbar (`ccx_race_mode_v1`):

| Modus | Fahrzeit | Wertung |
|---|---|---|
| Kids | 20 min | so viele Runden wie möglich; nach Ablauf wird die laufende Runde zu Ende gefahren |
| Beginner | 30 min | wie oben |
| Elite | 45 min | wie oben |
| Feste Runden | — | klassisch: einstellbare Rundenzahl (1–30) |

Im Zeitmodus zeigt die Rennanzeige Rundenzähler und Restzeit; bei Ablauf
erscheint „LETZTE RUNDE!" (mit Vibration und Ansage), und die nächste
Zieldurchfahrt beendet den Lauf. Das Laufergebnis speichert `raceMode`,
`timeLimitMin` und die gefahrenen Runden.

### Strecken-Info (5 Sprachen)

Über das Start/Ziel-Popup (ℹ️ Strecken-Info) öffnet sich der Course Guide
mit Renntag-Infos, Le-Mans-Startprozedur, Klassen und der kompletten
Streckenbeschreibung in 14 Schritten — auf Deutsch, Englisch, Französisch,
Spanisch und Japanisch (Konstante `COURSE_INFO` in `index.html`).

Start/Ziel stammt aus der Konstante `START_FINISH`, Farbe abweichend von der
Kategorie: UNICON-Orange #f5a623, `large: true`. Der Spielplatz im Südwesten
wird laut Veranstalter in den Kurs eingebunden; Farbe UNICON-Violett #5b4e8c.
