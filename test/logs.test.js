// The info level keeps the life of the integration only (start, server or
// camera lost and back, user actions): nothing per analysis, per state or per
// image, and a failure tried again and again is one line, then one when it
// ends. Never a camera password.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CONFIG, createAll, createWorld } from './helpers/world.js';

/** Capture what the SDK logger writes (console.log / console.error) at `info`. */
function captureLogs(t) {
  const lines = [];
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const keep = (...args) => lines.push(args.join(' '));
  t.mock.method(console, 'log', keep);
  t.mock.method(console, 'error', keep);
  t.mock.method(console, 'warn', keep);
  const restore = () => {
    process.env.LOG_LEVEL = previous;
    t.mock.restoreAll();
  };
  t.after(restore);
  return { lines, restore };
}

const count = (lines, text) => lines.filter((line) => line.includes(text)).length;

test('a normal cycle (analyses, states, images, widget, housekeeping) writes nothing at info', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const { lines, restore } = captureLogs(t);
  for (const scene of ['empty', 'car', 'cat']) {
    world.server.scene('garden', scene);
    world.clock.advance(60_000);
    await world.monitor.tick();
    await world.monitor.housekeeping();
  }
  await world.fake.widgetGet('camera', { settings: { camera: 'ext:test-integration:camera:1' } });
  await world.fake.sceneAction('analyze', { camera: 'ext:test-integration:camera:2' });
  restore();
  assert.deepEqual(lines, []);
});

test('a camera down is one line, then one when back; its password never shows', async (t) => {
  const world = await createWorld({
    config: {
      ...BASE_CONFIG,
      camera_1_url: 'http://admin:topsecret@192.0.2.20/front.jpg',
    },
  });
  t.after(() => world.app.stop());
  world.server.cameras.get('front').auth = 'admin:topsecret';
  await createAll(world);
  const { lines, restore } = captureLogs(t);
  world.server.cameras.get('front').down = true;
  for (let round = 0; round < 3; round += 1) {
    world.clock.advance(60_000);
    await world.monitor.tick();
  }
  world.server.cameras.get('front').down = false;
  world.clock.advance(60_000);
  await world.monitor.tick();
  restore();
  assert.equal(count(lines, 'Camera Front door (http://192.0.2.20)'), 1, lines.join('\n'));
  assert.equal(count(lines, 'Camera Front door answers again'), 1);
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.doesNotMatch(lines.join('\n'), /topsecret/);
});

test('DOODS down is one line, then one when it is back', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createAll(world);
  const { lines, restore } = captureLogs(t);
  world.server.down = true;
  for (let round = 0; round < 3; round += 1) {
    world.clock.advance(60_000);
    await world.monitor.tick();
    await world.monitor.housekeeping();
  }
  world.server.down = false;
  await world.monitor.housekeeping();
  world.clock.advance(60_000);
  await world.monitor.tick();
  restore();
  assert.equal(count(lines, 'DOODS check failed'), 1, lines.join('\n'));
  assert.equal(count(lines, 'DOODS answers, detector default'), 1, lines.join('\n'));
  assert.ok(lines.length <= 3, lines.join('\n'));
});

test('a missing detector is one line, not one per housekeeping', async (t) => {
  const world = await createWorld({ config: { ...BASE_CONFIG, detector: 'yolo' } });
  t.after(() => world.app.stop());
  const { lines, restore } = captureLogs(t);
  for (let round = 0; round < 3; round += 1) {
    await world.monitor.housekeeping();
  }
  restore();
  assert.deepEqual(lines, []);
});
