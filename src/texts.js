// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, action messages and failures, the "Check the
// connection" report. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

/**
 * A failure shown in red by Gladys: the message is the multi-language object
 * (a returned value is shown in green, a thrown one in red).
 */
export class ActionFailure extends Error {
  constructor(text) {
    super(text.en);
    this.name = 'ActionFailure';
    this.message = text;
  }
}

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown by Gladys under the integration name when it is not connected.
export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your DOODS server (e.g. 192.168.1.20, port 8080 by default) in the configuration.',
    fr: "Saisissez l'adresse de votre serveur DOODS (ex. 192.168.1.20, port 8080 par défaut) dans la configuration.",
    de: 'Gib die Adresse deines DOODS-Servers (z. B. 192.168.1.20, standardmäßig Port 8080) in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor DOODS (p. ej. 192.168.1.20, puerto 8080 por defecto) en la configuración.',
  },
  unreachable: {
    en: 'DOODS does not answer at this address.',
    fr: 'DOODS ne répond pas à cette adresse.',
    de: 'DOODS antwortet unter dieser Adresse nicht.',
    es: 'DOODS no responde en esta dirección.',
  },
  error: {
    en: 'Something answers, but not like DOODS: check the address and port, and the logs.',
    fr: "Quelque chose répond, mais pas comme DOODS : vérifiez l'adresse, le port et les logs.",
    de: 'Etwas antwortet, aber nicht wie DOODS: Prüfe Adresse, Port und die Protokolle.',
    es: 'Algo responde, pero no como DOODS: compruebe la dirección, el puerto y los registros.',
  },
};

/** The detector of the configuration is not on the server. */
export function unknownDetector(name, available) {
  const list = available.length ? available.join(', ') : '-';
  return {
    en: `DOODS has no detector "${name}". Detectors on the server: ${list}.`,
    fr: `DOODS n'a pas de détecteur « ${name} ». Détecteurs du serveur : ${list}.`,
    de: `DOODS hat keinen Detektor „${name}“. Detektoren auf dem Server: ${list}.`,
    es: `DOODS no tiene el detector «${name}». Detectores del servidor: ${list}.`,
  };
}

// Failures of an analysis asked by the user or a scene (thrown: shown in red).
export const FAILURE = {
  notConfigured: {
    en: 'The DOODS server is not configured or does not answer.',
    fr: "Le serveur DOODS n'est pas configuré ou ne répond pas.",
    de: 'Der DOODS-Server ist nicht konfiguriert oder antwortet nicht.',
    es: 'El servidor DOODS no está configurado o no responde.',
  },
  pickCamera: {
    en: 'Choose a camera.',
    fr: 'Choisissez une caméra.',
    de: 'Wähle eine Kamera aus.',
    es: 'Elija una cámara.',
  },
  unknownCamera: {
    en: 'This camera is no longer in the DOODS configuration.',
    fr: "Cette caméra n'est plus dans la configuration DOODS.",
    de: 'Diese Kamera ist nicht mehr in der DOODS-Konfiguration.',
    es: 'Esta cámara ya no está en la configuración de DOODS.',
  },
  noCameras: {
    en: 'No camera configured: fill in at least one camera address.',
    fr: 'Aucune caméra configurée : renseignez au moins une adresse de caméra.',
    de: 'Keine Kamera konfiguriert: Gib mindestens eine Kameraadresse ein.',
    es: 'Ninguna cámara configurada: introduzca al menos una dirección de cámara.',
  },
  camera: {
    en: 'The camera image could not be read: check its address, user and password.',
    fr: "L'image de la caméra n'a pas pu être lue : vérifiez son adresse, l'utilisateur et le mot de passe.",
    de: 'Das Kamerabild konnte nicht gelesen werden: Prüfe Adresse, Benutzer und Passwort.',
    es: 'No se pudo leer la imagen de la cámara: compruebe su dirección, usuario y contraseña.',
  },
  doods: {
    en: 'DOODS did not answer, or not in time: check the server and its logs.',
    fr: "DOODS n'a pas répondu, ou pas à temps : vérifiez le serveur et ses logs.",
    de: 'DOODS hat nicht oder nicht rechtzeitig geantwortet: Prüfe den Server und seine Protokolle.',
    es: 'DOODS no respondió, o no a tiempo: compruebe el servidor y sus registros.',
  },
};

/** The message of a successful analysis ("Front door: Person ×2, Car (87 %)"). */
export function analysisMessage(name, summary) {
  return `${name}: ${resultText(summary)}`.slice(0, 200);
}

/** What an analysis found, with its best confidence ("Person ×2, Car (87 %)"). */
export const resultText = (summary) =>
  summary.total > 0 ? `${summary.text} (${summary.confidence} %)` : summary.text;

const MAX_LISTED = 4;

// The pieces of the "Check the connection" report, one table per language.
export const CHECK_TEXT = {
  en: {
    connected: (url, detector, type) => `DOODS answers at ${url}, detector ${detector} (${type}).`,
    unknownLabels: (labels) => `Labels this detector does not know: ${labels}.`,
    camera: (name, text) => `- ${name}: ${text}`,
    failed: 'image not read',
    noCamera: 'No camera configured yet.',
  },
  fr: {
    connected: (url, detector, type) => `DOODS répond à ${url}, détecteur ${detector} (${type}).`,
    unknownLabels: (labels) => `Étiquettes inconnues de ce détecteur : ${labels}.`,
    camera: (name, text) => `- ${name} : ${text}`,
    failed: 'image non lue',
    noCamera: 'Aucune caméra configurée pour le moment.',
  },
  de: {
    connected: (url, detector, type) =>
      `DOODS antwortet unter ${url}, Detektor ${detector} (${type}).`,
    unknownLabels: (labels) => `Labels, die dieser Detektor nicht kennt: ${labels}.`,
    camera: (name, text) => `- ${name}: ${text}`,
    failed: 'Bild nicht gelesen',
    noCamera: 'Noch keine Kamera konfiguriert.',
  },
  es: {
    connected: (url, detector, type) => `DOODS responde en ${url}, detector ${detector} (${type}).`,
    unknownLabels: (labels) => `Etiquetas que este detector no conoce: ${labels}.`,
    camera: (name, text) => `- ${name}: ${text}`,
    failed: 'imagen no leída',
    noCamera: 'Aún no hay ninguna cámara configurada.',
  },
};

/**
 * The report of the "Check the connection" action, in the four languages.
 * @param {{ url: string, detector: { name: string, type: string }, unknownLabels: string[],
 *   cameras: Array<{ name: string, summary?: object, failed?: boolean }> }} report
 */
export function checkMessage(report) {
  const message = {};
  for (const [language, text] of Object.entries(CHECK_TEXT)) {
    const lines = [text.connected(report.url, report.detector.name, report.detector.type)];
    if (report.unknownLabels.length > 0) {
      lines.push(text.unknownLabels(report.unknownLabels.join(', ')));
    }
    if (report.cameras.length === 0) {
      lines.push(text.noCamera);
    }
    for (const camera of report.cameras.slice(0, MAX_LISTED)) {
      lines.push(
        text.camera(
          camera.name,
          camera.failed ? text.failed : resultText(camera.summary[language]),
        ),
      );
    }
    message[language] = lines.join('\n');
  }
  return message;
}
