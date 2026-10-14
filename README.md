# Täglich

Web-App (PWA) fürs iPhone: eigene Fragen anlegen, jeden Tag beantworten, alles als Excel exportieren.

- **Antworttypen:** Auswahl (eigene Antworten, z. B. Ja/Nein, optional mehrere gleichzeitig), Skala (z. B. 1–5), Zahl (z. B. Stunden Schlaf)
- **Folgefragen:** erscheinen nur nach einer bestimmten Antwort (z. B. „Welche Schwierigkeiten?“ nur bei „Heute bouldern? = Ja“)
- **Abfrage:** Button „Abfrage starten“ geht alle Fragen des Tages nacheinander durch
- **Speicher:** nur lokal auf dem iPhone. Sicherung als JSON-Datei (z. B. in iCloud Drive)
- **Excel:** Blatt „Antworten“ (eine Zeile pro Tag, eine Spalte pro Frage, immer alle Daten) und Blatt „Fragen“
- **Apple Health:** über einen Kurzbefehl, der `taeglich;schlaf=7,4` in die Zwischenablage kopiert. In der App „Werte aus Health einfügen“ tippen

## Installation aufs iPhone
1. GitHub Pages aktivieren: Settings → Pages → Branch `main`, Ordner `/ (root)`
2. `https://sozialsebastian.github.io/app-datenerfassung/` in Safari öffnen
3. Teilen → „Zum Home-Bildschirm“

## Updates
Nach Änderungen an Dateien in `sw.js` die `VERSION` erhöhen, damit das iPhone die neue Version lädt.
