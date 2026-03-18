/**
 * Renders a compact output device selection dropdown.
 */
export function DeviceSwitcher(props: {
	activeDeviceId: string | null;
	devices: Array<{ id: string; displayName: string }>;
	onChange: (deviceId: string) => void;
}): JSX.Element {
	const { activeDeviceId, devices, onChange } = props;
	return (
		<select
			value={activeDeviceId ?? "default"}
			onChange={(event) => onChange(event.target.value)}
			className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none"
		>
			{devices.map((device) => (
				<option key={device.id} value={device.id} className="bg-slate-800">
					{device.displayName}
				</option>
			))}
		</select>
	);
}
