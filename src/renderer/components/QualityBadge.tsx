import type { AudioQualityInfo } from "@shared/types";

/**
 * Displays Amazon quality tier and audio telemetry values.
 */
export function QualityBadge(props: { audio: AudioQualityInfo }): JSX.Element {
	const { audio } = props;
	return (
		<div className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-white">
			<span>{audio.quality}</span>
			<span className="text-white/70">{audio.bitrate ? `${Math.round(audio.bitrate / 1000)} kbps` : "-- kbps"}</span>
			<span className="text-white/70">{audio.sampleRate ? `${audio.sampleRate / 1000} kHz` : "-- kHz"}</span>
			<span className="text-white/70">{audio.bitDepth ? `${audio.bitDepth} bit` : "-- bit"}</span>
		</div>
	);
}
