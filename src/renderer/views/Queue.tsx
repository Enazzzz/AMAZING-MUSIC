import type { QueueTrack } from "@shared/types";

/**
 * Displays queue list and exposes remove/reorder control affordances.
 */
export function QueueView(props: {
	tracks: QueueTrack[];
	onRemove: (id: string) => void;
	onMoveUp: (track: QueueTrack, index: number) => void;
}): JSX.Element {
	const { tracks, onRemove, onMoveUp } = props;
	return (
		<div className="glass-panel p-5">
			<div className="mb-4 text-2xl font-semibold text-white">Queue</div>
			<div className="space-y-2">
				{tracks.map((track, index) => (
					<div key={track.id} className="flex items-center justify-between rounded-xl border border-white/20 bg-white/10 px-3 py-2">
						<div>
							<div className="text-sm font-semibold text-white">{track.title}</div>
							<div className="text-xs text-white/70">{track.artist}</div>
						</div>
						<div className="flex gap-2">
							<button className="control-btn text-xs" onClick={() => onMoveUp(track, index)}>
								Move Up
							</button>
							<button className="control-btn text-xs" onClick={() => onRemove(track.id)}>
								Remove
							</button>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
