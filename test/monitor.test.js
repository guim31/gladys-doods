// -----------------------------------------------------------------------------
// The monitor against the simulated DOODS and cameras (test/helpers): states,
// images, scene events on appearance only, regular analyses for the added
// devices only, failures (camera, server, detector), actions shown in red on
// failure, the widget.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { normalizeConfig, parseConfidence, parseLabels } from '../src/config.js';
import { DoodsClient, DoodsError, parseServerUrl } from '../src/doods.js';
import { SnapshotError, fetchSnapshot, redact } from '../src/snapshot.js';
import { BASE_CONFIG, CAMERA_HOST, FakeDoods, createAll, createWorld } from './helpers/world.js';

const ID = {
  front: 'ext:test-integration:camera:1',
  garden: 'ext:test-integration:camera:2',
};
const last = (world, id) => world.fake.lastState(id);
const text = (world, id) => {
  const state = world.fake.states.filter((item) => item.device_feature_external_id === id).pop();
  return state?.text;
};

test('configuration: labels, confidence, slots, defaults', () => {
  assert.deepEqual(parseLabels(' Person, CAR;; traffic  light,person '), [
    'person',
    'car',
    'traffic light',
  ]);
  assert.deepEqual(parseLabels('person, *'), ['*']);
  assert.equal(parseLabels('a,b,c,d,e,f,g,h,i').length, 8);
  assert.equal(parseConfidence('55 %'), 55);
  assert.equal(parseConfidence('72,5'), 72);
  assert.equal(parseConfidence('0'), null);
  assert.equal(parseConfidence('abc'), null);

  const config = normalizeConfig({
    ...BASE_CONFIG,
    confidence: '70',
    camera_2_labels: 'dog',
    camera_2_confidence: '40',
    camera_3_url: '   ',
    camera_4_url: 'not a url',
  });
  assert.equal(config.intervalSeconds, 60);
  assert.equal(config.detector, 'default');
  assert.deepEqual(
    config.cameras.map((camera) => [
      camera.slot,
      camera.labels,
      camera.confidence,
      camera.validUrl,
    ]),
    [
      [1, ['person', 'car', 'cat', 'dog'], 70, true],
      [2, ['dog'], 40, true],
      [4, ['person', 'car', 'cat', 'dog'], 70, false],
    ],
  );
  const defaults = normalizeConfig({});
  assert.equal(defaults.language, 'fr');
  assert.equal(defaults.validUrl, false);
  assert.equal(normalizeConfig({ interval: '42' }).intervalSeconds, 60);
});

test('addresses: DOODS port 8080 by default, camera credentials never shown', () => {
  assert.equal(parseServerUrl('192.0.2.10'), 'http://192.0.2.10:8080');
  assert.equal(parseServerUrl('doods.lan:9000/'), 'http://doods.lan:9000');
  assert.equal(parseServerUrl('https://doods.example/'), 'https://doods.example');
  assert.equal(parseServerUrl('ftp://x'), null);
  assert.equal(parseServerUrl(''), null);
  assert.equal(redact('rtsp://admin:secret@192.0.2.30:554/stream'), 'rtsp://192.0.2.30:554');
  assert.equal(redact('nope'), '(invalid address)');
});

test('the client sends what DOODS expects and reads its answers and errors', async () => {
  const server = new FakeDoods();
  const client = new DoodsClient({ url: '192.0.2.10', fetch: server.fetch });
  const detectors = await client.detectors();
  assert.deepEqual(
    detectors.map((item) => [item.name, item.type, item.labels.length]),
    [
      ['default', 'tflite', 80],
      ['tensorflow', 'tensorflow', 80],
    ],
  );
  server.streams.set('rtsp://192.0.2.30/live', 'car');
  const result = await client.detect({
    detector: 'default',
    data: 'rtsp://192.0.2.30/live',
    labels: ['car', 'truck'],
    confidence: 40,
  });
  assert.deepEqual(
    result.detections.map((item) => `${item.label}:${Math.round(item.confidence)}`),
    ['car:66', 'car:48', 'car:45'],
  );
  assert.ok(result.image.length > 0);
  const body = JSON.parse(server.requests.at(-1).body);
  assert.deepEqual(body, {
    detector_name: 'default',
    data: 'rtsp://192.0.2.30/live',
    detect: { car: 40, truck: 40 },
    image: 'jpeg',
  });
  await assert.rejects(
    client.detect({ detector: 'yolo', data: 'x', labels: ['*'], confidence: 50 }),
    (err) => err instanceof DoodsError && err.kind === 'detector',
  );
  await assert.rejects(
    client.detect({ detector: 'default', data: 'aGVsbG8=', labels: ['*'], confidence: 50 }),
    (err) => err instanceof DoodsError && err.kind === 'image',
  );
  server.down = true;
  await assert.rejects(client.detectors(), (err) => err.kind === 'unreachable');
});

test('a snapshot URL with credentials becomes a Basic header; a page is not an image', async () => {
  const server = new FakeDoods();
  server.camera('locked', 'person', { auth: 'admin:p@ss' });
  const bytes = await fetchSnapshot(new URL(`http://admin:p%40ss@192.0.2.20/locked.jpg`), {
    fetch: server.fetch,
  });
  assert.equal(bytes[0], 0xff);
  const request = server.requests.at(-1);
  assert.equal(request.url, `${CAMERA_HOST}/locked.jpg`, 'no credentials in the URL');
  await assert.rejects(
    fetchSnapshot(new URL(`${CAMERA_HOST}/locked.jpg`), { fetch: server.fetch }),
    (err) => err instanceof SnapshotError && err.kind === 'auth',
  );
  server.camera('portal', 'person', { html: true });
  await assert.rejects(
    fetchSnapshot(new URL(`${CAMERA_HOST}/portal.jpg`), { fetch: server.fetch }),
    (err) => err.kind === 'format',
  );
});

test('connected: the devices are published and the status is green', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.external_id),
    [ID.front, ID.garden],
  );
  // Nothing is analyzed before the user adds a device.
  await world.monitor.tick();
  assert.equal(world.server.requests.filter((r) => r.url.endsWith('/detect')).length, 0);
});

test('adding a device analyzes it and sends every state, the image and the badge', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  assert.equal(last(world, `${ID.front}:object`), 1);
  // Recorded on a real photo: one person and cars, the cars above 60 %.
  assert.equal(text(world, `${ID.front}:objects`), 'Car ×2, Person');
  assert.equal(last(world, `${ID.front}:count-person`), 1);
  assert.equal(last(world, `${ID.front}:count-car`), 2);
  assert.equal(last(world, `${ID.front}:count-dog`), 0);
  assert.equal(text(world, `${ID.garden}:objects`), 'Cat');
  assert.deepEqual(
    world.fake.cameraImages.map((item) => item.device_external_id),
    [ID.front, ID.garden],
  );
  assert.match(world.fake.cameraImages[0].image, /^image\/jpg;base64,\/9j\//);
  assert.deepEqual(
    world.fake.transports.map((item) => [item.device_external_id, item.transport]),
    [
      [ID.front, 'local'],
      [ID.garden, 'local'],
    ],
  );
  // The device creation is not a regular analysis: no scene event.
  assert.deepEqual(world.fake.sceneEvents, []);
  assert.ok(world.fake.widgetRefreshes.length > 0);
});

test('regular analyses: only changes are published, an event when an object appears', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  world.clock.advance(60_000);
  await world.monitor.tick();
  // First regular analysis: what is there "appears" once.
  assert.deepEqual(
    world.fake.sceneEvents.map((event) => [event.key, event.data.camera, event.data.label]),
    [
      ['object_detected', ID.front, 'car'],
      ['object_detected', ID.front, 'person'],
      ['object_detected', ID.garden, 'cat'],
    ],
  );
  assert.deepEqual(world.fake.sceneEvents[1].data, {
    camera: ID.front,
    camera_name: 'Front door',
    label: 'person',
    label_name: 'Person',
    count: 1,
    confidence: 68,
  });
  const states = world.fake.states.length;
  world.clock.advance(60_000);
  await world.monitor.tick();
  assert.equal(world.fake.states.length, states, 'nothing changed, nothing published');
  assert.equal(world.fake.sceneEvents.length, 3, 'still there: no new event');

  // The person leaves the garden camera's view… then a car comes into it.
  world.server.scene('garden', 'empty');
  world.clock.advance(60_000);
  await world.monitor.tick();
  assert.equal(last(world, `${ID.garden}:object`), 0);
  assert.equal(text(world, `${ID.garden}:objects`), 'None');
  world.server.scene('garden', 'car');
  world.clock.advance(60_000);
  await world.monitor.tick();
  assert.deepEqual(
    world.fake.sceneEvents.slice(3).map((event) => [event.data.camera, event.data.label]),
    [[ID.garden, 'car']],
  );
  assert.equal(last(world, `${ID.garden}:count-car`), 1);
});

test('the threshold and the labels of a camera are sent to DOODS and applied', async (t) => {
  const world = await createWorld({
    config: { ...BASE_CONFIG, camera_1_labels: 'car', camera_1_confidence: '40' },
  });
  t.after(() => world.app.stop());
  await createAll(world);
  const body = JSON.parse(
    world.server.requests.find((r) => r.url.endsWith('/detect') && r.body.includes('"car":40'))
      .body,
  );
  assert.deepEqual(body.detect, { car: 40 });
  // Cars at 62, 61, 55, 54, 54, 51, 48, 46, 44 % on the recorded photo; no person counted.
  assert.equal(last(world, `${ID.front}:count-car`), 9);
  assert.equal(text(world, `${ID.front}:objects`), 'Car ×9');
});

test('every label (*): any object above the threshold, no counter', async (t) => {
  const world = await createWorld({ config: { ...BASE_CONFIG, camera_2_labels: '*' } });
  t.after(() => world.app.stop());
  world.server.scene('garden', 'room');
  await createAll(world);
  assert.equal(text(world, `${ID.garden}:objects`), 'Bed, Chair');
});

test('a regular analysis skips a camera analyzed on demand less than half an interval ago', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const detects = () => world.server.requests.filter((r) => r.url.endsWith('/detect')).length;
  const before = detects();
  world.clock.advance(20_000);
  await world.monitor.tick();
  assert.equal(detects(), before);
  world.clock.advance(20_000);
  await world.monitor.tick();
  assert.equal(detects(), before + 2);
});

test('the scene action analyzes now and returns outputs, without firing an event', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const ack = await world.fake.sceneAction('analyze', { camera: ID.front });
  assert.deepEqual(ack, {
    success: true,
    data: {
      outputs: {
        detected: true,
        objects: 'Car ×2, Person',
        count: 3,
        persons: 1,
        confidence: 68,
      },
    },
  });
  assert.deepEqual(world.fake.sceneEvents, []);
  const failed = await world.fake.sceneAction('analyze', {
    camera: 'ext:test-integration:camera:9',
  });
  assert.equal(failed.success, false);
});

test('a camera that stops answering: one event, a red badge, a red action; then back', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  world.server.cameras.get('front').down = true;
  world.clock.advance(60_000);
  await world.monitor.tick();
  world.clock.advance(60_000);
  await world.monitor.tick();
  assert.deepEqual(
    world.fake.sceneEvents
      .filter((event) => event.key === 'camera_unreachable')
      .map((event) => event.data),
    [{ camera: ID.front, camera_name: 'Front door' }],
  );
  const badges = () =>
    world.fake.transports
      .filter((item) => item.device_external_id === ID.front)
      .map((item) => item.transport);
  assert.equal(badges().at(-1), 'unreachable');
  const ack = await world.fake.sceneAction('analyze', { camera: ID.front });
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /L'image de la caméra n'a pas pu être lue/);
  // The widget says it.
  const widget = await world.fake.widgetGet('camera', {
    settings: { camera: ID.front },
    language: 'en',
  });
  assert.match(widget.data.content.components[0].text, /image not read/);

  world.server.cameras.get('front').down = false;
  world.clock.advance(60_000);
  await world.monitor.tick();
  assert.deepEqual(badges().slice(-2), ['unreachable', 'local']);
});

test('an RTSP stream is handed to DOODS; one it cannot open is a camera failure', async (t) => {
  const stream = 'rtsp://user:secret@192.0.2.30:554/stream1';
  const world = await createWorld({
    config: { url: '192.0.2.10', language: 'en', camera_3_name: 'Drive', camera_3_url: stream },
  });
  t.after(() => world.app.stop());
  world.server.streams.set(stream, 'car');
  await createAll(world);
  const id = 'ext:test-integration:camera:3';
  assert.equal(text(world, `${id}:objects`), 'Car');
  world.server.streams.delete(stream);
  const ack = await world.fake.sceneAction('analyze', { camera: id });
  assert.equal(ack.success, false);
  assert.match(ack.error.en, /camera image could not be read/);
});

test('DOODS down: the status turns red, comes back by itself; actions fail in red', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  world.server.down = true;
  world.clock.advance(60_000);
  await world.monitor.tick();
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /DOODS ne répond pas/);
  const check = await world.fake.action('check', {});
  assert.equal(check.success, false);
  assert.match(check.error.de, /DOODS antwortet unter dieser Adresse nicht/);
  const scene = await world.fake.sceneAction('analyze', { camera: ID.front });
  assert.equal(scene.success, false);
  assert.ok(scene.error.es);
  // The regular analyses wait; the housekeeping checks the server again.
  world.server.down = false;
  await world.monitor.housekeeping();
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  const ok = await world.fake.action('check', {});
  assert.equal(ok.success, true);
  assert.match(ok.data.message.en, /- Front door: Car ×2, Person \(68 %\)/);
});

test('an unknown detector is said in the status, with the detectors of the server', async (t) => {
  const world = await createWorld({ config: { ...BASE_CONFIG, detector: 'yolo' } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /no detector "yolo".*default, tensorflow/);
  const check = await world.fake.action('check', {});
  assert.equal(check.success, false);
  assert.match(check.error.fr, /pas de détecteur « yolo »/);
});

test('no address: the status asks for one, nothing is published', async (t) => {
  const world = await createWorld({ config: {} });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /Enter the address/);
  assert.deepEqual(world.fake.discoveredDevices, []);
});

test('the check action names labels the detector does not know', async (t) => {
  const world = await createWorld({ config: { ...BASE_CONFIG, labels: 'person, persn' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.action('check', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /does not know: persn/);
});

test('a configuration change re-publishes the devices and keeps unchanged results', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const front = world.monitor.cameras.get(1).result;
  await world.fake.configUpdated({ ...BASE_CONFIG, camera_2_labels: 'dog' });
  assert.equal(world.monitor.cameras.get(1).result, front);
  assert.equal(world.monitor.cameras.get(2).result, null);
  const garden = world.fake.discoveredDevices.find((device) => device.external_id === ID.garden);
  assert.deepEqual(
    garden.features.map((item) => item.external_id.split(':').pop()),
    ['image', 'object', 'objects', 'count-dog'],
  );
});

test('the image Gladys asks for: the last one when fresh, else a new analysis', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const detects = () => world.server.requests.filter((r) => r.url.endsWith('/detect')).length;
  const before = detects();
  const ack = await world.fake.getImage({ external_id: ID.front });
  assert.equal(ack.success, true);
  assert.match(ack.data.image, /^image\/jpg;base64,/);
  assert.equal(detects(), before);
  world.clock.advance(120_000);
  await world.fake.getImage({ external_id: ID.front });
  assert.equal(detects(), before + 1);
});

test('the widget: valid content, the button hidden on demand, analyze now', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const pick = await world.fake.widgetGet('camera', { settings: {}, language: 'de' });
  assert.match(pick.data.content.components[0].text, /Wähle/);
  await createAll(world);
  const ack = await world.fake.widgetGet('camera', {
    settings: { camera: ID.front },
    language: 'es',
  });
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    content.components.map((item) => item.type),
    ['text', 'image', 'status', 'button'],
  );
  assert.deepEqual(content.components[2].items[0], {
    label: 'Objetos',
    icon: 'eye',
    value: 'Coche ×2, Persona',
    color: 'warning',
  });
  const image = await world.fake.widgetGetImage(content.components[1].key);
  assert.equal(image.success, true);
  const hidden = await world.fake.widgetGet('camera', {
    settings: { camera: ID.front, hide_button: true },
    language: 'es',
  });
  assert.ok(!hidden.data.content.components.some((item) => item.type === 'button'));

  const action = await world.fake.widgetAction(
    'camera',
    'analyze_1',
    {},
    {
      settings: { camera: ID.front },
    },
  );
  assert.equal(action.success, true);
  assert.equal(action.data.message.fr, 'Front door: Voiture ×2, Personne (68 %)');
  world.server.cameras.get('front').down = true;
  const failed = await world.fake.widgetAction(
    'camera',
    'analyze_1',
    {},
    {
      settings: { camera: ID.front },
    },
  );
  assert.equal(failed.success, false);
  assert.ok(failed.error.fr);
});

test('the widget shows the name given in Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const device = world.fake.devices.find((item) => item.external_id === ID.front);
  await world.fake.deviceUpdated({ ...device, name: 'Entrée' });
  const ack = await world.fake.widgetGet('camera', {
    settings: { camera: ID.front },
    language: 'fr',
  });
  assert.equal(ack.data.content.components[1].alt, 'Entrée');
});

test('the heartbeat re-sends unchanged states after 12 hours', async (t) => {
  const world = await createWorld({ config: { ...BASE_CONFIG, interval: '0' } });
  t.after(() => world.app.stop());
  await createAll(world);
  const count = world.fake.states.length;
  await world.monitor.housekeeping();
  assert.equal(world.fake.states.length, count);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 13 * 60 * 60 * 1000 });
  await world.monitor.housekeeping();
  assert.ok(world.fake.states.length > count);
});
