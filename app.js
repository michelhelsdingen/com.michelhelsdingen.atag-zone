'use strict';

// Ariston NET / ATAG Zone -- Homey App: bedien je cv-ketel en kamerthermostaat.

const Homey = require('homey');

class AristonApp extends Homey.App {
  async onInit() {
    this.log('Ariston NET / ATAG Zone starting...');

    await this._registerFlowCards();

    this.log('Ariston NET / ATAG Zone ready.');
  }

  // Wordt aangeroepen door device.js als IsFlameOn van waarde wisselt.
  async fireBoilerStatusChanged(device, isOn) {
    if (!this._boilerStatusTrigger) return;
    try {
      await this._boilerStatusTrigger.trigger(
        device,
        { is_flame_on: isOn },
        { state: isOn ? 'on' : 'off' },
      );
    } catch (err) {
      this.log(`Boiler status trigger error: ${err.message}`);
    }
  }

  // -- Flow card registratie --

  async _registerFlowCards() {
    this._boilerStatusTrigger = this.homey.flow.getDeviceTriggerCard(
      'ariston_boiler_status_changed',
    );

    const pressureBelow = this.homey.flow.getConditionCard('ariston_pressure_below');
    pressureBelow.registerRunListener((args) => this._checkPressureBelow(args));
  }

  async _checkPressureBelow(args) {
    const { device, pressure } = args;
    const threshold = Number(pressure);
    let current;
    try {
      current = device.getCapabilityValue('measure_pressure');
    } catch (err) {
      this.log(`Pressure condition read error: ${err.message}`);
      return false;
    }
    if (current === null || current === undefined) return false;
    return Number(current) < threshold;
  }
}

module.exports = AristonApp;
