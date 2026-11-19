// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys and a simulated DOODS with its
// cameras (test/helpers/fakeDoods.js), the integration wired on top through
// registerHandlers. No periodic timer runs: the tests call the cycles.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { CAMERA_HOST, DOODS_URL, FakeDoods } from './fakeDoods.js';

process.env.LOG_LEVEL ??= 'silent';

export const BASE_CONFIG = {
  url: '192.0.2.10',
  language: 'en',
  camera_1_name: 'Front door',
  camera_1_url: `${CAMERA_HOST}/front.jpg`,
  camera_2_name: 'Garden',
  camera_2_url: `${CAMERA_HOST}/garden.jpg`,
};

/** A clock the tests move by hand. */
export function manualClock(start = Date.UTC(2026, 10, 16, 12, 0, 0)) {
  let now = start;
  const clock = () => now;
  clock.advance = (ms) => {
    now += ms;
  };
  return clock;
}

export async function createWorld({
  server = new FakeDoods(),
  config = BASE_CONFIG,
  created = [],
  connect = true,
  clock = manualClock(),
} = {}) {
  const gladys = createFakeGladys({ config, devices: created });
  const app = registerHandlers(gladys, { fetch: server.fetch, timers: false, clock });
  const world = { gladys, fake: gladys.fake, server, app, monitor: app.monitor, clock };
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return world;
}

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { CAMERA_HOST, DOODS_URL, FakeDoods };
