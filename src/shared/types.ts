/**
 * Describes Amazon playback repeat settings.
 */
export type RepeatSetting = "NONE" | "ALL" | "ONE";

/**
 * Describes a compact queue entry used in UI lists.
 */
export interface QueueTrack {
	id: string;
	title: string;
	artist: string;
	art: string | null;
	durationMs: number;
}

/**
 * Describes a parsed lyric line with millisecond timing.
 */
export interface LyricLine {
	startTime: number;
	endTime: number;
	text: string;
}

/**
 * Represents core track metadata surfaced from Amazon state.
 */
export interface TrackInfo {
	id: string;
	asin: string;
	title: string;
	artist: string;
	album: string;
	artUrl: string | null;
}

/**
 * Captures live playback telemetry for visual and control surfaces.
 */
export interface PlaybackTelemetry {
	isPlaying: boolean;
	currentTimeMs: number;
	durationMs: number;
	bufferedMs: number;
	shuffle: boolean;
	repeat: RepeatSetting;
	volume: number;
	muted: boolean;
	tempo: number;
}

/**
 * Stores the currently selected output device summary.
 */
export interface DeviceInfo {
	id: string | null;
	displayName: string | null;
}

/**
 * Stores quality and stream properties displayed in Now Playing.
 */
export interface AudioQualityInfo {
	quality: "STANDARD" | "HD" | "ULTRA_HD" | "UNKNOWN";
	bitrate: number | null;
	bitDepth: number | null;
	sampleRate: number | null;
}

/**
 * Represents all data needed for the default Now Playing view.
 */
export interface PlayerStateDto {
	track: TrackInfo | null;
	playback: PlaybackTelemetry;
	audio: AudioQualityInfo;
	device: DeviceInfo;
	nextUp: QueueTrack[];
	lyrics: LyricLine[];
	rating: "UP" | "DOWN" | "NONE";
	playlistContext: {
		id: string | null;
		name: string | null;
		type: string | null;
	};
}

/**
 * Represents a library playlist entry used by the Library view.
 */
export interface PlaylistSummary {
	id: string;
	name: string;
	imageUrl: string | null;
	trackCount: number;
}

/**
 * Represents a search result row for tracks, albums, or artists.
 */
export interface SearchResultItem {
	id: string;
	type: "track" | "album" | "artist" | "playlist";
	title: string;
	subtitle: string;
	imageUrl: string | null;
}

/**
 * Represents search result sets grouped by category.
 */
export interface SearchResultsDto {
	query: string;
	items: SearchResultItem[];
}

/**
 * Represents supported playback and library commands from renderer.
 */
export type AmazonCommand =
	| { type: "player.play" }
	| { type: "player.pause" }
	| { type: "player.next" }
	| { type: "player.previous" }
	| { type: "player.seek"; positionMs: number }
	| { type: "player.setVolume"; volume: number }
	| { type: "player.toggleMute" }
	| { type: "player.setShuffle"; enabled: boolean }
	| { type: "player.toggleRepeat" }
	| { type: "player.setTempo"; tempo: number }
	| { type: "player.setAudioQuality"; quality: "STANDARD" | "HD" | "ULTRA_HD" }
	| { type: "player.setOutputDevice"; deviceId: string }
	| { type: "player.setExclusiveMode"; enabled: boolean }
	| { type: "player.toggleLoudnessNormalization" }
	| { type: "player.rate"; direction: "UP" | "DOWN" }
	| { type: "queue.remove"; ids: string[] }
	| { type: "queue.reorder"; id: string; targetIndex: number }
	| { type: "queue.appendTrack"; asin: string }
	| { type: "library.playPlaylist"; playlistId: string }
	| { type: "library.addCurrentTrackToPlaylist"; playlistId: string };

/**
 * Represents configuration persisted across desktop sessions.
 */
export interface MorphoConfig {
	amazonExePath: string;
	debugPort: number;
	pollMs: number;
	hideAmazonWindow: boolean;
	autostartWithWindows: boolean;
	audioQuality: "STANDARD" | "HD" | "ULTRA_HD";
	groupListening: {
		enabled: boolean;
		host: string;
		port: number;
	};
}

/**
 * Represents runtime bridge events forwarded to the renderer.
 */
export interface MorphoDiagnosticsEvent {
	type: "info" | "warn" | "error";
	message: string;
}

/**
 * Provides a stable fallback playback snapshot before first poll tick.
 */
export const EMPTY_PLAYER_STATE: PlayerStateDto = {
	track: null,
	playback: {
		isPlaying: false,
		currentTimeMs: 0,
		durationMs: 0,
		bufferedMs: 0,
		shuffle: false,
		repeat: "NONE",
		volume: 1,
		muted: false,
		tempo: 1,
	},
	audio: {
		quality: "UNKNOWN",
		bitrate: null,
		bitDepth: null,
		sampleRate: null,
	},
	device: {
		id: null,
		displayName: null,
	},
	nextUp: [],
	lyrics: [],
	rating: "NONE",
	playlistContext: {
		id: null,
		name: null,
		type: null,
	},
};
