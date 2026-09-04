"""Ariston NET boiler/thermostaat device.

Polt de Ariston-net cloud op een instelbaar interval (standaard 3 minuten)
en zet de waarden op de Homey-capabilities. Schrijven (target_temperature,
thermostat_mode) is standaard uitgeschakeld via de apparaatinstelling
"Schrijven toestaan" en gooit een duidelijke fout als iemand het toch
probeert terwijl die instelling uit staat.
"""

from __future__ import annotations

import asyncio

import httpx
from homey.device import Device

from lib.ariston_client import (
    DEFAULT_BRAND_ID,
    AristonAuthError,
    AristonClient,
    AristonConnectionError,
    AristonRateLimitError,
    find_item,
    get_brand,
)

DEFAULT_POLL_INTERVAL = 180
MIN_POLL_INTERVAL = 60
UNAVAILABLE_AFTER_FAILURES = 2

# ZoneMode (Ariston) <-> thermostat_mode (Homey capabilitiesOptions.values)
ZONE_MODE_TO_CAPABILITY = {0: "off", 2: "heat", 3: "auto"}
CAPABILITY_TO_ZONE_MODE = {v: k for k, v in ZONE_MODE_TO_CAPABILITY.items()}


class AristonThermostatDevice(Device):
    _poll_task: asyncio.Task | None = None
    _client: AristonClient | None = None
    _consecutive_failures: int = 0
    _last_data: dict | None = None

    async def on_init(self) -> None:
        await super().on_init()

        store = self.get_store()
        username = store.get("username", "")
        password = store.get("password", "")
        if not username or not password:
            await self.set_unavailable(
                "Geen inloggegevens gevonden voor dit apparaat, koppel opnieuw."
            )
            self.log("Geen username/password in store, device blijft unavailable")
            return

        brand = get_brand(store.get("brand_id", DEFAULT_BRAND_ID))
        self._client = AristonClient(username, password, brand["api_url"])
        self._gw = self.get_data()["id"]
        self._features: dict = {}
        self.log(f"Merk voor dit apparaat: {brand['name']} ({brand['api_url']})")

        self.register_capability_listener(
            "target_temperature", self._on_set_target_temperature
        )
        self.register_capability_listener(
            "thermostat_mode", self._on_set_thermostat_mode
        )

        self._poll_task = asyncio.create_task(self._poll_loop())
        self.log(f"AristonThermostatDevice ready: {self.get_name()} (gw {self._gw})")

    def _get_poll_interval(self) -> int:
        try:
            interval = self.get_setting("poll_interval")
            if interval:
                return max(MIN_POLL_INTERVAL, int(interval))
        except Exception:
            pass
        return DEFAULT_POLL_INTERVAL

    def _write_enabled(self) -> bool:
        """App-brede instelling (settings-pagina), standaard uit."""
        try:
            return bool(self.homey.settings.get("write_enabled"))
        except Exception:
            return False

    def _zone_num(self) -> int:
        zones = self._features.get("zones") or [{"num": 1}]
        return zones[0].get("num", 1)

    # -- Polling --

    async def _poll_loop(self) -> None:
        while True:
            try:
                await self._poll_once()
                self._consecutive_failures = 0
            except AristonAuthError as err:
                self.log(f"Login mislukt: {err}")
                await self.set_unavailable(
                    "Inloggen bij Ariston-net mislukt, controleer e-mail/wachtwoord"
                )
            except AristonRateLimitError as err:
                self.log(f"Rate limit van Ariston-net: {err}")
            except AristonConnectionError as err:
                self._consecutive_failures += 1
                self.log(f"Verbindingsfout ({self._consecutive_failures}x): {err}")
                if self._consecutive_failures >= UNAVAILABLE_AFTER_FAILURES:
                    await self.set_unavailable("Ariston-net niet bereikbaar")
            except asyncio.CancelledError:
                break
            except Exception as err:  # noqa: BLE001 - poll loop moet nooit hard crashen
                self._consecutive_failures += 1
                self.log(f"Onverwachte pollfout: {err}")
                if self._consecutive_failures >= UNAVAILABLE_AFTER_FAILURES:
                    await self.set_unavailable("Onverwachte fout, zie app-logs")
            await asyncio.sleep(self._get_poll_interval())

    async def _poll_once(self) -> None:
        async with httpx.AsyncClient() as http:
            if not self._client.is_authenticated:
                await self._client.login(http)

            if not self._features:
                self._features = await self._client.get_features(http, self._gw)

            data = await self._client.get_properties(http, self._gw, self._features)

        self._last_data = data
        await self._apply_data(data)
        await self.set_available()

    async def _apply_data(self, data: dict) -> None:
        zone = self._zone_num()

        measured = find_item(data, "ZoneMeasuredTemp", zone)
        if measured is not None and measured.get("value") is not None:
            await self.set_capability_value("measure_temperature", measured["value"])

        desired = find_item(data, "ZoneDesiredTemp", zone)
        if desired is not None and desired.get("value") is not None:
            await self.set_capability_value("target_temperature", desired["value"])

        outside = find_item(data, "OutsideTemp")
        if outside is not None and outside.get("value") is not None:
            await self.set_capability_value(
                "measure_temperature.outdoor", outside["value"]
            )

        pressure = find_item(data, "HeatingCircuitPressure")
        if pressure is not None and pressure.get("value") is not None:
            await self.set_capability_value("measure_pressure", pressure["value"])

        flame = find_item(data, "IsFlameOn")
        if flame is not None and flame.get("value") is not None:
            is_on = bool(flame["value"])
            previous = None
            try:
                previous = self.get_capability_value("boiler_active")
            except Exception:
                pass
            await self.set_capability_value("boiler_active", is_on)
            if previous is not None and previous != is_on:
                await self._fire_boiler_trigger(is_on)

        zone_mode = find_item(data, "ZoneMode", zone)
        if zone_mode is not None and zone_mode.get("value") is not None:
            mapped = ZONE_MODE_TO_CAPABILITY.get(int(zone_mode["value"]))
            if mapped:
                await self.set_capability_value("thermostat_mode", mapped)

    async def _fire_boiler_trigger(self, is_on: bool) -> None:
        app = getattr(self.homey, "_app_instance", None)
        if app and hasattr(app, "fire_boiler_status_changed"):
            try:
                await app.fire_boiler_status_changed(self, is_on)
            except Exception as err:  # noqa: BLE001
                self.log(f"Trigger boiler_status_changed error: {err}")

    # -- Setters (schrijven, staat standaard uit) --

    async def _on_set_target_temperature(self, value: float, **kwargs) -> None:
        if not self._write_enabled():
            raise Exception(
                "Schrijven naar de ketel staat uit. Zet 'Schrijven toestaan' aan "
                "in de apparaatinstellingen om de doeltemperatuur te wijzigen."
            )
        zone = self._zone_num()
        current_item = find_item(self._last_data or {}, "ZoneComfortTemp", zone)
        current_value = current_item.get("value") if current_item else None

        async with httpx.AsyncClient() as http:
            if not self._client.is_authenticated:
                await self._client.login(http)
            await self._client.set_property(
                http, self._gw, self._features, "ZoneComfortTemp", value, current_value, zone
            )
        self.log(f"target_temperature -> {value} (ZoneComfortTemp, zone {zone})")

    async def _on_set_thermostat_mode(self, value: str, **kwargs) -> None:
        if not self._write_enabled():
            raise Exception(
                "Schrijven naar de ketel staat uit. Zet 'Schrijven toestaan' aan "
                "in de apparaatinstellingen om de modus te wijzigen."
            )
        mode_value = CAPABILITY_TO_ZONE_MODE.get(value)
        if mode_value is None:
            raise Exception(f"Onbekende thermostat_mode: {value}")

        zone = self._zone_num()
        current_item = find_item(self._last_data or {}, "ZoneMode", zone)
        current_value = current_item.get("value") if current_item else None

        async with httpx.AsyncClient() as http:
            if not self._client.is_authenticated:
                await self._client.login(http)
            await self._client.set_property(
                http, self._gw, self._features, "ZoneMode", mode_value, current_value, zone
            )
        self.log(f"thermostat_mode -> {value} (ZoneMode={mode_value}, zone {zone})")

    async def on_deleted(self) -> None:
        if self._poll_task:
            self._poll_task.cancel()
            self._poll_task = None
        self.log(f"Device verwijderd: {self.get_name()}")


homey_export = AristonThermostatDevice
