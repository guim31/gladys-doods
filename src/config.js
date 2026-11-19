// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Cameras come in four numbered slots (`camera_<n>_…`): the configuration form
// of Gladys has no list field. The slot number is the camera's identity in
// Gladys (its external id), whatever its name or address.
// -----------------------------------------------------------------------------

import { parseServerUrl } from './doods.js';
import { parseCameraUrl } from './snapshot.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Seconds between two analyses of each camera (`interval`); 0 = on demand
// only (scene action, widget button, the image asked by Gladys).
export const INTERVALS = [0, 10, 30, 60, 300, 900, 3600];

// Minimum confidence of a detection, in percent (DOODS speaks percent too).
export const CONFIDENCES = [30, 40, 50, 60, 70, 80, 90];

export const CAMERA_SLOTS = [1, 2, 3, 4];

// Labels searched for at most, per camera: each one is a feature.
export const MAX_LABELS = 8;

// A label list that means "every label the detector knows".
export const ALL_LABELS = '*';

export const DEFAULT_CONFIG = {
  url: '',
  detector: 'default',
  labels: 'person, car, cat, dog',
  confidence: '60',
  interval: '60',
  language: 'fr',
  ...Object.fromEntries(
    CAMERA_SLOTS.flatMap((slot) => [
      [`camera_${slot}_name`, ''],
      [`camera_${slot}_url`, ''],
      [`camera_${slot}_labels`, ''],
      [`camera_${slot}_confidence`, ''],
    ]),
  ),
};

function pick(value, allowed, fallback) {
  const number = Number(value);
  return allowed.includes(number) ? number : Number(fallback);
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * A label list as typed ("Person, car; teddy bear"): lower case, unique, in
 * order, at most MAX_LABELS. `*` alone means every label: `['*']`.
 * COCO labels may hold spaces ("traffic light"): only commas and semicolons
 * separate them.
 */
export function parseLabels(value) {
  const labels = [];
  for (const item of String(value ?? '').split(/[,;\n]/)) {
    const label = item.trim().toLowerCase().replace(/\s+/g, ' ');
    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  }
  if (labels.includes(ALL_LABELS)) {
    return [ALL_LABELS];
  }
  return labels.slice(0, MAX_LABELS);
}

/** A confidence typed by hand ("55", "55 %"): 1 to 100, or null. */
export function parseConfidence(value) {
  const match = /^(\d{1,3})(?:[.,]\d+)?\s*%?$/.exec(text(value));
  if (!match) {
    return null;
  }
  const number = Number(match[1]);
  return number >= 1 && number <= 100 ? number : null;
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const read = (key) => (source[key] === undefined ? DEFAULT_CONFIG[key] : source[key]);
  const url = text(read('url'));
  const labels = parseLabels(read('labels'));
  const confidence = pick(read('confidence'), CONFIDENCES, DEFAULT_CONFIG.confidence);
  const cameras = [];
  for (const slot of CAMERA_SLOTS) {
    const cameraUrl = text(source[`camera_${slot}_url`]);
    if (!cameraUrl) {
      continue;
    }
    const ownLabels = parseLabels(source[`camera_${slot}_labels`]);
    cameras.push({
      slot,
      name: text(source[`camera_${slot}_name`]).slice(0, 80) || `Camera ${slot}`,
      url: cameraUrl,
      validUrl: Boolean(parseCameraUrl(cameraUrl)),
      labels: ownLabels.length > 0 ? ownLabels : labels,
      confidence: parseConfidence(source[`camera_${slot}_confidence`]) ?? confidence,
    });
  }
  return {
    url,
    validUrl: Boolean(parseServerUrl(url)),
    detector: text(read('detector')) || DEFAULT_CONFIG.detector,
    labels,
    confidence,
    intervalSeconds: pick(read('interval'), INTERVALS, DEFAULT_CONFIG.interval),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
    cameras,
  };
}
