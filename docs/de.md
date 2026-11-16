# DOODS

Bringt die **lokale Objekterkennung** von [DOODS](https://github.com/snowzach/doods2) (Dedicated Open
Object Detection Service) in die Bilder deiner Kameras: Gladys weiß, ob eine Person, ein Auto, eine
Katze… im Bild ist, wie viele, und zeigt das Bild mit den Rahmen, die DOODS gezeichnet hat. Alles
bleibt zu Hause: keine Cloud, kein Konto. DOODS analysiert ein Bild auf Anfrage; es ist kein
Videorekorder (dafür gibt es Frigate oder Viseron).

Getestet gegen einen echten DOODS-Server in Docker (snowzach/doods2, CPU, Detektoren `default`
tflite und `tensorflow`) mit freien Fotos (eine Person, Autos, eine Katze, ein leerer Raum), noch
nicht mit echten Kameras im Einsatz: Rückmeldungen sind willkommen auf
[GitHub](https://github.com/guim31/gladys-doods/issues) oder im Gladys-Forum.

## Voraussetzungen

- Gladys 5.1 oder neuer.
- Ein DOODS-Server (Docker-Image `snowzach/doods2`), von Gladys aus über seinen Port erreichbar
  (standardmäßig 8080).
- Für jede Kamera eine Adresse, die DOODS lesen kann: eine **JPEG-Schnappschuss-URL** (die meisten
  IP-Kameras haben eine, z. B. `http://benutzer:passwort@192.168.1.30/snapshot.jpg`) oder ein
  **RTSP-Stream** (`rtsp://…`).

Eine Integration kann das Bild einer Kamera, die schon in Gladys ist, nicht lesen (externe
Integrationen haben diesen Zugriff nicht): Gib die Adresse der Kamera selbst an.

## Installation

1. Starte DOODS, zum Beispiel: `docker run -d --restart unless-stopped -p 8080:8080 snowzach/doods2`.
2. In Gladys **Integrationen → Von GitHub installieren**, Adresse
   `https://github.com/guim31/gladys-doods`.
3. Gib in der Konfiguration die **DOODS-Adresse** ein, dann für jede Kamera (bis zu vier) einen
   **Name** und eine **Bildadresse**.
4. Starte die Aktion **Verbindung prüfen**: Diese nennt den Detektor und analysiert jede Kamera einmal.
5. Öffne den Tab **Entdecken** und füge die Kameras hinzu: ein Gerät pro Kamera.

Einstellungen:

- **Detektor**: `default` (tflite, schnell: etwa 0,3 s pro Bild auf einer CPU) oder `tensorflow`
  (genauer, etwa 2 s, und über eine Minute für sein allererstes Bild, solange das Modell lädt), oder
  jeder in deinem DOODS konfigurierte Detektor.
- **Gesuchte Objekte**: die Labels des Detektors, auf Englisch, durch Kommas getrennt: `person`,
  `car`, `truck`, `bicycle`, `motorcycle`, `cat`, `dog`, `bird`… (die 80 COCO-Labels). `*` behält alle
  Labels. Jede Kamera kann ihre eigene Liste in **Objekte (optional)** haben.
- **Mindestkonfidenz**: Erkennungen darunter werden ignoriert. Eine Kamera kann ihre eigene in
  **Konfidenz in % (optional)** haben.
- **Analyseintervall**: wie oft jede hinzugefügte Kamera analysiert wird, eine nach der anderen.
  **Nur auf Anfrage** analysiert nichts von selbst (Szenenaktion, Widget-Schaltfläche, von Gladys
  angefordertes Bild).
- **Sprache der Namen**: Namen der Funktionen, Objekte und Szenentexte.

**CPU-Last**: Jede Analyse dekodiert ein Bild und lässt das Modell auf dem DOODS-Rechner laufen. Mit
vier Kameras alle 10 Sekunden und dem Detektor `tensorflow` ist ein kleiner Rechner ständig
beschäftigt; 1 Minute mit `default` ist ein vernünftiger Anfang.

## Die Geräte in Gladys

Ein Gerät pro Kamera, mit:

- **Bild**: das zuletzt analysierte Bild, mit den Rahmen von DOODS (für Gladys verkleinert).
- **Objekt erkannt**: eines der gesuchten Objekte ist im Bild (Ja/Nein).
- **Erkannte Objekte**: was im Bild ist, z. B. „Person ×2, Auto“, oder „Keine“.
- Ein Zähler pro gesuchtem Label, z. B. **Person (Anzahl)**, **Auto (Anzahl)** (nicht mit `*`).

Das Abzeichen des Geräts wechselt auf „nicht erreichbar“, wenn das Kamerabild nicht gelesen werden
kann.

## Dashboard-Widget

**DOODS-Kamera**: das analysierte Bild, die gefundenen Objekte, die beste Konfidenz, die Anzahl jedes
gesuchten Labels, die Uhrzeit der Analyse und eine Schaltfläche **Jetzt analysieren** (die
Einstellung **Schaltfläche Analysieren ausblenden** blendet sie aus).

## Szenen

### Auslöser

- **Objekt von DOODS erkannt**: Ein Objekt erscheint bei einer regelmäßigen Analyse (in der vorherigen
  war es nicht da), auf einer Kamera oder auf jeder. Filter auf die Objekte. Variablen: Kamera, Objekt,
  Anzahl, Konfidenz. Ein Ereignis, wenn das Objekt erscheint, nicht eines pro Analyse.
- **Kamerabild nicht gelesen**: Das Bild einer Kamera konnte nicht gelesen werden (erster Fehler in
  Folge).

Die Auslöser kommen nur aus den regelmäßigen Analysen: Mit **Nur auf Anfrage** lösen sie nie aus.

### Aktionen

- **Kamera mit DOODS analysieren**: analysiert die Kamera jetzt und aktualisiert ihr Bild. Ausgaben:
  Objekt erkannt, erkannte Objekte, Anzahl der Objekte, Anzahl der Personen, beste Konfidenz. Die Aktion löst
  keinen Auslöser aus.

### Szenenideen

- Wenn die Haustür aufgeht, **Kamera mit DOODS analysieren**, dann, wenn die Anzahl der Personen über
  0 liegt, schickt dir die Kernaktion „Kamerabild senden“ das Bild mit seinen Rahmen.
- **Objekt von DOODS erkannt** (Person, Gartenkamera) bei aktiver Alarmanlage → Benachrichtigung.
- Ein Auto in der Einfahrt bei Nacht → Außenlicht einschalten.

## Fehlerbehebung

- **DOODS antwortet nicht**: Prüfe Adresse und Port (8080) und ob DOODS läuft (`docker logs`).
- **Kein Detektor „…“**: Der Status listet die Detektoren deines Servers auf; übernimm den Namen in
  **Detektor**.
- **Bild nicht gelesen**: Öffne die Kameraadresse in einem Browser auf dem Gladys-Rechner. Eine
  HTTP-Adresse muss ein JPEG-Bild liefern, keine Seite. Digest-Authentifizierung wird über HTTP nicht
  unterstützt: Nimm stattdessen den RTSP-Stream. Ein RTSP-Stream wird von DOODS selbst gelesen, DOODS
  muss die Kamera also erreichen.
- **Labels, die dieser Detektor nicht kennt**: ein Tippfehler in **Gesuchte Objekte** oder ein anderes
  Modell.
- **Nichts wird erkannt**: Senke die **Mindestkonfidenz** oder probiere den Detektor `tensorflow`.
- Ausführliche Protokolle: `LOG_LEVEL=debug`.

## Grenzen

- Höchstens vier Kameras und acht gezählte Labels pro Kamera.
- Kein Video: ein Bild pro Analyse; ein Objekt, das zwischen zwei Analysen vorbeikommt, wird
  übersehen.
- Keine Erkennungszonen (`regions` von DOODS) in dieser Version.
- Kamerabilder gehen höchstens alle 5 Sekunden pro Kamera an Gladys.
- Nicht mit dem DOODS-Projekt verbunden. Ohne echte Kameras entwickelt: Rückmeldungen willkommen.
