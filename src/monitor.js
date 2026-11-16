// -----------------------------------------------------------------------------
// The monitor: the configured cameras, their analyses by DOODS and what
// Gladys gets of them.
//
// An analysis: read the camera picture (src/snapshot.js), send it to DOODS
// with the searched labels and the minimum confidence, publish
//   - the states of the device (only what changed, a heartbeat every 12 h);
//   - the picture with the boxes drawn by DOODS, as the camera image (shrunk
//     to the 150 KB Gladys takes, src/image.js);
//   - an `object_detected` scene event for each label that APPEARS (absent at
//     the previous regular analysis, present now), never one per analysis.
// Regular analyses run on the integration's timer, one camera after the
// other (DOODS takes one CPU-heavy image at a time anyway), for the devices
// added in Gladys only. The analyses a scene asks for publish states and the
// image but fire no event (a scene bound to the event would loop).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ALL_LABELS } from './config.js';
import {
  FEATURE_KEYS,
  buildDevice,
  countKey,
  countedLabels,
  deviceIds,
  labelName,
  slotOf,
  summarize,
  MAX_COUNT,
} from './devices.js';
import { DoodsClient, DoodsError, parseServerUrl } from './doods.js';
import { asCameraImage, fitJpeg } from './image.js';
import { SnapshotError, fetchSnapshot, isStream, parseCameraUrl, redact } from './snapshot.js';
import { CONNECTION_TEXT, FAILURE, ActionFailure, unknownDetector } from './texts.js';

const logger = createLogger({ name: 'doods' });

export const TRIGGERS = {
  OBJECT: 'object_detected',
  UNREACHABLE: 'camera_unreachable',
};

export const WIDGET_KEY = 'camera';

export const DEFAULT_TIMINGS = {
  // Housekeeping: a server down is checked again, unchanged states re-sent.
  housekeepingMs: 60_000,
  heartbeatMs: 12 * 60 * 60 * 1000,
  // Gladys takes 12 camera images a minute per device.
  minImageGapMs: 5000,
};

export class DoodsMonitor {
  /**
   * @param {{ gladys: object, fetch?: typeof fetch, timers?: boolean,
   *   clock?: () => number, timings?: object }} options
   */
  constructor({ gladys, fetch: fetchImpl, timers = true, clock = () => Date.now(), timings }) {
    this.gladys = gladys;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.useTimers = timers;
    this.clock = clock;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.config = null;
    this.client = null;
    // null until checked; then { ok, problem?, detector?, detectors }
    this.server = null;
    this.cameras = new Map();
    this.timers = [];
    this.timeouts = [];
    this.ticking = false;
    // Bumped by each configuration: a run started before drops its result.
    this.generation = 0;
    // One analysis at a time on the DOODS server.
    this.queue = Promise.resolve();
    this.statesFailing = false;
  }

  // --- Life cycle ------------------------------------------------------------

  async start(config) {
    this.applyConfig(config);
    // Timers first: a failed publication below must not leave the
    // integration without its housekeeping.
    this.schedule();
    await this.checkServer();
    await this.publishDevices();
  }

  async reconfigure(config) {
    this.stopTimers();
    this.applyConfig(config);
    this.schedule();
    await this.checkServer();
    await this.publishDevices();
    this.requestWidgetRefresh();
  }

  /** Gladys came back (a reconnection): what it may have lost, again. */
  async resync(config) {
    await this.reconfigure(config);
    for (const camera of this.cameras.values()) {
      this.gladys.forgetPublishedStates?.(this.ids(camera).device);
      await this.publishStates(camera);
    }
  }

  stop() {
    this.stopTimers();
  }

  stopTimers() {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    for (const timer of this.timeouts) {
      clearTimeout(timer);
    }
    this.timers = [];
    this.timeouts = [];
  }

  applyConfig(config) {
    const languageChanged = this.config && this.config.language !== config.language;
    this.config = config;
    this.generation += 1;
    const url = parseServerUrl(config.url);
    this.client = url ? new DoodsClient({ url, fetch: this.fetch }) : null;
    const previous = this.cameras;
    this.cameras = new Map();
    for (const item of config.cameras) {
      const known = previous.get(item.slot);
      // A camera keeps its last result when its settings stay the same.
      const same =
        known &&
        known.url === item.url &&
        JSON.stringify(known.labels) === JSON.stringify(item.labels) &&
        known.confidence === item.confidence &&
        !languageChanged;
      this.cameras.set(item.slot, {
        ...item,
        result: same ? known.result : null,
        detections: same ? known.detections : [],
        image: same ? known.image : null,
        present: same ? known.present : new Set(),
        // `present` holds what the last analysis saw (see fireAppeared).
        seeded: same ? known.seeded : false,
        failure: same ? known.failure : null,
        analyzedAt: same ? known.analyzedAt : 0,
        imagePublishedAt: same ? known.imagePublishedAt : 0,
        imageSeq: known?.imageSeq ?? 0,
        running: null,
      });
    }
  }

  schedule() {
    if (!this.useTimers) {
      return;
    }
    const every = (ms, fn) => {
      const timer = setInterval(() => fn().catch((err) => logger.debug(err.message)), ms);
      timer.unref?.();
      this.timers.push(timer);
    };
    if (this.config.intervalSeconds > 0) {
      every(this.config.intervalSeconds * 1000, () => this.tick());
      // The first analyses without waiting a full interval.
      const first = setTimeout(() => this.tick().catch((err) => logger.debug(err.message)), 1000);
      first.unref?.();
      this.timeouts.push(first);
    }
    every(this.timings.housekeepingMs, () => this.housekeeping());
  }

  // --- DOODS server ------------------------------------------------------------

  async checkServer() {
    if (!this.client) {
      this.server = { ok: false, problem: 'noUrl', detectors: [] };
      await this.setStatus(false, CONNECTION_TEXT.noUrl);
      return this.server;
    }
    const wasOk = this.server?.ok;
    try {
      const detectors = await this.client.detectors();
      const detector = detectors.find((item) => item.name === this.config.detector);
      if (!detector) {
        const again = this.server?.problem === 'detector';
        this.server = { ok: false, problem: 'detector', detectors };
        await this.setStatus(
          false,
          unknownDetector(
            this.config.detector,
            detectors.map((item) => item.name),
          ),
        );
        logger[again ? 'debug' : 'warn'](`DOODS has no detector "${this.config.detector}"`);
        return this.server;
      }
      this.server = { ok: true, detector, detectors };
      await this.setStatus(true);
      if (wasOk === false || wasOk === undefined) {
        logger.info(`DOODS answers, detector ${detector.name} (${detector.type})`);
      }
    } catch (err) {
      const problem = err instanceof DoodsError && err.kind === 'format' ? 'error' : 'unreachable';
      if (this.server?.ok !== false || this.server?.problem !== problem) {
        logger.warn(`DOODS check failed: ${err.message}`);
      } else {
        logger.debug(`DOODS check failed: ${err.message}`);
      }
      this.server = { ok: false, problem, detectors: [] };
      await this.setStatus(false, CONNECTION_TEXT[problem]);
    }
    return this.server;
  }

  async setStatus(connected, message) {
    await this.gladys
      .setConnectionStatus(connected, connected ? undefined : message)
      .catch((err) => logger.debug(`Cannot set the connection status: ${err.message}`));
  }

  /** The searched labels the detector does not know (a typo, another model). */
  unknownLabels() {
    const known = new Set(this.server?.detector?.labels ?? []);
    if (known.size === 0) {
      return [];
    }
    const labels = new Set(
      [this.config.labels, ...[...this.cameras.values()].map((camera) => camera.labels)]
        .flat()
        .filter((label) => label !== ALL_LABELS && !known.has(label)),
    );
    return [...labels];
  }

  // --- Devices -------------------------------------------------------------------

  ids(camera) {
    return deviceIds(this.gladys, camera.slot);
  }

  async publishDevices() {
    const devices = [...this.cameras.values()]
      .filter((camera) => camera.validUrl)
      .map((camera) => buildDevice(this.gladys, camera, this.config.language));
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** The device Gladys holds for this camera, when the user added it. */
  createdDevice(camera) {
    const externalId = this.ids(camera).device;
    return (this.gladys.devices ?? []).find((device) => device.external_id === externalId) ?? null;
  }

  /** The camera of a device external id, or null. */
  resolve(externalId) {
    const slot = slotOf(externalId);
    const camera = slot === null ? null : this.cameras.get(slot);
    return camera && this.ids(camera).device === externalId ? camera : null;
  }

  /** The camera of a device external id, or an ActionFailure. */
  require(externalId) {
    if (!externalId) {
      throw new ActionFailure(FAILURE.pickCamera);
    }
    const camera = this.resolve(externalId);
    if (!camera || !camera.validUrl) {
      throw new ActionFailure(FAILURE.unknownCamera);
    }
    return camera;
  }

  /** The name the user gave the camera in Gladys, else the configured one. */
  nameOf(camera) {
    return this.createdDevice(camera)?.name || camera.name;
  }

  statesOf(camera) {
    const result = camera.result;
    if (!result) {
      return [];
    }
    const ids = this.ids(camera);
    const states = [
      {
        device_feature_external_id: ids.feature(FEATURE_KEYS.OBJECT),
        state: result.total > 0 ? 1 : 0,
      },
      { device_feature_external_id: ids.feature(FEATURE_KEYS.OBJECTS), text: result.text },
    ];
    for (const label of countedLabels(camera)) {
      states.push({
        device_feature_external_id: ids.feature(countKey(label)),
        state: Math.min(result.counts[label] ?? 0, MAX_COUNT),
      });
    }
    // "teddy bear" and "teddy_bear" share a feature: one state.
    return states.filter(
      (state, index) =>
        states.findIndex(
          (other) => other.device_feature_external_id === state.device_feature_external_id,
        ) === index,
    );
  }

  async publishStates(camera) {
    if (!this.createdDevice(camera)) {
      return;
    }
    const states = this.statesOf(camera);
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      if (this.statesFailing) {
        this.statesFailing = false;
        logger.info('States are published to Gladys again');
      }
    } catch (err) {
      const log = this.statesFailing ? 'debug' : 'warn';
      this.statesFailing = true;
      logger[log](`Cannot publish the states of ${camera.name}: ${err.message}`);
    }
  }

  async publishImage(camera, { force = false } = {}) {
    if (!camera.image || !this.createdDevice(camera)) {
      return;
    }
    const now = this.clock();
    if (!force && now - camera.imagePublishedAt < this.timings.minImageGapMs) {
      return;
    }
    camera.imagePublishedAt = now;
    await this.gladys
      .publishCameraImage(this.ids(camera).device, asCameraImage(camera.image.jpeg))
      .catch((err) => logger.debug(`Cannot publish the image of ${camera.name}: ${err.message}`));
  }

  async publishTransport(camera) {
    if (!this.createdDevice(camera)) {
      return;
    }
    await this.gladys
      .publishTransports([
        {
          external_id: this.ids(camera).device,
          transport: camera.failure ? 'unreachable' : 'local',
        },
      ])
      .catch((err) => logger.debug(err.message));
  }

  /** The user added a device: the states sent before were dropped. */
  async onDeviceCreated(device) {
    const camera = this.resolve(device?.external_id);
    if (!camera) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    camera.transportSent = false;
    const fresh = !camera.result && this.server?.ok;
    if (fresh) {
      // Publishes the states and the image itself.
      await this.analyze(camera, { events: false }).catch(() => {});
    } else {
      await this.publishStates(camera);
      await this.publishImage(camera, { force: true });
    }
    if (camera.analyzedAt && !camera.transportSent) {
      camera.transportSent = true;
      await this.publishTransport(camera);
    }
    this.requestWidgetRefresh();
  }

  requestWidgetRefresh() {
    Promise.resolve(this.gladys.requestWidgetRefresh?.(WIDGET_KEY)).catch(() => {});
  }

  // --- Analyses --------------------------------------------------------------------

  /** The regular analyses: each added camera in turn. */
  async tick() {
    if (this.ticking || !this.server?.ok) {
      return;
    }
    this.ticking = true;
    try {
      const halfPeriod = (this.config.intervalSeconds * 1000) / 2;
      for (const camera of this.cameras.values()) {
        if (!camera.validUrl || !this.createdDevice(camera)) {
          continue;
        }
        // Analyzed on demand a moment ago: no need to do it again.
        if (camera.analyzedAt && this.clock() - camera.analyzedAt < halfPeriod) {
          continue;
        }
        await this.analyze(camera, { events: true }).catch(() => {});
      }
    } finally {
      this.ticking = false;
    }
  }

  async housekeeping() {
    if (!this.server?.ok) {
      await this.checkServer();
      if (this.server.ok) {
        this.requestWidgetRefresh();
      }
    }
    for (const camera of this.cameras.values()) {
      await this.publishStates(camera);
    }
  }

  /**
   * Analyze one camera now. Two calls for the same camera while one runs
   * share it. Throws an ActionFailure on failure.
   * @param {object} camera
   * @param {{ events: boolean }} options events: fire the scene events (the
   *   regular analyses only)
   */
  analyze(camera, { events }) {
    if (camera.running) {
      return camera.running;
    }
    const run = this.queue.then(() => this.runAnalysis(camera, { events }));
    this.queue = run.catch(() => {});
    camera.running = run.finally(() => {
      camera.running = null;
    });
    return camera.running;
  }

  async runAnalysis(camera, { events }) {
    const generation = this.generation;
    if (!this.client || !this.server?.ok) {
      throw new ActionFailure(FAILURE.notConfigured);
    }
    const url = parseCameraUrl(camera.url);
    if (!url) {
      throw new ActionFailure(FAILURE.unknownCamera);
    }
    let snapshot = null;
    let result;
    try {
      if (isStream(url)) {
        // DOODS opens the stream itself and reads one frame.
        result = await this.client.detect(this.detectRequest(camera, camera.url));
      } else {
        snapshot = await fetchSnapshot(url, { fetch: this.fetch });
        result = await this.client.detect(this.detectRequest(camera, snapshot.toString('base64')));
      }
    } catch (err) {
      const cameraFault =
        err instanceof SnapshotError || (err instanceof DoodsError && err.kind === 'image');
      if (cameraFault) {
        await this.cameraFailed(camera, err, events);
        throw new ActionFailure(FAILURE.camera);
      }
      await this.doodsFailed(err);
      throw new ActionFailure(FAILURE.doods);
    }
    if (generation !== this.generation) {
      // The configuration changed meanwhile: this camera object is gone.
      return summarize(result.detections, camera, this.config.language);
    }
    const summary = summarize(result.detections, camera, this.config.language);
    const now = this.clock();
    const changed = camera.result?.text !== summary.text;
    camera.result = summary;
    camera.detections = result.detections;
    camera.analyzedAt = now;
    camera.duration = result.duration;
    if (this.doodsFailing) {
      this.doodsFailing = false;
      logger.info('DOODS analyzes again');
    }
    await this.cameraBack(camera);
    // The picture with its boxes; the plain snapshot if DOODS sent none.
    const picture = result.image ?? snapshot;
    if (picture) {
      try {
        camera.image = { jpeg: await fitJpeg(picture), at: now };
        camera.imageSeq += 1;
        // The gap guards the regular analyses; one asked for is shown.
        await this.publishImage(camera, { force: !events });
      } catch (err) {
        logger.debug(`The picture of ${camera.name} does not fit Gladys: ${err.message}`);
      }
    }
    await this.publishStates(camera);
    if (events) {
      await this.fireAppeared(camera, summary);
    } else if (!camera.seeded) {
      // The first look (device added, restart, new settings): what is
      // already in view did not "appear".
      camera.present = new Set(summary.labels);
      camera.seeded = true;
    }
    if (changed) {
      this.requestWidgetRefresh();
    }
    logger.debug(
      `${camera.name}: ${summary.text} (${result.duration ?? '?'} ms, ${redact(camera.url)})`,
    );
    return summary;
  }

  detectRequest(camera, data) {
    return {
      detector: this.config.detector,
      data,
      labels: camera.labels,
      confidence: camera.confidence,
    };
  }

  async fireAppeared(camera, summary) {
    const now = new Set(summary.labels);
    // The first look since a start or new settings only records the scene.
    const seeded = camera.seeded;
    camera.seeded = true;
    for (const label of summary.labels) {
      if (!seeded || camera.present.has(label) || !this.createdDevice(camera)) {
        continue;
      }
      await this.gladys
        .publishSceneEvent(TRIGGERS.OBJECT, {
          camera: this.ids(camera).device,
          camera_name: this.nameOf(camera),
          label,
          label_name: labelName(label, this.config.language),
          count: summary.counts[label],
          confidence: summary.best[label],
        })
        .catch((err) => logger.debug(`Cannot fire ${TRIGGERS.OBJECT}: ${err.message}`));
    }
    camera.present = now;
  }

  async cameraFailed(camera, err, events) {
    const previousNotified = camera.failure?.notified ?? false;
    const first = !camera.failure;
    camera.failure = { at: this.clock(), message: err.message, notified: false };
    if (!first) {
      camera.failure.notified = previousNotified;
    }
    camera.analyzedAt = this.clock();
    if (first) {
      logger.warn(`Camera ${camera.name} (${redact(camera.url)}): ${err.message}`);
      camera.transportSent = true;
      await this.publishTransport(camera);
      this.requestWidgetRefresh();
    } else {
      logger.debug(`${camera.name} (${redact(camera.url)}): ${err.message}`);
    }
    // Once per outage, from a regular analysis (even when an on-demand one
    // saw the failure first).
    if (events && !camera.failure.notified && this.createdDevice(camera)) {
      camera.failure.notified = true;
      await this.gladys
        .publishSceneEvent(TRIGGERS.UNREACHABLE, {
          camera: this.ids(camera).device,
          camera_name: this.nameOf(camera),
        })
        .catch((e) => logger.debug(`Cannot fire ${TRIGGERS.UNREACHABLE}: ${e.message}`));
    }
  }

  async cameraBack(camera) {
    if (camera.failure) {
      camera.failure = null;
      camera.transportSent = true;
      logger.info(`Camera ${camera.name} answers again`);
      await this.publishTransport(camera);
      this.requestWidgetRefresh();
    } else if (!camera.transportSent) {
      // First analysis since the start: the badge says "local".
      camera.transportSent = true;
      await this.publishTransport(camera);
    }
  }

  async doodsFailed(err) {
    if (err instanceof DoodsError && ['unreachable', 'detector', 'format'].includes(err.kind)) {
      // The server itself: checking it again writes the line and tells Gladys.
      logger.debug(`DOODS analysis failed: ${err.message}`);
      await this.checkServer();
      return;
    }
    // A slow model, an HTTP error: one line until an analysis works again.
    const log = this.doodsFailing ? 'debug' : 'warn';
    this.doodsFailing = true;
    logger[log](`DOODS analysis failed: ${err.message}`);
  }

  /** The last result of a camera, worded in `language`. */
  summaryIn(camera, language) {
    return summarize(camera.detections ?? [], camera, language);
  }

  /** A fresh image for Gladys (dashboard, chat, "Send a camera image"). */
  async imageFor(externalId) {
    const camera = this.require(externalId);
    const fresh =
      camera.image &&
      this.clock() - camera.image.at < Math.max(this.config.intervalSeconds, 10) * 1000;
    if (!fresh && this.server?.ok) {
      await this.analyze(camera, { events: false }).catch(() => {});
    }
    // A camera down: no old picture passed off as the current one.
    if (!camera.image || camera.failure) {
      throw new ActionFailure(FAILURE.camera);
    }
    return asCameraImage(camera.image.jpeg);
  }
}
