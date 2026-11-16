// -----------------------------------------------------------------------------
// A simulated DOODS server and IP cameras, behind one `fetch`.
//
// DOODS (http://192.0.2.10:8080): `/detectors` answers the list RECORDED from
// a real snowzach/doods2 (test/fixtures/doods/detectors.json); `/detect`
// answers the detections RECORDED on real photos (detect-*.json, threshold
// 30 %, detector "default"), filtered by the `detect` of the request the way
// DOODS does (doods.py filter_detections), and errors like DOODS: 400 with
// `{ error }` for an unknown detector, a bare 500 for an image it cannot read
// or a stream it cannot open.
// Cameras (http://192.0.2.20/<name>.jpg): each serves a small JPEG standing
// for one recorded scene; `scene(name, sceneName)` changes what it "sees".
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { smallJpeg } from './jpeg.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/doods/${name}`, import.meta.url), 'utf8'));

export const SCENES = {
  person: fixture('detect-person.json'),
  car: fixture('detect-car.json'),
  cat: fixture('detect-cat.json'),
  room: fixture('detect-room.json'),
  empty: { detections: [], duration: 90 },
};

export const DOODS_URL = 'http://192.0.2.10:8080';
export const CAMERA_HOST = 'http://192.0.2.20';

/** doods.py filter_detections, without regions. */
function filter(detections, detect) {
  return detections.filter((item) =>
    item.label in detect
      ? item.confidence >= detect[item.label]
      : '*' in detect && item.confidence >= detect['*'],
  );
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export class FakeDoods {
  constructor() {
    this.detectors = fixture('detectors.json');
    this.down = false;
    this.requests = [];
    // camera name → { scene, bytes, auth?, down? }
    this.cameras = new Map();
    this.streams = new Map(); // rtsp URL → scene name
    this.byImage = new Map(); // base64 → scene name
    this.shade = 40;
    this.camera('front', 'person');
    this.camera('garden', 'cat');
    this.fetch = this.fetch.bind(this);
  }

  camera(name, scene, options = {}) {
    const bytes = smallJpeg(64, 36, (this.shade += 20));
    this.byImage.set(bytes.toString('base64'), scene);
    this.cameras.set(name, { scene, bytes, ...options });
    return `${CAMERA_HOST}/${name}.jpg`;
  }

  scene(name, scene) {
    const camera = this.cameras.get(name);
    camera.scene = scene;
    this.byImage.set(camera.bytes.toString('base64'), scene);
  }

  async fetch(input, init = {}) {
    const url = new URL(String(input));
    this.requests.push({
      url: url.toString(),
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body,
    });
    if (url.origin === new URL(DOODS_URL).origin) {
      if (this.down) {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      return this.doods(url, init);
    }
    if (url.origin === CAMERA_HOST) {
      const camera = this.cameras.get(url.pathname.replace(/^\/|\.jpg$/g, ''));
      if (!camera || camera.down) {
        throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
      }
      if (
        camera.auth &&
        init.headers?.authorization !== `Basic ${Buffer.from(camera.auth).toString('base64')}`
      ) {
        return new Response('Unauthorized', { status: 401 });
      }
      if (camera.html) {
        return new Response('<html>login</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      // Each camera image stands for its current scene.
      this.byImage.set(camera.bytes.toString('base64'), camera.scene);
      return new Response(camera.bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  }

  doods(url, init) {
    if (url.pathname === '/detectors') {
      return json(200, this.detectors);
    }
    if (url.pathname !== '/detect' || init.method !== 'POST') {
      return json(404, { detail: 'Not Found' });
    }
    const body = JSON.parse(init.body);
    const known = this.detectors.detectors.map((item) => item.name);
    if (!known.includes(body.detector_name || 'default')) {
      return json(400, { detections: [], error: `unknown detector name: ${body.detector_name}` });
    }
    const scene = /^(rtsp|http|ftp)/.test(body.data)
      ? this.streams.get(body.data)
      : this.byImage.get(body.data);
    if (!scene) {
      return new Response('Internal Server Error', { status: 500 });
    }
    const recorded = SCENES[scene];
    const response = {
      detections: filter(recorded.detections, body.detect ?? {}),
      duration: recorded.duration,
    };
    if (body.image) {
      // The picture "with the boxes": the camera image itself, re-encoded.
      response.image = smallJpeg(64, 36, 200).toString('base64');
    }
    return json(200, response);
  }
}
