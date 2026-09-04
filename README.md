# ATAG Zone for Homey

Read out your ATAG Zone (or Ariston NET) connected combi boiler and room
thermostat on Homey: room temperature, target temperature, outdoor
temperature, water pressure and burner status. Ariston NET, ATAG Zone,
Chaffoteaux and ELCO all run on the same remotethermo cloud platform, so
one app supports all four brands.

## Features

- Room temperature, target temperature, outdoor temperature, water
  pressure and burner (on/off) as Homey capabilities.
- Pairing with your existing brand app login (email and password), then
  pick your installation from the list.
- Choose your brand during pairing: **ATAG Zone** (default), Ariston NET,
  Chaffoteaux or ELCO. Chaffoteaux and ELCO use the same cloud platform
  but have not been tested against a real account.
- Polling every 3 minutes (configurable in the device settings).
- Flow cards: water pressure below X (condition), burner started/stopped
  (trigger).
- Automatic re-authentication when the session expires, and the device is
  marked unavailable (and recovers automatically) when the cloud can't be
  reached.

## Writing to the boiler

By default this app only reads your installation. It never changes
anything on your boiler. If you want to control the target temperature or
the thermostat mode from Homey, enable "Allow writing to the boiler" in
the app settings first. Until you do, changing the target temperature or
mode tile in Homey will show an error instead of silently doing nothing.

## Which brands are supported?

- **ATAG Zone** and **Ariston NET** are confirmed working: same cloud
  account, byte-identical data through both portals.
- **Chaffoteaux** and **ELCO** are selectable in the pairing screen with
  their known cloud portal, but nobody involved in building this app has
  an account with either brand, so they are untested. If pairing fails
  for you on one of these brands, please open an issue.

## Privacy

Your login credentials are stored only in the paired device (Homey's
local device storage), never sent anywhere except the brand's own cloud
API to authenticate you.

---

# ATAG Zone voor Homey

Lees je ATAG Zone (of Ariston NET) cv-ketel en kamerthermostaat uit op
Homey: kamertemperatuur, doeltemperatuur, buitentemperatuur, waterdruk en
brander-status. Ariston NET, ATAG Zone, Chaffoteaux en ELCO draaien op
hetzelfde remotethermo-cloudplatform, dus een app ondersteunt alle vier de
merken.

## Functies

- Kamertemperatuur, doeltemperatuur, buitentemperatuur, waterdruk en
  brander (aan/uit) als Homey-capabilities.
- Koppelen met je bestaande merk-app-inlog (e-mail en wachtwoord),
  daarna kies je je installatie uit een lijst.
- Kies je merk tijdens het koppelen: **ATAG Zone** (standaard), Ariston
  NET, Chaffoteaux of ELCO. Chaffoteaux en ELCO gebruiken hetzelfde
  cloudplatform maar zijn niet getest tegen een echt account.
- Ververst elke 3 minuten (instelbaar in de apparaatinstellingen).
- Flow-kaarten: waterdruk lager dan X (conditie), brander gestart/gestopt
  (trigger).
- Herauthenticatie als de sessie verloopt, en het apparaat wordt
  unavailable (en herstelt vanzelf) als de cloud niet bereikbaar is.

## Schrijven naar de ketel

Standaard leest deze app alleen je installatie uit. Er verandert nooit
iets aan je ketel. Wil je de doeltemperatuur of de thermostaatmodus vanuit
Homey kunnen bedienen, zet dan eerst "Schrijven naar de ketel toestaan"
aan in de app-instellingen. Tot die tijd geeft het wijzigen van de
doeltemperatuur- of modus-tegel in Homey een foutmelding in plaats van
stilletjes niets te doen.

## Welke merken worden ondersteund?

- **ATAG Zone** en **Ariston NET** zijn bevestigd werkend: zelfde
  cloud-account, byte-identieke data via beide portals.
- **Chaffoteaux** en **ELCO** zijn kiesbaar in het koppelscherm met hun
  bekende cloudportaal, maar niemand die aan deze app heeft gebouwd heeft
  een account bij een van beide merken, dus ze zijn ongetest. Lukt
  koppelen niet bij een van deze merken, meld dat dan als issue.

## Privacy

Je inloggegevens worden alleen bewaard in het gekoppelde apparaat
(Homey's lokale apparaat-opslag), en nergens anders naartoe gestuurd dan
naar de eigen cloud-API van het merk om je in te loggen.
