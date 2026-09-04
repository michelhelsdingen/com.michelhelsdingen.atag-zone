# Python-versie (gearchiveerd)

Dit was de originele Homey SDK 3 Python-implementatie van deze app. Werkte
prima in `homey app validate --level publish` (na wat colima-mount-fixes),
maar crashte bij het opstarten op de Self-Hosted Server (macOS): de
Python-runtime praat met Homey's core via een Unix-domain-socket, en de
app-map van de Mac-SHS staat op een virtiofs-share tussen macOS en de VM
waar zulke sockets niet werken (`Error: uv_pipe_chmod EINVAL at
AppLocal.createUnixDomainSocket`, reproduceerbaar na herstart). Node-apps
(Bambu, Solcast, HomeyLink) draaiden op diezelfde SHS wel gewoon.

Daarom is de app herbouwd als JavaScript SDK 3-app in de hoofdmap van dit
project (`app.js`, `api.js`, `lib/aristonClient.js`,
`drivers/thermostat/*.js`), met exact dezelfde functionaliteit,
capabilities en beslissingen. Deze map staat er alleen nog ter referentie
en voor de geschiedenis, wordt niet meer onderhouden en zit niet in de
Homey-app-build (`.homeyignore`).
