// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the end-to-end
// tests, so the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: the emitters heard and the actuators declared.
  gladys.onScanRequest(() => app.publishDevices());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceUpdated((device) => app.deviceCreated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // Commands.
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // Configuration screen buttons.
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.PAIR, (fields) => app.pairActuator(fields));

  // Configuration changed by the user (or by "Pair an actuator"): the link
  // only restarts when the bridge address changed.
  gladys.onConfigUpdated((config) => app.applyConfig(config));

  // Connection lifecycle.
  gladys.on('connected', async () => {
    try {
      await app.applyConfig(await gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
}
