import {
	action,
	KeyDownEvent,
	SingletonAction,
	WillAppearEvent,
} from "@elgato/streamdeck";

import { isOnAll, toggleAll, turnOffAll, turnOnAll } from "../litra-manager";

type PowerSettings = {
	mode?: "toggle" | "on" | "off";
};

@action({ UUID: "com.daczarne.litra.power" })
export class PowerAction extends SingletonAction<PowerSettings> {
	override async onWillAppear(ev: WillAppearEvent<PowerSettings>): Promise<void> {
		await this.syncState(ev.action);
	}

	override async onKeyDown(ev: KeyDownEvent<PowerSettings>): Promise<void> {
		const mode = ev.payload.settings.mode ?? "toggle";
		const result =
			mode === "on" ? turnOnAll() : mode === "off" ? turnOffAll() : toggleAll();

		if (!result.ok) {
			await ev.action.showAlert();
		}

		await this.syncState(ev.action);
	}

	private async syncState(action: WillAppearEvent<PowerSettings>["action"]): Promise<void> {
		if (!action.isKey()) {
			return;
		}
		const { allOn, deviceCount } = isOnAll();
		await action.setState(deviceCount > 0 && allOn ? 1 : 0);
	}
}
