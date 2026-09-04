'use strict';

/**
 * Kleine client voor de remotethermo cloud-API (Ariston NET / ATAG Zone /
 * Chaffoteaux / ELCO delen hetzelfde platform, alleen het merk-portaal
 * verschilt). Gebruikt Node's ingebouwde fetch, geen zware dependencies.
 *
 * Alle GET-achtige methodes hier zijn puur lezen. setProperty() schrijft
 * naar de ketel en wordt in de driver/device laag bewust achter de
 * app-instelling "Schrijven toestaan" gehouden (die staat standaard uit).
 */

const USER_AGENT = 'RestSharp/106.11.7.0';
const REQUEST_TIMEOUT_MS = 20000;

// Ariston en ATAG delen hetzelfde remotethermo cloudplatform (bevestigd:
// zelfde account, byte-identieke features/dataItems-responses via beide
// portals, zie NOTES.md). Chaffoteaux en ELCO zijn toegevoegd op verzoek
// van de hoofdsessie met hun bekende portal-domeinen, maar NIET getest
// met echte inloggegevens (niemand in dit project heeft zo'n account) --
// zie NOTES.md voor het voorbehoud. Volgorde bepaalt de volgorde in de
// pairing-dropdown.
const BRANDS = [
  {
    id: 'ariston',
    name: 'Ariston NET',
    apiUrl: 'https://www.ariston-net.remotethermo.com/api/v2/',
  },
  {
    id: 'atag',
    name: 'ATAG Zone',
    apiUrl: 'https://www.atagzone.remotethermo.com/api/v2/',
  },
  {
    id: 'chaffoteaux',
    name: 'Chaffoteaux',
    apiUrl: 'https://www.chaffolink.remotethermo.com/api/v2/',
  },
  {
    id: 'elco',
    name: 'ELCO',
    apiUrl: 'https://www.remocon-net.remotethermo.com/api/v2/',
  },
];
const DEFAULT_BRAND_ID = 'atag'; // Michels eigen ketel gebruikt de ATAG Zone-app

function getBrand(brandId) {
  return BRANDS.find((b) => b.id === brandId) || BRANDS[0];
}

// Properties die de ketel altijd wel/niet kan hebben, onafhankelijk van de
// features-response.
const DEVICE_PROPERTIES = [
  'PlantMode',
  'IsFlameOn',
  'IsHeatingPumpOn',
  'Holiday',
  'OutsideTemp',
  'Weather',
  'HeatingCircuitPressure',
  'ChFlowTemp',
  'ChFlowSetpointTemp',
  'DhwTemp',
  'DhwStorageTemperature',
  'DhwTimeProgComfortTemp',
  'DhwTimeProgEconomyTemp',
  'DhwMode',
  'AutomaticThermoregulation',
  'AntilegionellaOnOff',
  'AntilegionellaTemp',
  'AntilegionellaFreq',
  'IsQuite', // bewuste typo in de Ariston-API zelf
];

// Alleen opvragen als de bijbehorende features-vlag aan staat, anders geeft
// de dataItems-call een harde HTTP 500 voor de HELE request. Zie NOTES.md.
const CONDITIONAL_PROPERTIES = {
  hybridSys: ['HybridMode'],
  bufferTimeProgAvailable: [
    'BufferControlMode',
    'BufferTimeProgComfortHeatingTemp',
    'BufferTimeProgEconomyHeatingTemp',
    'BufferTimeProgComfortCoolingTemp',
    'BufferTimeProgEconomyCoolingTemp',
  ],
};

const THERMOSTAT_PROPERTIES = [
  'ZoneMeasuredTemp',
  'ZoneDesiredTemp',
  'ZoneComfortTemp',
  'ZoneMode',
  'ZoneHeatRequest',
  'ZoneEconomyTemp',
  'ZoneDeroga',
  'IsZonePilotOn',
  'HeatingFlowTemp',
  'HeatingFlowOffset',
];

const MENU_ITEM_IDS = { 119: 'SignalStrength', 124: 'ChReturnTemp' };

class AristonAuthError extends Error {}
class AristonConnectionError extends Error {}
class AristonRateLimitError extends AristonConnectionError {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AristonClient {
  constructor(username, password, apiUrl) {
    this._username = username;
    this._password = password;
    this._apiUrl = (apiUrl || BRANDS[0].apiUrl).replace(/\/?$/, '/');
    this._token = '';
  }

  get isAuthenticated() {
    return !!this._token;
  }

  _headers() {
    return {
      'User-Agent': USER_AGENT,
      'ar.authToken': this._token,
      'Content-Type': 'application/json',
    };
  }

  async login() {
    let response;
    try {
      response = await this._fetch('accounts/login', {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ usr: this._username, pwd: this._password }),
      });
    } catch (err) {
      throw new AristonConnectionError(`Kan niet inloggen: ${err.message}`);
    }

    if (response.status === 401 || response.status === 405 || response.status === 404) {
      throw new AristonAuthError('Inloggen mislukt, controleer e-mail en wachtwoord');
    }
    if (!response.ok) {
      throw new AristonConnectionError(`Onverwachte statuscode bij inloggen: ${response.status}`);
    }

    const data = await response.json();
    if (!data || !data.token) {
      throw new AristonAuthError('Inloggen mislukt, geen token ontvangen');
    }
    this._token = data.token;
  }

  async _fetch(path, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${this._apiUrl}${path}`, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async _request(method, path, jsonBody, isRetry = false) {
    let response;
    try {
      response = await this._fetch(path, {
        method,
        headers: this._headers(),
        body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
      });
    } catch (err) {
      if (isRetry) {
        throw new AristonConnectionError(`Netwerkfout: ${err.message}`);
      }
      await sleep(5000);
      return this._request(method, path, jsonBody, true);
    }

    if (response.status === 404) {
      return null;
    }

    if (response.status === 401 || response.status === 405) {
      if (isRetry) {
        throw new AristonAuthError('Sessie verlopen, opnieuw inloggen mislukt');
      }
      await this.login();
      return this._request(method, path, jsonBody, true);
    }

    if (response.status === 429) {
      throw new AristonRateLimitError('Rate limit bereikt (HTTP 429)');
    }

    if (!response.ok) {
      if (isRetry) {
        const text = await response.text().catch(() => '');
        throw new AristonConnectionError(`HTTP ${response.status} op ${path}: ${text.slice(0, 200)}`);
      }
      await sleep(5000);
      return this._request(method, path, jsonBody, true);
    }

    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  }

  async getPlants() {
    const result = await this._request('GET', 'remote/plants');
    return result || [];
  }

  async getFeatures(gw) {
    const result = await this._request('GET', `remote/plants/${gw}/features`);
    return result || {};
  }

  _buildItems(features) {
    const items = DEVICE_PROPERTIES.map((id) => ({ id, zn: 0 }));
    for (const [flag, propertyIds] of Object.entries(CONDITIONAL_PROPERTIES)) {
      if (features[flag]) {
        for (const id of propertyIds) items.push({ id, zn: 0 });
      }
    }
    for (const zone of features.zones || []) {
      const zoneNum = zone.num || 1;
      for (const id of THERMOSTAT_PROPERTIES) items.push({ id, zn: zoneNum });
    }
    return items;
  }

  async getProperties(gw, features) {
    const body = {
      useCache: false,
      items: this._buildItems(features),
      features,
      culture: 'en-US',
    };
    const result = await this._request('POST', `remote/dataItems/${gw}/get?umsys=si`, body);
    return result || { items: [] };
  }

  async getMenuItems(gw) {
    const ids = Object.keys(MENU_ITEM_IDS).join(',');
    const result = await this._request('GET', `menuItems/${gw}?menuItems=${ids}`);
    return result || [];
  }

  async setProperty(gw, features, itemId, value, prevValue, zone = 0) {
    const body = {
      items: [{ id: itemId, value, prevValue, zone }],
      features,
    };
    await this._request('POST', `remote/dataItems/${gw}/set?umsys=si`, body);
  }
}

function findItem(data, itemId, zone = 0) {
  const items = (data && data.items) || [];
  return items.find((item) => item.id === itemId && (item.zone || 0) === zone) || null;
}

function findMenuItem(menuItems, menuId) {
  return (menuItems || []).find((item) => item.id === menuId) || null;
}

module.exports = {
  AristonClient,
  AristonAuthError,
  AristonConnectionError,
  AristonRateLimitError,
  BRANDS,
  DEFAULT_BRAND_ID,
  getBrand,
  findItem,
  findMenuItem,
};
