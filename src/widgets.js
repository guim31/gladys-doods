// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `camera`.
//
// The Gladys camera box shows the image only. This widget adds what DOODS saw
// in it: the objects, the best confidence, the count of each searched label,
// when the analysis ran, and a button to analyze now (a setting hides it).
//
// Budget (8 components, 2 texts): a caption, the image, one status list, one
// button.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { countedLabels, labelName } from './devices.js';
import { WIDGET_KEY } from './monitor.js';
import { ActionFailure, FAILURE, analysisMessage } from './texts.js';

// Numbered: the core drops a button whose action key is already taken.
export const ACTIONS = { ANALYZE: 'analyze_1' };
// A status value holds 40 characters at most.
const MAX_VALUE = 40;
// Count rows shown at most, after the objects and the confidence.
const MAX_COUNT_ROWS = 4;

export const TEXT = {
  pick: {
    en: 'Choose a camera in the settings of this widget.',
    fr: 'Choisissez une caméra dans les réglages de ce widget.',
    de: 'Wähle in den Einstellungen dieses Widgets eine Kamera aus.',
    es: 'Elija una cámara en la configuración de este widget.',
  },
  unknown: FAILURE.unknownCamera,
  analyzedAt: { en: 'Analyzed at', fr: 'Analysée à', de: 'Analysiert um', es: 'Analizada a las' },
  notYet: {
    en: 'Not analyzed yet',
    fr: 'Pas encore analysée',
    de: 'Noch nicht analysiert',
    es: 'Aún no analizada',
  },
  unreachable: {
    en: 'image not read',
    fr: 'image non lue',
    de: 'Bild nicht gelesen',
    es: 'imagen no leída',
  },
  serverDown: {
    en: 'DOODS does not answer',
    fr: 'DOODS ne répond pas',
    de: 'DOODS antwortet nicht',
    es: 'DOODS no responde',
  },
  objects: { en: 'Objects', fr: 'Objets', de: 'Objekte', es: 'Objetos' },
  confidence: { en: 'Confidence', fr: 'Confiance', de: 'Konfidenz', es: 'Confianza' },
  analyze: {
    en: 'Analyze now',
    fr: 'Analyser maintenant',
    de: 'Jetzt analysieren',
    es: 'Analizar ahora',
  },
};

const t = (text, language) => text[language] ?? text.en;

const clip = (text) => (text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text);

// Image keys are `[a-z0-9-]`, and change with each picture (cached by key).
const tagOf = (camera) => createHash('sha1').update(String(camera.slot)).digest('hex').slice(0, 12);

export const imageKey = (camera) => `cam-${tagOf(camera)}-${camera.imageSeq.toString(36)}`;

function message(text, language) {
  return {
    ttl_seconds: 60,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

function timeOf(at, language) {
  return new Intl.DateTimeFormat(language, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(at));
}

async function get(monitor, { settings, language = 'en' }) {
  const camera = settings?.camera ? monitor.resolve(settings.camera) : null;
  if (!camera) {
    return message(settings?.camera ? TEXT.unknown : TEXT.pick, language);
  }
  const result = camera.result;
  const caption = [
    camera.analyzedAt && result
      ? `${t(TEXT.analyzedAt, language)} ${timeOf(camera.analyzedAt, language)}`
      : t(TEXT.notYet, language),
  ];
  if (!monitor.server?.ok) {
    caption.push(t(TEXT.serverDown, language));
  } else if (camera.failure) {
    caption.push(t(TEXT.unreachable, language));
  }
  const components = [{ type: 'text', variant: 'caption', text: caption.join(' · ') }];
  if (camera.image) {
    components.push({
      type: 'image',
      key: imageKey(camera),
      alt: monitor.nameOf(camera),
      fit: 'contain',
    });
  }
  if (result) {
    // The summary is in the configuration language; the widget in the user's.
    const local = monitor.summaryIn(camera, language);
    const items = [
      {
        label: t(TEXT.objects, language),
        icon: 'eye',
        value: clip(local.text),
        color: local.total > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      },
    ];
    if (local.total > 0) {
      items.push({
        label: t(TEXT.confidence, language),
        icon: 'percent',
        value: `${local.confidence} %`,
      });
    }
    for (const label of countedLabels(camera).slice(0, MAX_COUNT_ROWS)) {
      const count = local.counts[label] ?? 0;
      items.push({
        label: clip(labelName(label, language)),
        icon: label === 'person' ? 'user' : 'hash',
        value: count,
        color: count > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }
  if (settings.hide_button !== true && monitor.server?.ok) {
    components.push({
      type: 'button',
      label: t(TEXT.analyze, language),
      icon: 'search',
      style: 'secondary',
      action: { key: ACTIONS.ANALYZE },
    });
  }
  const interval = monitor.config.intervalSeconds;
  return {
    ttl_seconds: interval > 0 ? Math.min(Math.max(interval, 10), 300) : 300,
    components,
  };
}

async function action(monitor, { actionKey, settings }) {
  if (actionKey !== ACTIONS.ANALYZE) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  if (!settings?.camera) {
    throw new ActionFailure(TEXT.pick);
  }
  const camera = monitor.require(settings.camera);
  await monitor.analyze(camera, { events: false });
  const name = monitor.nameOf(camera);
  return {
    message: Object.fromEntries(
      ['en', 'fr', 'de', 'es'].map((lang) => [
        lang,
        analysisMessage(name, monitor.summaryIn(camera, lang)),
      ]),
    ),
  };
}

/** The bytes behind an image key of the widget (raw base64). */
export async function widgetImage(monitor, key) {
  const match = /^cam-([0-9a-f]{12})-[0-9a-z]+$/.exec(String(key));
  const camera = match
    ? [...monitor.cameras.values()].find((item) => tagOf(item) === match[1])
    : null;
  if (!camera?.image) {
    throw new Error(`Unknown image ${key}`);
  }
  // Already fit for Gladys (150 KB), well under the 300 KB of a widget image.
  return camera.image.jpeg.toString('base64');
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
