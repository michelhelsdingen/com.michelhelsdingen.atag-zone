"use strict";

/**
 * Ariston NET spike script (fase 1, alleen lezen).
 *
 * Logt in op de Ariston-net cloud API, haalt de plants-lijst op en de
 * volledige data van de plant uit ARISTON_PLANT_NAME (features + dataItems +
 * menuItems), en print de waarden die relevant zijn voor de Homey-app.
 *
 * HARDE REGEL: dit script doet uitsluitend GET/lees-acties. Er wordt nergens
 * een set*-endpoint aangeroepen.
 *
 * Gebruik: node spike/read.js   (leest ariston-net/.env via --env-file)
 */

const API_URL = process.env.ARISTON_API_URL || "https://www.ariston-net.remotethermo.com/api/v2/";
const USER_AGENT = "RestSharp/106.11.7.0";
const USERNAME = process.env.ARISTON_USERNAME;
const PASSWORD = process.env.ARISTON_PASSWORD;
const GW = process.env.ARISTON_GW;
const PLANT_NAME = process.env.ARISTON_PLANT_NAME;

if (!USERNAME || !PASSWORD) {
  console.error("ARISTON_USERNAME en ARISTON_PASSWORD moeten in .env staan.");
  process.exit(1);
}

// Device- en thermostat-properties zoals gebruikt door python-ariston-api
// (fustom/python-ariston-api, ariston/const.py) voor sys=3 (Galevo-familie).
const DEVICE_PROPERTIES = [
  "PlantMode",
  "IsFlameOn",
  "IsHeatingPumpOn",
  "Holiday",
  "OutsideTemp",
  "Weather",
  "HeatingCircuitPressure",
  "ChFlowTemp",
  "ChFlowSetpointTemp",
  "DhwTemp",
  "DhwStorageTemperature",
  "DhwTimeProgComfortTemp",
  "DhwTimeProgEconomyTemp",
  "DhwMode",
  "AutomaticThermoregulation",
  "AntilegionellaOnOff",
  "AntilegionellaTemp",
  "AntilegionellaFreq",
  "IsQuite", // let op: bewuste typo in de Ariston-API zelf
  // HybridMode en Buffer*-properties bewust NIET opgenomen: deze ketel heeft
  // hybridSys=false en bufferTimeProgAvailable=false. Opvragen van properties
  // die niet bij het toestel horen geeft geen lege waarde terug maar een
  // harde HTTP 500 "InternalError" op de hele dataItems-call. Zie NOTES.md.
];

const THERMOSTAT_PROPERTIES = [
  "ZoneMeasuredTemp",
  "ZoneDesiredTemp",
  "ZoneComfortTemp",
  "ZoneMode",
  "ZoneHeatRequest",
  "ZoneEconomyTemp",
  "ZoneDeroga",
  "IsZonePilotOn",
  "VirtTempOffsetHeat",
  "HeatingFlowTemp",
  "HeatingFlowOffset",
  "CoolingFlowTemp",
  "CoolingFlowOffset",
  "ZoneName",
  "VirtTempSetpointHeat",
  "VirtTempSetpointCool",
  "VirtComfortTemp",
  "VirtReducedTemp",
  "VirtTempOffsetCool",
];

// Menu-item-id's die de referentie-library apart ophaalt (niet via dataItems).
const MENU_ITEMS = {
  124: "ChReturnTemp",
  119: "SignalStrength",
};

let token = "";

async function request(method, path, body) {
  const headers = {
    "User-Agent": USER_AGENT,
    "ar.authToken": token,
    "Content-Type": "application/json",
  };
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} -> HTTP ${res.status} ${text}`);
  }
  const len = res.headers.get("content-length");
  if (len === "0") return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function login() {
  const res = await request("POST", "accounts/login", { usr: USERNAME, pwd: PASSWORD });
  if (!res || !res.token) {
    throw new Error("Login mislukt, geen token in response.");
  }
  token = res.token;
  console.log("Ingelogd, token ontvangen (lengte %d tekens).", token.length);
}

async function getPlants() {
  return request("GET", "remote/plants");
}

async function getFeatures(gw) {
  return request("GET", `remote/plants/${gw}/features`);
}

async function getMenuItems(gw) {
  const ids = Object.keys(MENU_ITEMS).join(",");
  return request("GET", `menuItems/${gw}?menuItems=${ids}`);
}

async function getProperties(gw, features) {
  const zones = features.zones || [];
  const items = [
    ...DEVICE_PROPERTIES.map((id) => ({ id, zn: 0 })),
    ...zones.flatMap((zone) =>
      THERMOSTAT_PROPERTIES.map((id) => ({ id, zn: zone.num }))
    ),
  ];
  return request(
    "POST",
    `remote/dataItems/${gw}/get?umsys=si`,
    {
      useCache: false,
      items,
      features,
      culture: "en-US",
    }
  );
}

function findItem(data, id, zone = 0) {
  const items = (data && data.items) || [];
  return items.find((it) => it.id === id && it.zone === zone);
}

function fmt(item, unitFallback) {
  if (!item) return "onbekend";
  const unit = item.unit || unitFallback || "";
  return `${item.value} ${unit}`.trim();
}

async function main() {
  console.log("=== Ariston NET spike (alleen lezen) ===");
  await login();

  const plants = await getPlants();
  console.log(`\n${plants.length} plant(s) gevonden op dit account:`);
  for (const p of plants) {
    console.log(`  - ${p.name} (gw ${p.gw}, sys ${p.sys})`);
  }

  const plant =
    plants.find((p) => p.gw === GW) ||
    plants.find((p) => p.name === PLANT_NAME) ||
    plants[0];

  if (!plant) {
    throw new Error("Geen plant gevonden om uit te lezen.");
  }

  console.log(`\nGekozen plant: ${plant.name} (gw ${plant.gw})`);

  const features = await getFeatures(plant.gw);
  console.log(`Features opgehaald, ${(features.zones || []).length} zone(s).`);

  const [data, menuItems] = await Promise.all([
    getProperties(plant.gw, features),
    getMenuItems(plant.gw),
  ]);

  console.log("\n--- Ketel ---");
  console.log("Modus (PlantMode):        ", fmt(findItem(data, "PlantMode")));
  console.log("Brander aan (IsFlameOn):  ", fmt(findItem(data, "IsFlameOn")));
  console.log("CV-pomp aan:              ", fmt(findItem(data, "IsHeatingPumpOn")));
  console.log("Waterdruk CV:             ", fmt(findItem(data, "HeatingCircuitPressure"), "bar"));
  console.log("Aanvoertemp CV:           ", fmt(findItem(data, "ChFlowTemp"), "°C"));
  console.log("Aanvoer-setpoint CV:      ", fmt(findItem(data, "ChFlowSetpointTemp"), "°C"));
  console.log("Buitentemperatuur:        ", fmt(findItem(data, "OutsideTemp"), "°C"));
  console.log("Vakantiemodus:            ", fmt(findItem(data, "Holiday")));

  console.log("\n--- Warmwater ---");
  console.log("Warmwatertemp (actueel):  ", fmt(findItem(data, "DhwTemp"), "°C"));
  console.log("Warmwater-opslagtemp:     ", fmt(findItem(data, "DhwStorageTemperature"), "°C"));
  console.log("Warmwatermodus:           ", fmt(findItem(data, "DhwMode")));

  console.log("\n--- Zones (kamerthermostaat) ---");
  for (const zone of features.zones || []) {
    console.log(`  Zone ${zone.num} (${zone.name || "naamloos"}):`);
    console.log("    Kamertemperatuur:       ", fmt(findItem(data, "ZoneMeasuredTemp", zone.num), "°C"));
    console.log("    Gewenste temperatuur:   ", fmt(findItem(data, "ZoneDesiredTemp", zone.num), "°C"));
    console.log("    Comforttemperatuur:     ", fmt(findItem(data, "ZoneComfortTemp", zone.num), "°C"));
    console.log("    Zone-modus:             ", fmt(findItem(data, "ZoneMode", zone.num)));
    console.log("    Warmtevraag:            ", fmt(findItem(data, "ZoneHeatRequest", zone.num)));
  }

  console.log("\n--- Diagnostiek (menuItems) ---");
  for (const [id, label] of Object.entries(MENU_ITEMS)) {
    const item = (menuItems || []).find((it) => it.id === Number(id));
    console.log(`  ${label}: `, item ? fmt(item) : "onbekend");
  }

  console.log("\n--- Ruwe data (voor NOTES.md) ---");
  console.log("Plant-attributen:", JSON.stringify(plant, null, 2));
  console.log("Features:", JSON.stringify(features, null, 2));
  console.log("Alle dataItems:", JSON.stringify(data.items, null, 2));
  console.log("Menu-items:", JSON.stringify(menuItems, null, 2));
}

main().catch((err) => {
  console.error("\nFOUT:", err.message);
  process.exit(1);
});
