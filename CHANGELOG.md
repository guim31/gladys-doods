# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Local object detection with DOODS on up to four cameras (JPEG snapshot URL
  or RTSP stream): one Gladys device per camera with its analyzed image (the
  boxes drawn by DOODS), "Object detected", "Objects detected" and one counter
  per searched label.
- Detector, searched labels and minimum confidence, per camera if needed;
  analysis interval from 10 seconds to 1 hour, or on demand only.
- Scene triggers "Object detected by DOODS" (when an object appears) and
  "Camera image not read"; scene action "Analyze a camera with DOODS" with its
  outputs (objects, counts, persons, confidence).
- Dashboard widget "DOODS camera" with an "Analyze now" button.
- "Check the connection" action: the detector, the unknown labels, one
  analysis per camera.
- English, French, German and Spanish.
