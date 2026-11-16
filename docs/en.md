# DOODS

Brings the **local object detection** of [DOODS](https://github.com/snowzach/doods2) (Dedicated Open
Object Detection Service) to the images of your cameras: Gladys knows whether a person, a car, a cat…
is in view, how many, and shows the picture with the boxes DOODS drew. Everything stays at home: no
cloud, no account. DOODS analyzes one picture on demand; it is not a video recorder (see Frigate or
Viseron for that).

Tested against a real DOODS server in Docker (snowzach/doods2, CPU, `default` tflite and `tensorflow`
detectors) with free photos (a person, cars, a cat, an empty room), not yet with real cameras in
service: feedback welcome on [GitHub](https://github.com/guim31/gladys-doods/issues) or on the Gladys
forum.

## What you need

- Gladys 5.1 or later.
- A DOODS server (`snowzach/doods2` Docker image), reachable from Gladys on its port (8080 by
  default).
- For each camera, an address DOODS can read: a **JPEG snapshot URL** (most IP cameras have one, e.g.
  `http://user:password@192.168.1.30/snapshot.jpg`) or an **RTSP stream** (`rtsp://…`).

An integration cannot read the image of a camera already in Gladys (no such access for external
integrations): give the camera's own address.

## Installation

1. Start DOODS, for example: `docker run -d --restart unless-stopped -p 8080:8080 snowzach/doods2`.
2. In Gladys, **Integrations → Install from GitHub**, address
   `https://github.com/guim31/gladys-doods`.
3. In the configuration, fill in **DOODS address**, then for each camera (up to four) a **Name** and
   an **Image address**.
4. Run the **Check the connection** action: it lists the detector and analyzes each camera once.
5. Open the **Discovery** tab and add the cameras: one device per camera.

Settings:

- **Detector**: `default` (tflite, fast: about 0.3 s per picture on a CPU) or `tensorflow` (more
  accurate, about 2 s, and over a minute for its very first picture while it loads), or any detector
  configured in your DOODS.
- **Objects to look for**: the detector's labels, in English, separated by commas: `person`, `car`,
  `truck`, `bicycle`, `motorcycle`, `cat`, `dog`, `bird`… (the 80 COCO labels). `*` keeps every label.
  Each camera can have its own list in **Objects (optional)**.
- **Minimum confidence**: detections below it are ignored. A camera can have its own in
  **Confidence in % (optional)**.
- **Analysis interval**: how often each added camera is analyzed, one after the other. **On demand
  only** analyzes nothing by itself (scene action, widget button, image asked by Gladys).
- **Language of the names**: feature names, objects and scene texts.

**CPU load**: each analysis decodes a picture and runs the model on the DOODS machine. With four
cameras every 10 seconds and the `tensorflow` detector, a small machine is busy all the time; 1 minute
with `default` is a sensible start.

## The Gladys devices

One device per camera, with:

- **Image**: the last analyzed picture, with the boxes DOODS drew (shrunk to fit Gladys).
- **Object detected**: one of the searched objects is in view (Yes/No).
- **Objects detected**: what is in view, e.g. "Person ×2, Car", or "None".
- One counter per searched label, e.g. **Person (count)**, **Car (count)** (not with `*`).

The badge of the device turns to "unreachable" when the camera image cannot be read.

## Dashboard widget

**DOODS camera**: the analyzed image, the objects found, the best confidence, the count of each
searched label, when the analysis ran, and an **Analyze now** button (the **Hide the Analyze button**
setting hides it).

## Scenes

### Triggers

- **Object detected by DOODS**: an object appears in a regular analysis (it was absent from the
  previous one), on one camera or any. Filter on the objects. Variables: camera, object, count,
  confidence. One event when the object appears, not one per analysis.
- **Camera image not read**: the picture of a camera could not be read (the first failure in a row).

Triggers come from the regular analyses only: with **On demand only**, they never fire.

### Actions

- **Analyze a camera with DOODS**: analyzes the camera now and updates its image. Outputs: object
  detected, objects detected, number of objects, number of persons, best confidence. It fires no
  trigger.

### Scene ideas

- When the front door opens, **Analyze a camera with DOODS**, then if the number of persons is above
  0, the core's "Send a camera image" action sends you the picture with its boxes.
- **Object detected by DOODS** (person, garden camera) while the alarm is on → notification.
- A car in the driveway at night → turn on the outdoor light.

## Troubleshooting

- **DOODS does not answer**: check the address and port (8080), and that DOODS runs (`docker logs`).
- **No detector "…"**: the status lists the detectors of your server; copy the name into **Detector**.
- **Image not read**: open the camera address in a browser from the Gladys machine. An HTTP address
  must give a JPEG picture, not a page. Digest authentication is not supported over HTTP: use the
  RTSP stream instead. An RTSP stream is read by DOODS itself, so DOODS must reach the camera.
- **Labels this detector does not know**: a typo in **Objects to look for**, or another model.
- **Nothing is detected**: lower **Minimum confidence**, or try the `tensorflow` detector.
- Detailed logs: `LOG_LEVEL=debug`.

## Limits

- Four cameras at most, and eight counted labels per camera.
- No video: one picture per analysis; an object passing between two analyses is missed.
- No detection regions (DOODS `regions`) in this version.
- Camera images go to Gladys at most every 5 seconds per camera.
- Not affiliated with the DOODS project. Developed without real cameras: feedback welcome.
