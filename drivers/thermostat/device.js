'use strict';

// Ariston NET / ATAG Zone boiler/thermostaat device.
//
// Polt de cloud op een instelbaar interval (standaard 3 minuten) en zet de
// waarden op de Homey-capabilities. Schrijven (target_temperature,
// thermostat_mode) is standaard uitgeschakeld via de app-brede instelling
// "Schrijven toestaan" en gooit een duidelijke fout als iemand het toch
// probeert terwijl die instelling uit staat.

const Homey = require('homey');
const {
  DEFAULT_BRAND_ID,
  AristonClient,
  AristonAuthError,
  AristonConnectionError,
  AristonRateLimitError,
  findItem,
  getBrand,
} = require('../../lib/aristonClient');

const DEFAULT_POLL_INTERVAL = 180;
const MIN_POLL_INTERVAL = 60;
const UNAVAILABLE_AFTER_FAILURES = 2;

// ZoneMode (Ariston) <-> thermostat_mode (Homey capabilitiesOptions.values)
const ZONE_MODE_TO_CAPABILITY = { 0: 'off', 2: 'heat', 3: 'auto' };
const CAPABILITY_TO_ZONE_MODE = { off: 0, heat: 2, auto: 3 };

class AristonThermostatDevice extends Homey.Device {
  async onInit() {
    this._pollTimer = null;
    this._consecutiveFailures = 0;
    this._lastData = null;

    const store = this.getStore();
    const username = store.username || '';
    const password = store.password || '';
    if (!username || !password) {
      await this.setUnavailable('Geen inloggegevens gevonden voor dit apparaat, koppel opnieuw.');
      this.log('Geen username/password in store, device blijft unavailable');
      return;
    }

    const brand = getBrand(store.brand_id || DEFAULT_BRAND_ID);
    this._client = new AristonClient(username, password, brand.apiUrl);
    this._gw = this.getData().id;
    this._features = {};
    this.log(`Merk voor dit apparaat: ${brand.name} (${brand.apiUrl})`);

    this.registerCapabilityListener('target_temperature', (value) => this._onSetTargetTemperature(value));
    this.registerCapabilityListener('thermostat_mode', (value) => this._onSetThermostatMode(value));

    this._schedulePoll(0);
    this.log(`AristonThermostatDevice ready: ${this.getName()} (gw ${this._gw})`);
  }

  _getPollInterval() {
    try {
      const interval = this.getSetting('poll_interval');
      if (interval) return Math.max(MIN_POLL_INTERVAL, Number(interval));
    } catch (err) {
      // val terug op default
    }
    return DEFAULT_POLL_INTERVAL;
  }

  // App-brede instelling (settings-pagina), standaard uit.
  _writeEnabled() {
    try {
      return Boolean(this.homey.settings.get('write_enabled'));
    } catch (err) {
      return false;
    }
  }

  _zoneNum() {
    const zones = this._features.zones || [{ num: 1 }];
    return zones[0].num || 1;
  }

  // -- Polling --

  _schedulePoll(delayMs) {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this._pollTimer = setTimeout(() => this._pollTick(), delayMs);
  }

  async _pollTick() {
    try {
      await this._pollOnce();
      this._consecutiveFailures = 0;
    } catch (err) {
      if (err instanceof AristonAuthError) {
        this.log(`Login mislukt: ${err.message}`);
        await this.setUnavailable('Inloggen mislukt, controleer e-mail/wachtwoord').catch(() => {});
      } else if (err instanceof AristonRateLimitError) {
        this.log(`Rate limit: ${err.message}`);
      } else if (err instanceof AristonConnectionError) {
        this._consecutiveFailures += 1;
        this.log(`Verbindingsfout (${this._consecutiveFailures}x): ${err.message}`);
        if (this._consecutiveFailures >= UNAVAILABLE_AFTER_FAILURES) {
          await this.setUnavailable('Cloud niet bereikbaar').catch(() => {});
        }
      } else {
        this._consecutiveFailures += 1;
        this.log(`Onverwachte pollfout: ${err.message}`);
        if (this._consecutiveFailures >= UNAVAILABLE_AFTER_FAILURES) {
          await this.setUnavailable('Onverwachte fout, zie app-logs').catch(() => {});
        }
      }
    }
    this._schedulePoll(this._getPollInterval() * 1000);
  }

  async _pollOnce() {
    if (!this._client.isAuthenticated) {
      await this._client.login();
    }
    if (!this._features || Object.keys(this._features).length === 0) {
      this._features = await this._client.getFeatures(this._gw);
    }
    const data = await this._client.getProperties(this._gw, this._features);

    this._lastData = data;
    await this._applyData(data);
    await this.setAvailable();
  }

  async _applyData(data) {
    const zone = this._zoneNum();

    const measured = findItem(data, 'ZoneMeasuredTemp', zone);
    if (measured && measured.value !== null && measured.value !== undefined) {
      await this.setCapabilityValue('measure_temperature', measured.value);
    }

    const desired = findItem(data, 'ZoneDesiredTemp', zone);
    if (desired && desired.value !== null && desired.value !== undefined) {
      await this.setCapabilityValue('target_temperature', desired.value);
    }

    const outside = findItem(data, 'OutsideTemp');
    if (outside && outside.value !== null && outside.value !== undefined) {
      await this.setCapabilityValue('measure_temperature.outdoor', outside.value);
    }

    const pressure = findItem(data, 'HeatingCircuitPressure');
    if (pressure && pressure.value !== null && pressure.value !== undefined) {
      await this.setCapabilityValue('measure_pressure', pressure.value);
    }

    const flame = findItem(data, 'IsFlameOn');
    if (flame && flame.value !== null && flame.value !== undefined) {
      const isOn = Boolean(flame.value);
      let previous = null;
      try {
        previous = this.getCapabilityValue('boiler_active');
      } catch (err) {
        // eerste keer, nog geen waarde
      }
      await this.setCapabilityValue('boiler_active', isOn);
      if (previous !== null && previous !== undefined && previous !== isOn) {
        await this._fireBoilerTrigger(isOn);
      }
    }

    const zoneMode = findItem(data, 'ZoneMode', zone);
    if (zoneMode && zoneMode.value !== null && zoneMode.value !== undefined) {
      const mapped = ZONE_MODE_TO_CAPABILITY[Number(zoneMode.value)];
      if (mapped) {
        await this.setCapabilityValue('thermostat_mode', mapped);
      }
    }
  }

  async _fireBoilerTrigger(isOn) {
    if (this.homey.app && typeof this.homey.app.fireBoilerStatusChanged === 'function') {
      try {
        await this.homey.app.fireBoilerStatusChanged(this, isOn);
      } catch (err) {
        this.log(`Trigger boiler_status_changed error: ${err.message}`);
      }
    }
  }

  // -- Setters (schrijven, staat standaard uit) --

  async _onSetTargetTemperature(value) {
    if (!this._writeEnabled()) {
      throw new Error(
        "Schrijven naar de ketel staat uit. Zet 'Schrijven toestaan' aan in de "
        + 'app-instellingen om de doeltemperatuur te wijzigen.',
      );
    }
    const zone = this._zoneNum();
    const currentItem = findItem(this._lastData || {}, 'ZoneComfortTemp', zone);
    const currentValue = currentItem ? currentItem.value : null;

    if (!this._client.isAuthenticated) {
      await this._client.login();
    }
    await this._client.setProperty(this._gw, this._features, 'ZoneComfortTemp', value, currentValue, zone);
    this.log(`target_temperature -> ${value} (ZoneComfortTemp, zone ${zone})`);
  }

  async _onSetThermostatMode(value) {
    if (!this._writeEnabled()) {
      throw new Error(
        "Schrijven naar de ketel staat uit. Zet 'Schrijven toestaan' aan in de "
        + 'app-instellingen om de modus te wijzigen.',
      );
    }
    const modeValue = CAPABILITY_TO_ZONE_MODE[value];
    if (modeValue === undefined) {
      throw new Error(`Onbekende thermostat_mode: ${value}`);
    }

    const zone = this._zoneNum();
    const currentItem = findItem(this._lastData || {}, 'ZoneMode', zone);
    const currentValue = currentItem ? currentItem.value : null;

    if (!this._client.isAuthenticated) {
      await this._client.login();
    }
    await this._client.setProperty(this._gw, this._features, 'ZoneMode', modeValue, currentValue, zone);
    this.log(`thermostat_mode -> ${value} (ZoneMode=${modeValue}, zone ${zone})`);
  }

  async onDeleted() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    this.log(`Device verwijderd: ${this.getName()}`);
  }
}

module.exports = AristonThermostatDevice;
