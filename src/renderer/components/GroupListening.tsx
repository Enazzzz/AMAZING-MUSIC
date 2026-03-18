/**
 * Displays high-level group listening room controls and status.
 */
export function GroupListening(): JSX.Element {
	return (
		<div className="glass-panel p-5">
			<div className="mb-3 text-xl font-semibold text-white">Group Listening</div>
			<div className="mb-4 text-sm text-white/70">
				Start a room to sync track, seek, and play state to connected listeners.
			</div>
			<div className="flex flex-wrap gap-3">
				<button className="rounded-lg bg-white/20 px-4 py-2 text-sm text-white">Start Room</button>
				<button className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white/80">Join Room</button>
			</div>
			<div className="mt-4 text-xs text-white/60">Status: Idle (server disabled by default)</div>
		</div>
	);
}
