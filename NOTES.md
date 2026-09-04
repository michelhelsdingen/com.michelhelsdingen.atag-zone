# Ariston NET cloud API, spike-bevindingen

Datum spike: 2026-09-04, tegen de echte cloud, ketel "Hofesch" (gateway
F0AD4E1F2BA6, systeemtype sys=3, Galevo-familie). Script: `spike/read.js`,
alleen GET/lees-acties, geen enkele set-aanroep gedaan.

## Bron

Reverse-engineered uit de Python-bibliotheek `fustom/python-ariston-api`
(pip-package `ariston`) en `fustom/ariston-remotethermo-home-assistant-v3`,
gekloond naar de scratchpad voor deze taak. sys=3 komt overeen met
`SystemType.GALEVO` in die bibliotheek en gebruikt de klasse
`AristonGalevoDevice` (bestand `ariston/galevo_device.py`).

## Basis-URL en headers

- Basis-URL: `https://www.ariston-net.remotethermo.com/api/v2/`
- Elke request stuurt een `User-Agent: RestSharp/106.11.7.0` mee (dat is de
  user-agent van de officiele .NET-app, gebruikt door de referentie-clients).
- Na inloggen gaat het token mee als header `ar.authToken: <token>`, niet als
  Bearer-token en niet als cookie.

## Login en sessie

- `POST accounts/login` met JSON-body `{"usr": "<email>", "pwd": "<wachtwoord>"}`.
- Response: `{"token": "<lange string>"}`. In de spike was het token 296
  tekens lang.
- Er is geen zichtbare vervaltijd in de response. De referentie-library gaat
  ervan uit dat het token kan verlopen en behandelt een HTTP 405 op een
  latere request als "token ongeldig, opnieuw inloggen": bij 405 opnieuw
  `accounts/login` doen en de mislukte request eenmalig herhalen. Blijft het
  405 geven, dan is het waarschijnlijk een verkeerd wachtwoord.
- Bij een generieke fout (niet 404/405/429) doet de referentie-library eerst
  5 seconden wachten en de request eenmalig herhalen voordat hij opgeeft.
- HTTP 404 wordt stil als "geen data" behandeld (null), geen exception.
- HTTP 429 is rate limiting; in de spike niet tegengekomen bij een handvol
  requests kort na elkaar, maar wel iets om in de Homey-app netjes af te
  vangen (backoff, niet meteen opnieuw proberen).

## Devices ophalen

- `GET remote/plants` geeft een array met een volledig object per installatie
  (plant). Voor dit account kwam er precies 1 plant terug: "Hofesch".
- Relevante velden per plant: `gw` (gateway-id, de sleutel voor alle andere
  calls), `name`, `sys` (systeemtype, 3 = Galevo), `sn` (serienummer),
  `fwVer`, `loc` (adres/coordinaten), `mqttApiVersion`, `isOffline48H`.
- Er bestaat ook `remote/plants/lite` (lichte lijst) en `velis/plants` voor
  boilers van het Velis-type (niet van toepassing hier, dit is een normale
  cv-ketel met kamerthermostaat).

## Features ophalen

- `GET remote/plants/{gw}/features` geeft een plat object terug met
  boolean/enum-vlaggen die bepalen wat het toestel wel en niet ondersteunt,
  plus de array `zones` (voor deze ketel 1 zone, nummer 1, geen naam
  ingesteld).
- Belangrijkste vlaggen voor Hofesch: `hasBoiler: true`, `dhwModeChangeable:
  true`, `autoThermoReg: true`, `hasMetering: true`, `pilotSupported: true`,
  `hybridSys: false`, `bufferTimeProgAvailable: false`, `hasVmc: false`,
  `hasSlp: false`.
- **Deze features-vlaggen bepalen welke properties je hierna mag opvragen**,
  zie de valkuil hieronder.

## Waarden ophalen (dataItems)

- `POST remote/dataItems/{gw}/get?umsys=si` met body:
  ```json
  {
    "useCache": false,
    "items": [{"id": "PlantMode", "zn": 0}, {"id": "ZoneMeasuredTemp", "zn": 1}, "..."],
    "features": { "...de volledige features-response van hierboven..." },
    "culture": "en-US"
  }
  ```
  `umsys` is `si` voor metrisch of `us` voor Amerikaanse eenheden.
- `zn` is de zone (0 voor ketel-brede properties, het zone-nummer voor
  thermostaat-properties per zone).
- De response is `{"items": [...]}`, elk item met: `id`, `zone`, `value`,
  `min`, `max`, `step`, `decimals`, `unit`, `readOnly`, `error`, `invalid`, en
  bij keuzelijsten ook `options` (numerieke codes) en `optTexts` (Engelse
  labels op dezelfde index).
- Ketel-properties die iets teruggaven voor Hofesch: `PlantMode`,
  `IsFlameOn`, `Holiday`, `OutsideTemp`, `Weather`, `HeatingCircuitPressure`,
  `ChFlowTemp`, `ChFlowSetpointTemp`, `DhwTemp`, `DhwTimeProgComfortTemp`,
  `DhwTimeProgEconomyTemp`, `DhwMode`, `AutomaticThermoregulation`.
- Per-zone properties die iets teruggaven: `ZoneMeasuredTemp`,
  `ZoneDesiredTemp`, `ZoneComfortTemp`, `ZoneMode`, `ZoneHeatRequest`,
  `ZoneEconomyTemp`, `ZoneDeroga`, `IsZonePilotOn`, `VirtTempOffsetHeat`,
  `HeatingFlowTemp`, `HeatingFlowOffset`, `ZoneName`, `VirtTempSetpointHeat`,
  `VirtComfortTemp`, `VirtReducedTemp`.
- Properties die je wel mag opvragen maar die stil zonder item in de response
  terugkomen als het toestel ze niet heeft (voorbeeld hier:
  `IsHeatingPumpOn`, `DhwStorageTemperature`, `AntilegionellaOnOff`,
  `AntilegionellaTemp`, `AntilegionellaFreq`, `IsQuite`,
  `CoolingFlowTemp`/`CoolingFlowOffset`, `VirtTempSetpointCool`,
  `VirtTempOffsetCool`). Die kun je gewoon in de request-lijst laten staan.

### Valkuil: sommige properties geven een harde 500 in plaats van te ontbreken

`HybridMode` en alle `Buffer*`-properties (`BufferControlMode`,
`BufferTimeProgComfortHeatingTemp`, `BufferTimeProgEconomyHeatingTemp`,
`BufferTimeProgComfortCoolingTemp`, `BufferTimeProgEconomyCoolingTemp`) zijn
niet zomaar afwezig als het toestel ze niet heeft: de hele
`dataItems/{gw}/get`-call gooit dan een `HTTP 500 ":-( Gateway error from
<gw> (Response code: InternalError)"`, voor alle items in die ene request,
niet alleen voor het niet-ondersteunde item. Hofesch heeft `hybridSys: false`
en `bufferTimeProgAvailable: false`, dus die properties zijn eruit gelaten.

**Werkwijze in de Homey-app**: bouw de items-lijst op basis van de
features-response (alleen `HybridMode` opvragen als `hybridSys` true is,
alleen `Buffer*` opvragen als `bufferTimeProgAvailable` true is), in plaats
van altijd de volledige vaste lijst te sturen zoals de Python-referentie doet.

## Diagnostiek (menuItems)

- `GET menuItems/{gw}?menuItems=119,124` geeft losse diagnostische waarden
  die niet in dataItems zitten. Voor Hofesch getest: menu-item 119 =
  "Signal Level" (90%, wifi-signaalsterkte van de gateway) en menu-item 124 =
  "CH return temperature" (retourtemperatuur cv, 52°C).
- Response-item heeft o.a. `id`, `nodeId`, `text` (Engels label), `value`,
  `unit`, `min`, `max`, `decimals`.

## Actuele waarden uit de spike (Hofesch, 2026-09-04)

| Property | Waarde |
|---|---|
| Modus (PlantMode) | 1 = Winter |
| Brander aan (IsFlameOn) | 0 = uit |
| Waterdruk CV (HeatingCircuitPressure) | 1,0 bar |
| Aanvoertemp CV (ChFlowTemp) | 54°C |
| Aanvoer-setpoint CV (ChFlowSetpointTemp) | 85°C |
| Buitentemperatuur (OutsideTemp) | 20°C |
| Retourtemp CV (menuItem 124) | 52°C |
| Warmwatertemp (DhwTemp) | 60°C |
| Warmwatermodus (DhwMode) | 2 = Always active |
| Kamertemperatuur zone 1 (ZoneMeasuredTemp) | 23,5°C |
| Gewenste temperatuur zone 1 (ZoneDesiredTemp) | 21°C |
| Comforttemperatuur zone 1 (ZoneComfortTemp) | 21°C |
| Zone-modus (ZoneMode) | 2 = Manual |
| Warmtevraag zone 1 (ZoneHeatRequest) | 0 = uit |
| Wifi-signaal gateway (menuItem 119) | 90% |

`PlantMode.optTexts` voor deze ketel: Summer, Winter, Heating only, OFF
(codes 0, 1, 2, 5). `ZoneMode.optTexts`: OFF, Manual, Time program (codes 0,
2, 3, let op: geen code 1, die staat in de enum wel als MANUAL_NIGHT maar zit
niet in de opties van dit toestel). `DhwMode.optTexts`: Disabled, Time Based,
Always active (codes 0, 1, 2).

## Setters (nog niet gebruikt, alleen gedocumenteerd voor later)

Voor een volgende ronde, na toestemming van Michel:

- `POST remote/dataItems/{gw}/set?umsys=si` met body
  `{"items": [{"id": "<property>", "value": <nieuw>, "prevValue": <oud>,
  "zone": <zn>}], "features": {...}}` voor alles wat via dataItems loopt
  (target-temperatuur zone, DHW-temperatuur, PlantMode, ZoneMode, enzovoort).
- Voorbeeld target-temperatuur zone: property `ZoneComfortTemp` (niet
  `ZoneDesiredTemp`, die is `readOnly: true`).
- Voorbeeld DHW-temperatuur: property `DhwTemp`.

## Rate limits

Niet expliciet tegen een limiet aangelopen bij de handvol requests in deze
spike (login, plants, features, dataItems, menuItems, kort na elkaar). Geen
harde cijfers bekend; de Homey-app moet 429 gewoon netjes afvangen met
backoff, niet automatisch retryen op vaste intervallen.
