// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons), in English and French.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const join = (...texts) => ({
  en: texts.map((t) => t.en).join(''),
  fr: texts.map((t) => t.fr).join(''),
});

const ACTUATOR_ERRORS = {
  syntax: {
    en: 'write "Name = kind PROTOCOL address"',
    fr: 'écrivez « Nom = type PROTOCOLE adresse »',
  },
  kind: { en: 'unknown kind', fr: 'type inconnu' },
  protocol: { en: 'unknown protocol', fr: 'protocole inconnu' },
  'kind-protocol': {
    en: 'this protocol cannot drive this kind',
    fr: 'ce protocole ne pilote pas ce type',
  },
  address: { en: 'invalid address', fr: 'adresse invalide' },
  duplicate: { en: 'declared twice', fr: 'déclaré deux fois' },
};

const linkReason = (address, { code, message }) => {
  switch (code) {
    case 'refused':
      return {
        en: `${address} refused the connection: is ser2net running, on this port?`,
        fr: `${address} a refusé la connexion : ser2net tourne-t-il, sur ce port ?`,
      };
    case 'host':
      return {
        en: `the host of ${address} is unknown: type its IP address`,
        fr: `l'hôte de ${address} est inconnu : saisissez son adresse IP`,
      };
    case 'unreachable':
      return {
        en: `${address} does not answer on the network`,
        fr: `${address} ne répond pas sur le réseau`,
      };
    case 'closed':
      return {
        en: `${address} closed the connection (another program may hold the RFXtrx: set kickolduser in ser2net)`,
        fr: `${address} a fermé la connexion (un autre programme utilise peut-être le RFXtrx : activez kickolduser dans ser2net)`,
      };
    case 'no-answer':
      return {
        en: `the bridge ${address} answers, but not the RFXtrx: check that it is plugged in, the device path and the speed of ser2net (38400 bauds)`,
        fr: `la passerelle ${address} répond, mais pas le RFXtrx : vérifiez qu'il est branché, le chemin du périphérique et la vitesse de ser2net (38400 bauds)`,
      };
    default:
      return { en: `${address}: ${message}`, fr: `${address} : ${message}` };
  }
};

const describe = (status) => {
  const firmware = `${status.firmwareVersion}${status.firmwareType ? ` ${status.firmwareType}` : ''}`;
  const protocols = status.protocols.join(', ');
  return {
    en: `${status.receiverName}, firmware ${firmware}, protocols received: ${protocols || 'none'}`,
    fr: `${status.receiverName}, firmware ${firmware}, protocoles reçus : ${protocols || 'aucun'}`,
  };
};

export const T = {
  notConfigured: {
    en: 'Type the address of the ser2net bridge of your RFXtrx in the configuration (for example 192.168.1.10, port 4001).',
    fr: "Saisissez l'adresse de la passerelle ser2net de votre RFXtrx dans la configuration (par exemple 192.168.1.10, port 4001).",
  },
  badHost: (reason) =>
    reason === 'localhost'
      ? {
          en: 'localhost is the container of the integration, not the machine of the RFXtrx: type the LAN IP address of that machine.',
          fr: "localhost désigne le conteneur de l'intégration, pas la machine du RFXtrx : saisissez l'adresse IP de cette machine sur le réseau local.",
        }
      : {
          en: 'The bridge address is not valid: type an IP address or a host name, for example 192.168.1.10.',
          fr: "L'adresse de la passerelle n'est pas valide : saisissez une adresse IP ou un nom d'hôte, par exemple 192.168.1.10.",
        },
  connecting: (address) => ({
    en: `Connecting to the RFXtrx through ${address}…`,
    fr: `Connexion au RFXtrx via ${address}…`,
  }),
  connected: (status, heard, actuators) =>
    join({ en: 'Connected to the RFXtrx: ', fr: 'Connecté au RFXtrx : ' }, describe(status), {
      en: `. ${plural(heard, 'emitter', 'emitters')} heard, ${plural(actuators, 'actuator', 'actuators')} declared: open Discovery to add them.`,
      fr: `. ${plural(heard, 'émetteur entendu', 'émetteurs entendus')}, ${plural(actuators, 'actionneur déclaré', 'actionneurs déclarés')} : ouvrez Découverte pour les ajouter.`,
    }),
  unreachable: (address, reason) =>
    join({ en: 'RFXtrx unreachable: ', fr: 'RFXtrx injoignable : ' }, linkReason(address, reason), {
      en: '. Retrying.',
      fr: '. Nouvel essai en cours.',
    }),
  actuatorErrors: (errors) => ({
    en: ` Ignored actuators: ${errors.map((e) => `"${e.entry}" (${ACTUATOR_ERRORS[e.error].en})`).join('; ')}.`,
    fr: ` Actionneurs ignorés : ${errors.map((e) => `« ${e.entry} » (${ACTUATOR_ERRORS[e.error].fr})`).join(' ; ')}.`,
  }),
  test: {
    ok: (status, ms, heard) =>
      join({ en: 'Connection OK: ', fr: 'Connexion OK : ' }, describe(status), {
        en: `. Answer in ${ms} ms. ${plural(heard, 'emitter', 'emitters')} heard so far.`,
        fr: `. Réponse en ${ms} ms. ${plural(heard, 'émetteur entendu', 'émetteurs entendus')} jusqu'ici.`,
      }),
    down: (address, reason) =>
      reason
        ? join({ en: 'Not connected: ', fr: 'Non connecté : ' }, linkReason(address, reason), {
            en: '.',
            fr: '.',
          })
        : {
            en: 'Connecting, try again in a few seconds.',
            fr: 'Connexion en cours, réessayez dans quelques secondes.',
          },
  },
  pair: {
    invalid: (error) => ({
      en: `Nothing paired: ${ACTUATOR_ERRORS[error].en}.`,
      fr: `Rien n'a été appairé : ${ACTUATOR_ERRORS[error].fr}.`,
    }),
    needsAddress: {
      en: 'Nothing paired: this protocol needs the address set on the receiver (house code and unit, e.g. A1).',
      fr: "Rien n'a été appairé : ce protocole demande l'adresse réglée sur le récepteur (code maison et unité, ex. A1).",
    },
    notConnected: {
      en: 'Nothing paired: the RFXtrx is not connected, check the status above.',
      fr: "Rien n'a été appairé : le RFXtrx n'est pas connecté, vérifiez l'état ci-dessus.",
    },
    failed: (message) => ({
      en: `Nothing paired: ${message}.`,
      fr: `Rien n'a été appairé : ${message}.`,
    }),
    done: (entry, sent) => ({
      en: `${sent ? 'Pairing frame sent and actuator' : 'Actuator'} added: "${entry}". Open Discovery to add it to Gladys.`,
      fr: `${sent ? "Trame d'appairage envoyée et actionneur" : 'Actionneur'} ajouté : « ${entry} ». Ouvrez Découverte pour l'ajouter à Gladys.`,
    }),
    already: (entry) => ({
      en: `Pairing frame sent; "${entry}" was already declared.`,
      fr: `Trame d'appairage envoyée ; « ${entry} » était déjà déclaré.`,
    }),
  },
};
