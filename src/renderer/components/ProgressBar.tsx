import { useMemo } from "react";

/**
 * Converts milliseconds to an mm:ss timestamp string.
 */
function formatMs(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Renders seekable playback and buffered progress.
 */
export function ProgressBar(props: {
	currentMs: number;
	durationMs: number;
	bufferedMs: number;
	accent: string;
	onSeek: (nextMs: number) => void;
}): JSX.Element {
	const { currentMs, durationMs, bufferedMs, accent, onSeek } = props;
	const progressPercent = useMemo(() => (durationMs > 0 ? (currentMs / durationMs) * 100 : 0), [currentMs, durationMs]);
	const bufferedPercent = useMemo(() => (durationMs > 0 ? (bufferedMs / durationMs) * 100 : 0), [bufferedMs, durationMs]);

	return (
		<div className="w-full">
			<div className="mb-2 flex justify-between text-xs text-white/70">
				<span>{formatMs(currentMs)}</span>
				<span>{formatMs(durationMs)}</span>
			</div>
			<div className="relative h-2 rounded-full bg-white/20">
				<div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${Math.min(100, bufferedPercent)}%` }} />
				<div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, progressPercent)}%`, backgroundColor: accent }} />
				<input
					type="range"
					min={0}
					max={Math.max(durationMs, 1)}
					value={Math.min(currentMs, durationMs)}
					onChange={(event) => onSeek(Number(event.target.value))}
					className="absolute inset-0 h-2 w-full cursor-pointer opacity-0"
				/>
			</div>
		</div>
	);
}
