"""Driver voor de Ariston NET / ATAG Zone boiler/thermostaat.

Custom pairing flow: login-scherm (merk + e-mail + wachtwoord) gevolgd
door een lijst met installaties (plants) op dat account. Zie
pair/login.html en pair/list_devices.html. Credentials komen alleen in
het device-object ("store"), nooit in "data" (dat wordt door de API van
het apparaat geëxposeerd).

Ariston en ATAG delen hetzelfde remotethermo cloudplatform (bevestigd in
NOTES.md: zelfde account, byte-identieke data via beide portals), alleen
de merk-portal (domeinnaam) verschilt. Het gekozen merk wordt daarom ook
in de device store bewaard, zodat device.py steeds de juiste base-URL
gebruikt.
"""

from __future__ import annotations

import httpx
from homey.driver import Driver

from lib.ariston_client import (
    BRANDS,
    DEFAULT_BRAND_ID,
    AristonAuthError,
    AristonClient,
    AristonConnectionError,
    get_brand,
)


class AristonThermostatDriver(Driver):
    async def on_init(self) -> None:
        await super().on_init()
        self.log("AristonThermostatDriver initialized")

    async def on_pair(self, session) -> None:
        pair_state: dict = {
            "username": "",
            "password": "",
            "brand_id": DEFAULT_BRAND_ID,
            "plants": [],
        }

        async def on_get_brands(_data: dict) -> dict:
            return {
                "brands": [{"id": b["id"], "name": b["name"]} for b in BRANDS],
                "default_brand_id": DEFAULT_BRAND_ID,
            }

        async def on_login(data: dict) -> dict:
            username = (data or {}).get("username", "").strip()
            password = (data or {}).get("password", "")
            brand_id = (data or {}).get("brand_id", DEFAULT_BRAND_ID)
            brand = get_brand(brand_id)

            if not username or not password:
                return {"success": False, "error": "Vul e-mail en wachtwoord in."}

            client = AristonClient(username, password, brand["api_url"])
            try:
                async with httpx.AsyncClient() as http:
                    await client.login(http)
                    plants = await client.get_plants(http)
            except AristonAuthError:
                return {
                    "success": False,
                    "error": f"Inloggen bij {brand['name']} mislukt. Controleer e-mail en wachtwoord.",
                }
            except AristonConnectionError as err:
                return {
                    "success": False,
                    "error": f"Kan {brand['name']} niet bereiken: {err}",
                }

            if not plants:
                return {
                    "success": False,
                    "error": "Geen installaties gevonden op dit account.",
                }

            pair_state["username"] = username
            pair_state["password"] = password
            pair_state["brand_id"] = brand["id"]
            pair_state["plants"] = plants
            self.log(f"Pairing login OK via {brand['name']}, {len(plants)} plant(s) gevonden")
            return {"success": True}

        async def on_list_plants(_data: dict) -> list[dict]:
            return [
                {
                    "gw": plant.get("gw", ""),
                    "name": plant.get("name") or plant.get("gw", "Boiler"),
                }
                for plant in pair_state["plants"]
            ]

        async def on_select_plant(data: dict) -> dict:
            gw = (data or {}).get("gw", "")
            plant = next(
                (p for p in pair_state["plants"] if p.get("gw") == gw), None
            )
            if not plant:
                return {"success": False, "error": "Onbekende installatie."}

            return {
                "success": True,
                "device": {
                    "name": plant.get("name") or "CV-ketel",
                    "data": {"id": plant.get("gw")},
                    "store": {
                        "username": pair_state["username"],
                        "password": pair_state["password"],
                        "brand_id": pair_state["brand_id"],
                    },
                },
            }

        session.set_handler("get_brands", on_get_brands)
        session.set_handler("login", on_login)
        session.set_handler("list_plants", on_list_plants)
        session.set_handler("select_plant", on_select_plant)


homey_export = AristonThermostatDriver
