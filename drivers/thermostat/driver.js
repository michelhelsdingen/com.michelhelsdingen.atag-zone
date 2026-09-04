'use strict';

// Driver voor de Ariston NET / ATAG Zone / Chaffoteaux / ELCO
// boiler/thermostaat.
//
// Custom pairing flow: login-scherm (merk + e-mail + wachtwoord) gevolgd
// door een lijst met installaties (plants) op dat account. Zie
// pair/login.html en pair/list_devices.html. Credentials komen alleen in
// het device-object ("store"), nooit in "data" (dat wordt door de API van
// het apparaat geeexposeerd).
//
// Deze merken delen hetzelfde remotethermo cloudplatform (bevestigd in
// NOTES.md voor Ariston/ATAG: zelfde account, byte-identieke data via
// beide portals), alleen de merk-portal (domeinnaam) verschilt. Het
// gekozen merk wordt daarom ook in de device store bewaard, zodat
// device.js steeds de juiste base-URL gebruikt.

const Homey = require('homey');
const {
  BRANDS,
  DEFAULT_BRAND_ID,
  AristonClient,
  AristonAuthError,
  AristonConnectionError,
  getBrand,
} = require('../../lib/aristonClient');

class AristonThermostatDriver extends Homey.Driver {
  async onInit() {
    this.log('AristonThermostatDriver initialized');
  }

  async onPair(session) {
    const pairState = {
      username: '',
      password: '',
      brandId: DEFAULT_BRAND_ID,
      plants: [],
    };

    session.setHandler('get_brands', async () => ({
      brands: BRANDS.map((b) => ({ id: b.id, name: b.name })),
      default_brand_id: DEFAULT_BRAND_ID,
    }));

    session.setHandler('login', async (data) => {
      const username = ((data && data.username) || '').trim();
      const password = (data && data.password) || '';
      const brandId = (data && data.brand_id) || DEFAULT_BRAND_ID;
      const brand = getBrand(brandId);

      if (!username || !password) {
        return { success: false, error: 'Vul e-mail en wachtwoord in.' };
      }

      const client = new AristonClient(username, password, brand.apiUrl);
      let plants;
      try {
        await client.login();
        plants = await client.getPlants();
      } catch (err) {
        if (err instanceof AristonAuthError) {
          return {
            success: false,
            error: `Inloggen bij ${brand.name} mislukt. Controleer e-mail en wachtwoord.`,
          };
        }
        if (err instanceof AristonConnectionError) {
          return { success: false, error: `Kan ${brand.name} niet bereiken: ${err.message}` };
        }
        throw err;
      }

      if (!plants || plants.length === 0) {
        return { success: false, error: 'Geen installaties gevonden op dit account.' };
      }

      pairState.username = username;
      pairState.password = password;
      pairState.brandId = brand.id;
      pairState.plants = plants;
      this.log(`Pairing login OK via ${brand.name}, ${plants.length} plant(en) gevonden`);
      return { success: true };
    });

    session.setHandler('list_plants', async () => pairState.plants.map((plant) => ({
      gw: plant.gw || '',
      name: plant.name || plant.gw || 'Boiler',
    })));

    session.setHandler('select_plant', async (data) => {
      const gw = (data && data.gw) || '';
      const plant = pairState.plants.find((p) => p.gw === gw);
      if (!plant) {
        return { success: false, error: 'Onbekende installatie.' };
      }

      return {
        success: true,
        device: {
          name: plant.name || 'CV-ketel',
          data: { id: plant.gw },
          store: {
            username: pairState.username,
            password: pairState.password,
            brand_id: pairState.brandId,
          },
        },
      };
    });
  }
}

module.exports = AristonThermostatDriver;
