/**
 * Strongly typed command payloads for renderer-to-main IPC.
 */
export type AmazonCommand =
	| { type: "play" }
	| { type: "pause" }
	| { type: "next" }
	| { type: "previous" }
	| { type: "toggleMute" }
	| { type: "toggleShuffle" }
	| { type: "seek"; positionMs: number }
	| { type: "setVolume"; volume: number }
	| { type: "setRepeat"; repeatSetting: "NONE" | "ALL" | "ONE" };

/**
 * Stable DTO used by renderer to drive the custom UI.
 */
export interface PlayerStateDto {
	title: string | null;
	artist: string | null;
	album: string | null;
	art: string | null;
	asin: string | null;
	trackId: string | null;
	duration: number;
	currentTime: number;
	isPlaying: boolean;
	shuffle: boolean;
	repeat: "NONE" | "ALL" | "ONE";
	volume: number;
	muted: boolean;
	quality: string | null;
	bitrate: number | null;
	bitDepth: number | null;
	sampleRate: number | null;
	device: string | null;
	playlistName: string | null;
	playlistId: string | null;
	playlistType: string | null;
	nextTitle: string | null;
	nextArtist: string | null;
	nextArt: string | null;
	lyrics: {
		lines: Array<{ startTime: number; endTime: number; text: string }>;
	} | null;
}

/**
 * Search response shape read from Amazon's Vuex search module.
 */
export interface SearchResultsDto {
	query: string;
	tracks: Array<{ id: string; title: string; subtitle?: string }>;
	albums: Array<{ id: string; title: string; subtitle?: string }>;
	playlists: Array<{ id: string; title: string; subtitle?: string }>;
}

/**
 * Safe fallback used before any real state is available.
 */
export const EMPTY_PLAYER_STATE: PlayerStateDto = {
	title: null,
	artist: null,
	album: null,
	art: null,
	asin: null,
	trackId: null,
	duration: 0,
	currentTime: 0,
	isPlaying: false,
	shuffle: false,
	repeat: "NONE",
	volume: 1,
	muted: false,
	quality: null,
	bitrate: null,
	bitDepth: null,
	sampleRate: null,
	device: null,
	playlistName: null,
	playlistId: null,
	playlistType: null,
	nextTitle: null,
	nextArtist: null,
	nextArt: null,
	lyrics: null,
};
