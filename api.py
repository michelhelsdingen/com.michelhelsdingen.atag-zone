"""REST API endpoints voor de Ariston NET settings-pagina.

Alleen de app-brede "Schrijven toestaan"-vlag. Inloggegevens staan per
apparaat in de device store (gezet tijdens pairing), niet hier.
"""

from __future__ import annotations

from typing import Any


async def get_settings(
    *, homey: Homey, query: dict[str, str], params: dict[str, str], body: dict[str, Any]
) -> dict:
    return {
        "write_enabled": bool(homey.settings.get("write_enabled") or False),
    }


async def post_save_settings(
    *, homey: Homey, query: dict[str, str], params: dict[str, str], body: dict[str, Any]
) -> dict:
    if "write_enabled" in body:
        await homey.settings.set("write_enabled", bool(body["write_enabled"]))
    return {"success": True}


__all__ = ["get_settings", "post_save_settings"]
