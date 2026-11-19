// -----------------------------------------------------------------------------
// DOODS client (snowzach/doods2, its REST API):
//   GET  /detectors  the detectors the server loaded, with their labels;
//   POST /detect     { detector_name, data, detect, image } where `data` is a
//                    base64 image or a URL DOODS reads itself (http, rtsp),
//                    `detect` the minimum confidence by label (`*` = any) in
//                    percent, and `image: "jpeg"` asks for the picture back
//                    with the boxes drawn on it.
// DOODS answers 400 with `{ error }` for an unknown detector, and a bare 500
// when it cannot read the image (a stream it cannot open, bytes that are not
// an image).
// -----------------------------------------------------------------------------

export const DEFAULT_PORT = 8080;
// A CPU detection takes 0.1 s (tflite) to several seconds (tensorflow): the
// whole request, image included, gets this long.
export const DETECT_TIMEOUT_MS = 25_000;
const LIST_TIMEOUT_MS = 8000;

export class DoodsError extends Error {
  /**
   * @param {'unreachable'|'timeout'|'detector'|'image'|'http'|'format'} kind
   */
  constructor(kind, message) {
    super(message);
    this.name = 'DoodsError';
    this.kind = kind;
  }
}

/**
 * The base URL of a DOODS server from what the user typed ("192.0.2.5",
 * "doods.lan:8080", "https://doods.example/"), or null.
 */
export function parseServerUrl(text) {
  const value = String(text ?? '').trim();
  if (!value) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  if (!url.port && url.protocol === 'http:' && !/:\d+/.test(withScheme.split('/')[2])) {
    url.port = String(DEFAULT_PORT);
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export class DoodsClient {
  /**
   * @param {{ url: string, fetch?: typeof fetch }} options
   */
  constructor({ url, fetch: fetchImpl = globalThis.fetch }) {
    this.base = parseServerUrl(url);
    if (!this.base) {
      throw new DoodsError('format', 'Invalid DOODS address');
    }
    this.fetch = fetchImpl;
  }

  async request(path, { method = 'GET', body, timeoutMs }) {
    let response;
    try {
      response = await this.fetch(`${this.base}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new DoodsError('timeout', `DOODS did not answer within ${timeoutMs / 1000} s`);
      }
      throw new DoodsError(
        'unreachable',
        `DOODS is unreachable (${err?.cause?.code ?? err?.message})`,
      );
    }
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = typeof data?.error === 'string' ? data.error : '';
      if (/unknown detector/i.test(error)) {
        throw new DoodsError('detector', error);
      }
      if (response.status === 500 && method === 'POST') {
        // DOODS raises on an image it cannot read or a stream it cannot open.
        throw new DoodsError('image', 'DOODS could not read the image');
      }
      throw new DoodsError(
        'http',
        `DOODS answered HTTP ${response.status}${error ? `: ${error}` : ''}`,
      );
    }
    if (!data || typeof data !== 'object') {
      throw new DoodsError('format', 'DOODS did not answer JSON: is it the right address?');
    }
    return data;
  }

  /** The detectors: `[{ name, type, model, labels: [], width, height }]`. */
  async detectors() {
    const data = await this.request('/detectors', { timeoutMs: LIST_TIMEOUT_MS });
    if (!Array.isArray(data.detectors)) {
      throw new DoodsError('format', 'DOODS did not list its detectors: is it the right address?');
    }
    return data.detectors.map((item) => ({
      name: String(item?.name ?? ''),
      type: String(item?.type ?? ''),
      model: String(item?.model ?? ''),
      labels: Array.isArray(item?.labels) ? item.labels.map((label) => String(label)) : [],
      width: Number(item?.width) || 0,
      height: Number(item?.height) || 0,
    }));
  }

  /**
   * Run one detection.
   * @param {{ detector: string, data: string, labels: string[], confidence: number, image?: boolean }} request
   * @returns {Promise<{ detections: Array<{ label: string, confidence: number, top: number, left: number, bottom: number, right: number }>, image: Buffer|null, duration: number|null }>}
   */
  async detect({ detector, data, labels, confidence, image = true }) {
    const body = {
      detector_name: detector,
      data,
      detect: Object.fromEntries(labels.map((label) => [label, confidence])),
    };
    if (image) {
      body.image = 'jpeg';
    }
    const result = await this.request('/detect', {
      method: 'POST',
      body,
      timeoutMs: DETECT_TIMEOUT_MS,
    });
    if (typeof result.error === 'string' && result.error) {
      throw new DoodsError(
        /unknown detector/i.test(result.error) ? 'detector' : 'http',
        result.error,
      );
    }
    const detections = (Array.isArray(result.detections) ? result.detections : [])
      .map((item) => ({
        label: String(item?.label ?? '').toLowerCase(),
        confidence: Number(item?.confidence),
        top: Number(item?.top) || 0,
        left: Number(item?.left) || 0,
        bottom: Number(item?.bottom) || 0,
        right: Number(item?.right) || 0,
      }))
      .filter((item) => item.label && Number.isFinite(item.confidence));
    const picture =
      typeof result.image === 'string' && result.image ? Buffer.from(result.image, 'base64') : null;
    return {
      detections,
      image: picture && picture.length > 0 ? picture : null,
      duration: Number.isFinite(Number(result.duration)) ? Number(result.duration) : null,
    };
  }
}
