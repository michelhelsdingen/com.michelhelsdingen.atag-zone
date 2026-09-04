"""Ariston NET — Homey App: bedien je Ariston cv-ketel en kamerthermostaat."""

from __future__ import annotations

import homey


class App(homey.app.App):
    async def on_init(self) -> None:
        self.log("Ariston NET starting...")

        await self._register_flow_cards()

        # Expose voor device callbacks (flow triggers), zelfde patroon als
        # andere Python Homey-apps van Michel.
        self.homey._app_instance = self

        self.log("Ariston NET ready.")

    async def fire_boiler_status_changed(self, device, is_on: bool) -> None:
        """Wordt aangeroepen door device.py als IsFlameOn van waarde wisselt."""
        if self._boiler_status_trigger is None:
            return
        try:
            await self._boiler_status_trigger.trigger(
                device,
                {"is_flame_on": is_on},
                {"state": "on" if is_on else "off"},
            )
        except Exception as err:  # noqa: BLE001
            self.log(f"Boiler status trigger error: {err}")

    # -- Flow card registratie --

    async def _register_flow_cards(self) -> None:
        # get_device_trigger_card is de Python-tegenhanger van JS'
        # getDeviceTriggerCard (device-scoped trigger). Defensief afgevangen:
        # als de exacte methodenaam toch anders blijkt te zijn, mag de rest
        # van de app (condities, capabilities, polling) gewoon blijven werken.
        self._boiler_status_trigger = None
        try:
            self._boiler_status_trigger = self.homey.flow.get_device_trigger_card(
                "ariston_boiler_status_changed"
            )
        except Exception as err:  # noqa: BLE001
            self.log(f"Kon trigger card niet registreren: {err}")

        pressure_below = self.homey.flow.get_condition_card("ariston_pressure_below")
        pressure_below.register_run_listener(
            lambda args, **kw: self._check_pressure_below(args)
        )

    async def _check_pressure_below(self, args: dict) -> bool:
        device = args["device"]
        threshold = float(args["pressure"])
        try:
            current = device.get_capability_value("measure_pressure")
        except Exception as err:  # noqa: BLE001
            self.log(f"Pressure condition read error: {err}")
            return False
        if current is None:
            return False
        return float(current) < threshold


homey_export = App

if __name__ == "__main__":
    homey.run(App)
