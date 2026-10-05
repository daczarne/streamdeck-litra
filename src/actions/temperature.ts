import {
	action,
	DialDownEvent,
	DialRotateEvent,
	DidReceiveSettingsEvent,
	KeyDownEvent,
	SingletonAction,
	WillAppearEvent,
} from "@elgato/streamdeck";

import {
	adjustTemperatureAllByKelvinSteps,
	createDialDebouncer,
	readRepresentativeTemperatureKelvin,
	setTemperatureAllInKelvin,
	toggleAll,
} from "../litra-manager";

type TemperatureSettings = {
	presetKelvin?: number;
	stepKelvin?: number | string;
};

type ActionRef = WillAppearEvent<TemperatureSettings>["action"];

@action({ UUID: "com.daczarne.litra.temperature" })
export class TemperatureAction extends SingletonAction<TemperatureSettings> {
	private readonly dialQueues = new Map<string, (ticks: number) => void>();
	private readonly latestSettings = new Map<string, TemperatureSettings>();

	override async onWillAppear(ev: WillAppearEvent<TemperatureSettings>): Promise<void> {
		this.latestSettings.set(ev.action.id, ev.payload.settings);
		await this.refreshDisplay(ev.action, ev.payload.settings);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TemperatureSettings>): Promise<void> {
		this.latestSettings.set(ev.action.id, ev.payload.settings);
		await this.refreshDisplay(ev.action, ev.payload.settings);
	}

	override async onKeyDown(ev: KeyDownEvent<TemperatureSettings>): Promise<void> {
		const preset = Number(ev.payload.settings.presetKelvin ?? 4000);
		const result = setTemperatureAllInKelvin(preset);
		if (!result.ok) {
			await ev.action.showAlert();
			return;
		}
		// Key tiles represent the configured set-amount, not live hardware K.
		await this.showKeyAmount(ev.action, preset);
	}

	/** Dial press toggles power; rotate adjusts temperature. */
	override async onDialDown(ev: DialDownEvent<TemperatureSettings>): Promise<void> {
		const result = toggleAll();
		if (!result.ok) {
			await ev.action.showAlert();
			return;
		}
		await this.refreshDisplay(ev.action, ev.payload.settings);
	}

	override async onDialRotate(ev: DialRotateEvent<TemperatureSettings>): Promise<void> {
		const id = ev.action.id;
		this.latestSettings.set(id, ev.payload.settings);
		let queue = this.dialQueues.get(id);
		if (!queue) {
			queue = createDialDebouncer(async (ticks) => {
				const settings = this.latestSettings.get(id) ?? {};
				const step = Number(settings.stepKelvin ?? 100);
				const result = adjustTemperatureAllByKelvinSteps(ticks, step);
				if (!result.ok) {
					await ev.action.showAlert();
					return;
				}
				await this.showDialValue(ev.action, result.representativeTemperatureKelvin);
			});
			this.dialQueues.set(id, queue);
		}
		queue(ev.payload.ticks);
	}

	private async refreshDisplay(action: ActionRef, settings: TemperatureSettings): Promise<void> {
		if (action.isKey()) {
			await this.showKeyAmount(action, Number(settings.presetKelvin ?? 4000));
			return;
		}

		const result = readRepresentativeTemperatureKelvin();
		await this.showDialValue(
			action,
			result.ok ? result.representativeTemperatureKelvin : undefined,
		);
	}

	private async showKeyAmount(action: ActionRef, kelvin: number): Promise<void> {
		await action.setTitle(`${Math.round(kelvin)}`);
	}

	private async showDialValue(action: ActionRef, kelvin: number | undefined): Promise<void> {
		const label = kelvin === undefined ? "—" : `${Math.round(kelvin)}`;
		if (action.isDial()) {
			await action.setFeedback({
				title: "Temp",
				value: label,
			});
		}
	}
}
