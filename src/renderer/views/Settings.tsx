import { useState } from "react";
import type { MorphoConfig } from "@shared/types";

/**
 * Renders all required configuration controls for Morpho runtime behavior.
 */
export function SettingsView(props: {
	config: MorphoConfig | null;
	onConfigPatch: (patch: Partial<MorphoConfig>) => void;
}): JSX.Element {
	const { config, onConfigPatch } = props;
	const [amazonPath, setAmazonPath] = useState(config?.amazonExePath ?? "");
	if (!config) {
		return <div className="glass-panel p-5 text-white/70">Loading settings...</div>;
	}
	return (
		<div className="glass-panel p-5">
			<div className="mb-4 text-2xl font-semibold text-white">Settings</div>
			<div className="grid grid-cols-2 gap-4">
				<label className="control-input">
					<span>Amazon Music .exe path</span>
					<input
						className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white"
						value={amazonPath}
						onChange={(event) => setAmazonPath(event.target.value)}
						onBlur={() => onConfigPatch({ amazonExePath: amazonPath })}
					/>
				</label>
				<label className="control-input">
					<span>Audio Quality</span>
					<select
						value={config.audioQuality}
						onChange={(event) => onConfigPatch({ audioQuality: event.target.value as MorphoConfig["audioQuality"] })}
						className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white"
					>
						<option className="bg-slate-900" value="STANDARD">
							STANDARD
						</option>
						<option className="bg-slate-900" value="HD">
							HD
						</option>
						<option className="bg-slate-900" value="ULTRA_HD">
							ULTRA_HD
						</option>
					</select>
				</label>
				<label className="control-input">
					<span>Exclusive Mode</span>
					<input
						type="checkbox"
						checked={config.hideAmazonWindow}
						onChange={(event) => onConfigPatch({ hideAmazonWindow: event.target.checked })}
					/>
				</label>
				<label className="control-input">
					<span>Autostart with Windows</span>
					<input
						type="checkbox"
						checked={config.autostartWithWindows}
						onChange={(event) => onConfigPatch({ autostartWithWindows: event.target.checked })}
					/>
				</label>
			</div>
		</div>
	);
}
