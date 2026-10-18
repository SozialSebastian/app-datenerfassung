# Mosaik

Web-App (PWA) fürs iPhone: eigene Fragen anlegen, jeden Tag beantworten, auswerten, alles als Excel exportieren. Die Daten liegen nur auf dem iPhone.

## Funktionen
- **Tag:** Fragen beantworten (einzeln oder per „Abfrage starten“), Ort und Wetter des Tages, Werte aus Apple Health
- **Fragen:** Auswahl (auch mehrere), Skala, Zahl (mit Einheit, Dauer h:mm oder Uhrzeit), Folgefragen, Vorlagen „Arbeit“ (mit Vertrag → effektiver Stundenlohn in der Analyse) und „Freunde“, „Was ist besser?“, Sortieren per Gedrückthalten
- **Ziele:** je Ziel Woche/Monat/Jahr, wiederholen oder einmalig; Stand in der Analyse, Hinweis bei verfehlten Zielen
- **Analyse:** Zeitraum wählbar; Trends (Serien, Normalwert, Wochentage, Rekorde, Jahreszeiten, Zusammenhänge inkl. Orte und Wetter), Ziele, Orte, eine Karte je Frage
- **Freunde:** Kategorien, Labels und Quoten, Stichtage mit Veränderung, Treffen (wen wann zuletzt)
- **Wochenbericht** mit wöchentlicher Mitteilung, **Ziel-Erinnerung**, tägliche **Erinnerung**
- **Grafik erstellen:** Übersichten als PNG; **Excel** mit allen Daten; **Sicherung** als JSON-Datei
- **Apple Health** über einen Kurzbefehl, der Werte an den Mosaik-Dienst (`worker/`) schickt
- **chess.com:** Benutzername eintragen; holt beim Einschalten alle Partien (Elo je Bedenkzeit, Partien, Spielzeit, Punktequote, Genauigkeit, Eröffnungen), danach einmal am Tag

## Aufbau
| Datei | Inhalt |
|---|---|
| `index.html`, `styles.css` | Seite und Aussehen (hell/dunkel) |
| `js/core.js` | Speicher (`localStorage` „taeglich.v1“ – Schlüssel nie ändern), Hilfsfunktionen, Navigation, Antwort-Eingaben |
| `js/day.js` | Tag und Abfrage |
| `js/analysis.js`, `js/trends.js` | Analyse und Trends |
| `js/goals.js`, `js/report.js` | Ziele und Wochenbericht |
| `js/export.js` | Grafik erstellen (PNG) |
| `js/places.js`, `js/weather.js` | Orte und Wetter |
| `js/chess.js` | Schnittstelle chess.com |
| `js/questions.js`, `js/friends.js` | Fragen-Editor und Freunde |
| `js/service.js`, `js/settings.js`, `js/data.js` | Mosaik-Dienst, Einstellungen, Excel/Sicherung |
| `js/start.js` | Start, Updates, Links aus Mitteilungen |
| `sw.js` | Offline-Cache und Mitteilungen |
| `worker/` | Mosaik-Dienst (Cloudflare Worker + D1) |
| `tests/run.mjs` | automatische Tests |

Die Skripte werden in der Reihenfolge aus `index.html` geladen und teilen sich einen gemeinsamen Gültigkeitsbereich. `js/start.js` muss zuletzt kommen.

## Tests
Laufen bei jeder Änderung automatisch auf GitHub (Actions → „Tests“), inkl. Bildschirmfotos hell und dunkel als Download. Lokal:
```
cd tests && npm install && npx playwright install chromium && node run.mjs
```

## Installation aufs iPhone
1. `https://sozialsebastian.github.io/app-datenerfassung/` in Safari öffnen
2. Teilen → „Zum Home-Bildschirm“

## Updates
Nach Änderungen in `sw.js` die `VERSION` erhöhen (und neue Dateien in `FILES` eintragen), damit das iPhone die neue Version lädt.
