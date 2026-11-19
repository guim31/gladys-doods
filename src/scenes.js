// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// `analyze`: analyze one camera now, e.g. when a door opens or the alarm goes
// off, and hand what DOODS saw to the next actions of the scene (a condition
// on `persons`, the objects in a message). The camera image is updated too,
// so the core's "Send a camera image" action that follows sends the picture
// with its boxes. No scene event is fired from here (no loop).
// -----------------------------------------------------------------------------

async function analyze(monitor, { fields }) {
  const camera = monitor.require(fields?.camera);
  const summary = await monitor.analyze(camera, { events: false });
  return {
    detected: summary.total > 0,
    objects: summary.text,
    count: summary.total,
    persons: summary.counts.person ?? 0,
    confidence: summary.confidence,
  };
}

export const SCENE_ACTIONS = { analyze };
