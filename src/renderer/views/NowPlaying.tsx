import { motion } from "framer-motion";
import type { AmazonCommand, PlayerStateDto } from "@shared/types";
import { AlbumArt } from "@renderer/components/AlbumArt";
import { DeviceSwitcher } from "@renderer/components/DeviceSwitcher";
import { LyricsPanel } from "@renderer/components/LyricsPanel";
import { ProgressBar } from "@renderer/components/ProgressBar";
import { QualityBadge } from "@renderer/components/QualityBadge";
import { useLyricSync } from "@renderer/hooks/useLyricSync";

/**
 * Renders the complete now playing experience and all playback controls.
 */
export function NowPlaying(props: {
	state: PlayerStateDto;
	accent: string;
	onCommand: (command: AmazonCommand) => void;
}): JSX.Element {
	const { state, accent, onCommand } = props;
	const currentLine = useLyricSync(state.lyrics, state.playback.currentTimeMs);
	const trackTitle = state.track?.title ?? "Nothing Playing";
	const trackArtist = state.track?.artist ?? "Open Amazon Music to begin";
	const trackAlbum = state.track?.album ?? "Album unavailable";
	const mockDevices = [
		{ id: "default", displayName: state.device.displayName ?? "Default Device" },
		{ id: "system", displayName: "System Default" },
	];

	return (
		<div className="grid h-full min-h-0 grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
			<div className="glass-panel min-w-0 p-5 xl:p-6">
				<div className="grid min-w-0 grid-cols-1 gap-6 2xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
					<div className="flex justify-center">
						<AlbumArt artUrl={state.track?.artUrl ?? null} accent={accent} title={trackTitle} />
					</div>
					<div className="min-w-0 space-y-4">
						<motion.div layout className="space-y-2">
							<div className="break-words text-3xl font-bold leading-tight text-white xl:text-4xl">{trackTitle}</div>
							<div className="break-words text-lg text-white/75">{trackArtist}</div>
							<div className="text-sm uppercase tracking-[0.2em] text-white/50">{trackAlbum}</div>
						</motion.div>
						<QualityBadge audio={state.audio} />
						<div className="flex gap-2">
							<button onClick={() => onCommand({ type: "player.rate", direction: "UP" })} className="control-btn">
								👍
							</button>
							<button onClick={() => onCommand({ type: "player.rate", direction: "DOWN" })} className="control-btn">
								👎
							</button>
						</div>
						<ProgressBar
							currentMs={state.playback.currentTimeMs}
							durationMs={state.playback.durationMs}
							bufferedMs={state.playback.bufferedMs}
							accent={accent}
							onSeek={(positionMs) => onCommand({ type: "player.seek", positionMs })}
						/>
						<div className="flex flex-wrap gap-2">
							<button className="control-btn" onClick={() => onCommand({ type: "player.previous" })}>
								Previous
							</button>
							<button className="control-btn" onClick={() => onCommand({ type: state.playback.isPlaying ? "player.pause" : "player.play" })}>
								{state.playback.isPlaying ? "Pause" : "Play"}
							</button>
							<button className="control-btn" onClick={() => onCommand({ type: "player.next" })}>
								Next
							</button>
							<button
								className="control-btn"
								onClick={() => onCommand({ type: "player.setShuffle", enabled: !state.playback.shuffle })}
							>
								Shuffle {state.playback.shuffle ? "On" : "Off"}
							</button>
							<button className="control-btn" onClick={() => onCommand({ type: "player.toggleRepeat" })}>
								Repeat {state.playback.repeat}
							</button>
						</div>
						<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
							<label className="control-input">
								<span>Volume</span>
								<input
									type="range"
									min={0}
									max={1}
									step={0.01}
									value={state.playback.volume}
									onChange={(event) => onCommand({ type: "player.setVolume", volume: Number(event.target.value) })}
								/>
							</label>
							<label className="control-input">
								<span>Tempo</span>
								<input
									type="range"
									min={0.5}
									max={2}
									step={0.05}
									value={state.playback.tempo}
									onChange={(event) => onCommand({ type: "player.setTempo", tempo: Number(event.target.value) })}
								/>
							</label>
						</div>
						<div className="flex items-center gap-3">
							<DeviceSwitcher
								activeDeviceId={state.device.id}
								devices={mockDevices}
								onChange={(deviceId) => onCommand({ type: "player.setOutputDevice", deviceId })}
							/>
							<button className="control-btn" onClick={() => onCommand({ type: "player.toggleMute" })}>
								{state.playback.muted ? "Unmute" : "Mute"}
							</button>
							<button className="control-btn" onClick={() => onCommand({ type: "player.toggleLoudnessNormalization" })}>
								Loudness
							</button>
						</div>
						<div className="rounded-xl border border-white/20 bg-white/5 p-3">
							<div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/65">Queue Peek</div>
							<div className="space-y-1 text-sm">
								{state.nextUp.slice(0, 3).map((next) => (
									<div key={next.id} className="text-white/80">
										{next.title} - {next.artist}
									</div>
								))}
								{state.nextUp.length === 0 ? <div className="text-white/60">No upcoming tracks</div> : null}
							</div>
						</div>
					</div>
				</div>
			</div>
			<div className="min-h-0">
				<LyricsPanel lines={state.lyrics} activeIndex={currentLine} />
			</div>
		</div>
	);
}
