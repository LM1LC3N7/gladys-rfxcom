// -----------------------------------------------------------------------------
// The RFXtrx binary protocol: packet types, subtypes, receiver protocols.
//
// Every packet starts with its length (bytes after the length byte), then the
// packet type, the subtype and a sequence number. The tables below are ported
// from node-rfxcom (MIT, Copyright (c) 2012-2017 Kevin McDermott, see
// THIRD_PARTY_NOTICES.md), itself written from the RFXtrx SDK of RFXCOM.
// -----------------------------------------------------------------------------

export const PACKET = {
  INTERFACE_CONTROL: 0x00,
  INTERFACE_MESSAGE: 0x01,
  TRANSMITTER_MESSAGE: 0x02,
  LIGHTING1: 0x10,
  LIGHTING2: 0x11,
  LIGHTING5: 0x14,
  LIGHTING6: 0x15,
  RFY: 0x1a,
  SECURITY1: 0x20,
  TEMPERATURE: 0x50,
  HUMIDITY: 0x51,
  TEMP_HUM: 0x52,
  TEMP_HUM_BARO: 0x54,
  RAIN: 0x55,
  WIND: 0x56,
  UV: 0x57,
  ELEC1: 0x59,
  ELEC23: 0x5a,
  ELEC4: 0x5b,
};

/** Interface control commands (packet type 0x00). */
export const CONTROL = {
  RESET: 0x00,
  GET_STATUS: 0x02,
  SET_MODE: 0x03,
  START_RECEIVER: 0x07,
};

/** Interface message subtypes (packet type 0x01). */
export const INTERFACE = {
  STATUS: 0x00,
  UNKNOWN_RFY_REMOTE: 0x01,
  RECEIVER_STARTED: 0x07,
  NOT_UNDERSTOOD: 0xff,
};

/** Subtype names, by packet type. The name is the protocol of a transmitter. */
export const SUBTYPES = {
  [PACKET.LIGHTING1]: [
    'X10',
    'ARC',
    'ELRO',
    'WAVEMAN',
    'CHACON',
    'IMPULS',
    'RISING_SUN',
    'PHILIPS_SBC',
    'ENERGENIE_ENER010',
    'ENERGENIE_5_GANG',
    'COCO',
    'HQ',
    'OASE_FM',
  ],
  [PACKET.LIGHTING2]: ['AC', 'HOMEEASY_EU', 'ANSLUT', 'KAMBROOK'],
  [PACKET.LIGHTING5]: [
    'LIGHTWAVERF',
    'EMW100',
    'BBSB',
    'MDREMOTE',
    'CONRAD',
    'LIVOLO',
    'TRC02',
    'AOKE',
    'TRC02_2',
    'EURODOMEST',
    'LIVOLO_APPLIANCE',
    'RGB432W',
    'MDREMOTE_107',
    'LEGRAND',
    'AVANTEK',
    'IT',
    'MDREMOTE_108',
    'KANGTAI',
  ],
  [PACKET.LIGHTING6]: ['BLYSS', 'CUVEO'],
  [PACKET.RFY]: ['RFY', 'RFYEXT', 'GEOM', 'ASA'],
  [PACKET.SECURITY1]: [
    'X10_DOOR',
    'X10_PIR',
    'X10_SECURITY',
    'KD101',
    'POWERCODE_DOOR',
    'POWERCODE_PIR',
    'CODE_SECURE',
    'POWERCODE_AUX',
    'MEIANTECH',
    'SA30',
    'RM174RF',
    'FERPORT_TAC',
  ],
};

/** The products behind a sensor subtype, by packet type (RFXtrx SDK names). */
export const MODELS = {
  [PACKET.TEMPERATURE]: [
    '',
    'Oregon THR128/THR138',
    'Oregon THN132/THN122/THC238',
    'Oregon THWR800',
    'Oregon RTHN318',
    'La Crosse TX3',
    'TS15C',
    'Viking 02811',
    'La Crosse WS2300',
    'Rubicson',
    'TFA 30.3133',
    'WT0122',
  ],
  [PACKET.HUMIDITY]: ['', 'La Crosse TX3', 'La Crosse WS2300', 'Inovalley S80'],
  [PACKET.TEMP_HUM]: [
    '',
    'Oregon THGN122/THGR122',
    'Oregon THGR810/THGN800',
    'Oregon RTGR328',
    'Oregon THGR328',
    'Oregon WTGR800',
    'Oregon THGR918/THGN500',
    'TFA TS34C',
    'WT450',
    'Viking 02035',
    'Rubicson',
    'EW109',
    'Imagintronix XT300',
    'Alecto WS1700',
    'Alecto WS4500',
  ],
  [PACKET.TEMP_HUM_BARO]: ['', 'Oregon BTHR918/BTHGN129', 'Oregon BTHR918N/BTHR968'],
  [PACKET.RAIN]: [
    '',
    'Oregon RGR126/RGR918',
    'Oregon PCR800',
    'TFA TS906',
    'UPM RG700',
    'La Crosse WS2300',
    'La Crosse TX5',
    'Alecto WS4500',
    'Davis',
    'TFA 30.3233.01',
    'EcoWitt WH40',
  ],
  [PACKET.WIND]: [
    '',
    'Oregon WTGR800',
    'Oregon WGR800',
    'Oregon STR918/WGR918',
    'TFA TS805',
    'UPM WDS500',
    'La Crosse WS2300',
    'Alecto WS4500',
  ],
  [PACKET.UV]: ['', 'Oregon UVN128/UV138', 'Oregon UVN800', 'TFA'],
  [PACKET.ELEC1]: ['', 'OWL CM113'],
  [PACKET.ELEC23]: ['', 'OWL CM119/CM160', 'OWL CM180'],
  [PACKET.ELEC4]: ['', 'OWL CM180i'],
};

/** Receiver types reported by the status message (msg1). */
export const RECEIVER_TYPES = {
  0x50: '310 MHz',
  0x51: '315 MHz',
  0x52: '433.92 MHz receiver',
  0x53: '433.92 MHz transceiver',
  0x54: '433.42 MHz transceiver',
  0x55: '868 MHz',
  0x5c: '433.92 MHz RFXtrxIOT',
  0x5d: '868 MHz RFXtrxIOT',
  0x5f: '434.50 MHz transceiver',
};

/** The receiver types the protocol bitmap below applies to. */
export const RECEIVERS_433 = [0x52, 0x53, 0x54, 0x5f];

export const FIRMWARE_TYPES = {
  0x00: 'Type 1 RO',
  0x01: 'Type 1',
  0x02: 'Type 2',
  0x03: 'Ext',
  0x04: 'Ext 2',
  0x05: 'Pro 1',
  0x06: 'Pro 2',
  0x10: 'ProXL 1',
  0x13: 'ProXL 2',
  0x14: 'RFX433',
  0x15: 'RFX868',
  0x16: 'ProXL 95',
  0x18: 'RFX310',
};

/**
 * The receiving protocols of the 433 MHz transceivers, as bits of the
 * msg3..msg6 bytes of the set mode command and of the status message.
 */
export const PROTOCOLS = {
  BLYSS: { msg: 3, bit: 0x01 },
  RUBICSON: { msg: 3, bit: 0x02 },
  FINEOFFSET: { msg: 3, bit: 0x04 },
  LIGHTING4: { msg: 3, bit: 0x08 },
  RSL: { msg: 3, bit: 0x10 },
  BYRONSX: { msg: 3, bit: 0x20 },
  IMAGINTRONIX: { msg: 3, bit: 0x40 },
  UNDECODED: { msg: 3, bit: 0x80 },
  MERTIK: { msg: 4, bit: 0x01 },
  LIGHTWAVERF: { msg: 4, bit: 0x02 },
  HIDEKI: { msg: 4, bit: 0x04 },
  LACROSSE: { msg: 4, bit: 0x08 },
  LEGRAND: { msg: 4, bit: 0x10 },
  BLINDST0: { msg: 4, bit: 0x40 },
  BLINDST1: { msg: 4, bit: 0x80 },
  X10: { msg: 5, bit: 0x01 },
  ARC: { msg: 5, bit: 0x02 },
  AC: { msg: 5, bit: 0x04 },
  HOMEEASY: { msg: 5, bit: 0x08 },
  MEIANTECH: { msg: 5, bit: 0x10 },
  OREGON: { msg: 5, bit: 0x20 },
  ATI: { msg: 5, bit: 0x40 },
  VISONIC: { msg: 5, bit: 0x80 },
  KEELOQ: { msg: 6, bit: 0x01 },
  HOMECONFORT: { msg: 6, bit: 0x02 },
  MCZ: { msg: 6, bit: 0x40 },
  FUNKBUS: { msg: 6, bit: 0x80 },
};

/** Security1 device status values (low 7 bits; 0x80 is the tamper flag). */
export const SECURITY_STATUS = {
  NORMAL: 0x00,
  NORMAL_DELAYED: 0x01,
  ALARM: 0x02,
  ALARM_DELAYED: 0x03,
  MOTION: 0x04,
  NO_MOTION: 0x05,
  PANIC: 0x06,
  END_PANIC: 0x07,
  IR: 0x08,
  ARM_AWAY: 0x09,
  ARM_AWAY_DELAYED: 0x0a,
  ARM_HOME: 0x0b,
  ARM_HOME_DELAYED: 0x0c,
  DISARM: 0x0d,
  LIGHT1_OFF: 0x10,
  LIGHT1_ON: 0x11,
  LIGHT2_OFF: 0x12,
  LIGHT2_ON: 0x13,
  DARK_DETECTED: 0x14,
  LIGHT_DETECTED: 0x15,
  BATTERY_LOW: 0x16,
  PAIR_KD101: 0x17,
};

/** RFY (Somfy RTS) commands. */
export const RFY_COMMAND = {
  STOP: 0x00,
  UP: 0x01,
  DOWN: 0x03,
  PROGRAM: 0x07,
};

/** Name of a subtype, e.g. subtypeName(0x11, 0) = 'AC'. */
export function subtypeName(packetType, subtype) {
  return SUBTYPES[packetType]?.[subtype];
}

/** Subtype number of a protocol name, e.g. subtypeOf(0x11, 'AC') = 0. */
export function subtypeOf(packetType, name) {
  const index = SUBTYPES[packetType]?.indexOf(name) ?? -1;
  return index < 0 ? undefined : index;
}
