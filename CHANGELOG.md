# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-15

### Added

- Connection to an RFXCOM RFXtrx433, RFXtrx433E or RFXtrx433XL exposed over
  TCP by ser2net (38400 bauds), with the RFXtrx handshake, a keep-alive and
  automatic reconnection. The connection status shows the receiver, the
  firmware and the protocols received.
- The receiving protocols chosen in the configuration, sent at every
  connection (never written to the flash of the RFXtrx).
- Sensors heard in the Discovery tab: Oregon Scientific temperature,
  humidity, pressure, rain, wind and UV probes; OWL CM113, CM119/CM160, CM180
  and CM180i energy meters; with battery and signal.
- Security1 detectors: door and window contacts, motion and smoke detectors,
  with tamper.
- Remotes, wall switches and keyfobs (Chacon DiO / KlikAanKlikUit, HomeEasy,
  X10, ARC, Blyss, LightwaveRF, X10 security, Visonic CodeSecure): one button
  feature per button, and the "An RFXCOM remote is pressed" scene trigger.
- Actuators driven by the RFXtrx: switches, lights and dimmers (Lighting1, 2,
  5 and 6 protocols) and Somfy RTS shutters (RFY), declared in the
  configuration or paired with the "Pair an actuator" button. Their state
  follows the user's own remote when it is heard.
- A minimum signal for the new emitters, to leave the neighbours' probes out
  of the Discovery tab.
- "Test the connection" button.
- The emitters heard are kept in `/data` across restarts; a sensor silent for
  an hour is shown unreachable.

[Unreleased]: https://github.com/LM1LC3N7/gladys-rfxcom/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-rfxcom/releases/tag/v0.1.1
