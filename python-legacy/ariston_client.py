"""Kleine async client voor de Ariston-net cloud API (sys=3, Galevo-familie).

Gebaseerd op het gedrag van fustom/python-ariston-api, opnieuw geschreven
voor Homey's Python-app-runtime (httpx in plaats van aiohttp/requests).

Alle GET-achtige methodes hier zijn puur lezen. `set_property()` schrijft
naar de ketel en wordt in de driver/device laag bewust achter de
app-instelling "Schrijven toestaan" gehouden (die staat standaard uit).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

import httpx

_LOGGER = logging.getLogger(__name__)

DEFAULT_API_URL = "https://www.ariston-net.remotethermo.com/api/v2/"
USER_AGENT = "RestSharp/106.11.7.0"
REQUEST_TIMEOUT = 20.0

# Ariston en ATAG delen hetzelfde remotethermo cloudplatform (bevestigd:
# zelfde account, zelfde plant, byte-identieke features/dataItems-responses
# via beide portals, zie NOTES.md). Alleen de merk-portal (domeinnaam)
# verschilt. Volgorde hier bepaalt de volgorde in de pairing-dropdown.
BRANDS: list[dict[str, str]] = [
    {
        "id": "ariston",
        "name": "Ariston NET",
        "api_url": "https://www.ariston-net.remotethermo.com/api/v2/",
    },
    {
        "id": "atag",
        "name": "ATAG Zone",
        "api_url": "https://www.atagzone.remotethermo.com/api/v2/",
    },
]
DEFAULT_BRAND_ID = "atag"  # Michels eigen ketel gebruikt de ATAG Zone-app


def get_brand(brand_id: str) -> dict[str, str]:
    """Zoek een merk op id, valt terug op het eerste merk (Ariston NET)."""
    return next((b for b in BRANDS if b["id"] == brand_id), BRANDS[0])

# Properties die de ketel altijd wel/niet kan hebben, onafhankelijk van de
# features-response.
DEVICE_PROPERTIES = [
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
    "IsQuite",  # bewuste typo in de Ariston-API zelf
]

# Alleen opvragen als de bijbehorende features-vlag aan staat, anders geeft
# de dataItems-call een harde HTTP 500 voor de HELE request. Zie NOTES.md.
CONDITIONAL_PROPERTIES = {
    "hybridSys": ["HybridMode"],
    "bufferTimeProgAvailable": [
        "BufferControlMode",
        "BufferTimeProgComfortHeatingTemp",
        "BufferTimeProgEconomyHeatingTemp",
        "BufferTimeProgComfortCoolingTemp",
        "BufferTimeProgEconomyCoolingTemp",
    ],
}

THERMOSTAT_PROPERTIES = [
    "ZoneMeasuredTemp",
    "ZoneDesiredTemp",
    "ZoneComfortTemp",
    "ZoneMode",
    "ZoneHeatRequest",
    "ZoneEconomyTemp",
    "ZoneDeroga",
    "IsZonePilotOn",
    "HeatingFlowTemp",
    "HeatingFlowOffset",
]

MENU_ITEM_IDS = {
    119: "SignalStrength",
    124: "ChReturnTemp",
}


class AristonAuthError(Exception):
    """Login mislukt (verkeerde gebruikersnaam/wachtwoord)."""


class AristonConnectionError(Exception):
    """Netwerk- of serverfout richting de Ariston-cloud."""


class AristonRateLimitError(AristonConnectionError):
    """HTTP 429, te veel requests."""


class AristonClient:
    def __init__(
        self,
        username: str,
        password: str,
        api_url: str = DEFAULT_API_URL,
    ) -> None:
        self._username = username
        self._password = password
        self._api_url = api_url.rstrip("/") + "/"
        self._token: str = ""

    @property
    def is_authenticated(self) -> bool:
        return bool(self._token)

    async def login(self, client: httpx.AsyncClient) -> None:
        """Log in en bewaar het token. Gooit AristonAuthError bij foute inloggegevens."""
        try:
            response = await client.post(
                f"{self._api_url}accounts/login",
                json={"usr": self._username, "pwd": self._password},
                headers=self._headers(),
                timeout=REQUEST_TIMEOUT,
            )
        except httpx.HTTPError as err:
            raise AristonConnectionError(f"Kan niet inloggen: {err}") from err

        if response.status_code in (401, 405):
            raise AristonAuthError("Inloggen mislukt, controleer e-mail en wachtwoord")
        if response.status_code != 200:
            raise AristonConnectionError(
                f"Onverwachte statuscode bij inloggen: {response.status_code}"
            )

        data = response.json()
        token = data.get("token")
        if not token:
            raise AristonAuthError("Inloggen mislukt, geen token ontvangen")
        self._token = token

    def _headers(self) -> dict[str, str]:
        return {
            "User-Agent": USER_AGENT,
            "ar.authToken": self._token,
            "Content-Type": "application/json",
        }

    async def _request(
        self,
        client: httpx.AsyncClient,
        method: str,
        path: str,
        json_body: Any = None,
        *,
        is_retry: bool = False,
    ) -> Any:
        try:
            response = await client.request(
                method,
                f"{self._api_url}{path}",
                json=json_body,
                headers=self._headers(),
                timeout=REQUEST_TIMEOUT,
            )
        except httpx.HTTPError as err:
            if is_retry:
                raise AristonConnectionError(f"Netwerkfout: {err}") from err
            await asyncio.sleep(5)
            return await self._request(client, method, path, json_body, is_retry=True)

        if response.status_code == 404:
            return None

        if response.status_code in (401, 405):
            # Token verlopen of ongeldig: eenmalig opnieuw inloggen en herhalen.
            if is_retry:
                raise AristonAuthError("Sessie verlopen, opnieuw inloggen mislukt")
            await self.login(client)
            return await self._request(client, method, path, json_body, is_retry=True)

        if response.status_code == 429:
            raise AristonRateLimitError("Ariston-net rate limit bereikt (HTTP 429)")

        if response.status_code >= 400:
            if is_retry:
                raise AristonConnectionError(
                    f"HTTP {response.status_code} op {path}: {response.text[:200]}"
                )
            await asyncio.sleep(5)
            return await self._request(client, method, path, json_body, is_retry=True)

        if not response.content:
            return None
        return response.json()

    async def get_plants(self, client: httpx.AsyncClient) -> list[dict[str, Any]]:
        result = await self._request(client, "GET", "remote/plants")
        return list(result) if result else []

    async def get_features(self, client: httpx.AsyncClient, gw: str) -> dict[str, Any]:
        result = await self._request(client, "GET", f"remote/plants/{gw}/features")
        return result or {}

    def _build_items(self, features: dict[str, Any]) -> list[dict[str, Any]]:
        items = [{"id": pid, "zn": 0} for pid in DEVICE_PROPERTIES]
        for feature_flag, property_ids in CONDITIONAL_PROPERTIES.items():
            if features.get(feature_flag):
                items.extend({"id": pid, "zn": 0} for pid in property_ids)
        for zone in features.get("zones", []):
            zone_num = zone.get("num", 1)
            items.extend({"id": pid, "zn": zone_num} for pid in THERMOSTAT_PROPERTIES)
        return items

    async def get_properties(
        self, client: httpx.AsyncClient, gw: str, features: dict[str, Any]
    ) -> dict[str, Any]:
        body = {
            "useCache": False,
            "items": self._build_items(features),
            "features": features,
            "culture": "en-US",
        }
        result = await self._request(
            client, "POST", f"remote/dataItems/{gw}/get?umsys=si", body
        )
        return result or {"items": []}

    async def get_menu_items(self, client: httpx.AsyncClient, gw: str) -> list[dict[str, Any]]:
        ids = ",".join(str(i) for i in MENU_ITEM_IDS)
        result = await self._request(client, "GET", f"menuItems/{gw}?menuItems={ids}")
        return list(result) if result else []

    async def set_property(
        self,
        client: httpx.AsyncClient,
        gw: str,
        features: dict[str, Any],
        item_id: str,
        value: float,
        prev_value: Optional[float],
        zone: int = 0,
    ) -> None:
        """Schrijf een enkele property. Uitsluitend aanroepen als schrijven is toegestaan."""
        body = {
            "items": [
                {
                    "id": item_id,
                    "value": value,
                    "prevValue": prev_value,
                    "zone": zone,
                }
            ],
            "features": features,
        }
        await self._request(client, "POST", f"remote/dataItems/{gw}/set?umsys=si", body)


def find_item(data: dict[str, Any], item_id: str, zone: int = 0) -> Optional[dict[str, Any]]:
    """Zoek een dataItem terug op id + zone. Geeft None als het toestel het niet heeft."""
    for item in data.get("items", []):
        if item.get("id") == item_id and item.get("zone", 0) == zone:
            return item
    return None


def find_menu_item(menu_items: list[dict[str, Any]], menu_id: int) -> Optional[dict[str, Any]]:
    for item in menu_items:
        if item.get("id") == menu_id:
            return item
    return None
