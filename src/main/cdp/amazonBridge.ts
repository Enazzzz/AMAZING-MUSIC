import type { AmazonCommand, SearchResultsDto } from "../../shared/types";

/**
 * Maps high-level UI commands to concrete Amazon Vuex dispatch calls.
 */
export function mapCommandToDispatch(command: AmazonCommand): { action: string; payload?: Record<string, unknown> } {
	switch (command.type) {
		case "play":
			return { action: "player/play" };
		case "pause":
			return { action: "player/pause" };
		case "next":
			return { action: "player/next" };
		case "previous":
			return { action: "player/previous" };
		case "toggleMute":
			return { action: "player/toggleMute" };
		case "toggleShuffle":
			return { action: "player/toggleShuffle" };
		case "seek":
			return { action: "player/seekTo", payload: { position: command.positionMs } };
		case "setVolume":
			return { action: "player/setVolume", payload: { volume: command.volume } };
		case "setRepeat":
			return { action: "player/setRepeat", payload: { repeatSetting: command.repeatSetting } };
		default: {
			const exhaustiveCheck: never = command;
			return exhaustiveCheck;
		}
	}
}

/**
 * Escapes single quotes so action names are safe in JS expression strings.
 */
function escapeSingleQuotes(value: string): string {
	return value.replace(/'/g, "\\'");
}

/**
 * Builds a Runtime.evaluate expression for dispatching Vuex actions.
 */
export function buildDispatchExpression(action: string, payload?: Record<string, unknown>): string {
	const safeAction = escapeSingleQuotes(action);
	if (!payload) {
		return `window.App.$store.dispatch('${safeAction}')`;
	}
	const payloadText = JSON.stringify(payload);
	return `window.App.$store.dispatch('${safeAction}', ${payloadText})`;
}

/**
 * Builds a Runtime.evaluate expression for Vue router navigation.
 */
export function buildNavigateExpression(path: string): string {
	const safePath = escapeSingleQuotes(path);
	return `window.App.$router.push('${safePath}')`;
}

/**
 * Returns a robust state extraction snippet compatible with old CEF JS engines.
 */
export function buildStateExpression(): string {
	return `
(function() {
	try {
		var s = window.App.$store.state;
		var p = s.player;
		if (!p || !p.model || !p.model.currentPlayable) return null;
		return JSON.stringify({
			title: p.model.currentPlayable.track.title || null,
			artist: p.model.currentPlayable.track.artist && p.model.currentPlayable.track.artist.name || null,
			album: p.model.currentPlayable.track.album && p.model.currentPlayable.track.album.name || null,
			art: p.model.currentPlayable.track.album && p.model.currentPlayable.track.album.image || null,
			asin: p.model.currentPlayable.track.asin || null,
			trackId: p.model.currentPlayable.track.trackUniqueId || null,
			duration: p.model.duration || 0,
			currentTime: p.progress && p.progress.currentTime || 0,
			isPlaying: p.model.state === 'PLAYING',
			shuffle: !!(p.settings && p.settings.shuffle),
			repeat: p.settings && p.settings.repeatSettings || 'NONE',
			volume: p.settings && p.settings.volume != null ? p.settings.volume : 1,
			muted: !!(p.settings && p.settings.muted),
			quality: p.settings && p.settings.audioQualitySetting || null,
			bitrate: p.model.audioAttributes && p.model.audioAttributes.bitrate || null,
			bitDepth: p.model.audioAttributes && p.model.audioAttributes.bitDepth || null,
			sampleRate: p.model.audioAttributes && p.model.audioAttributes.sampleRate || null,
			device: p.model.outputDeviceAttributes &&
				p.model.outputDeviceAttributes.currentDevice &&
				p.model.outputDeviceAttributes.currentDevice.displayName || null,
			playlistName: p.model.currentPlayable.containerInfo && p.model.currentPlayable.containerInfo.containerName || null,
			playlistId: p.model.currentPlayable.containerInfo && p.model.currentPlayable.containerInfo.id || null,
			playlistType: p.model.currentPlayable.containerInfo && p.model.currentPlayable.containerInfo.type || null,
			nextTitle: p.model.nextPlayable && p.model.nextPlayable.track && p.model.nextPlayable.track.title || null,
			nextArtist: p.model.nextPlayable && p.model.nextPlayable.track && p.model.nextPlayable.track.artist && p.model.nextPlayable.track.artist.name || null,
			nextArt: p.model.nextPlayable && p.model.nextPlayable.track && p.model.nextPlayable.track.album && p.model.nextPlayable.track.album.image || null,
			lyrics: p.model.currentPlayable.track.lyricsData || null
		});
	} catch (e) {
		return null;
	}
})()
`.trim();
}

/**
 * Builds a defensive expression that extracts search results from likely Vuex fields.
 */
export function buildSearchReadExpression(query: string): string {
	const safeQuery = escapeSingleQuotes(query);
	return `
(function() {
	try {
		var store = window.App.$store;
		var s = store.state.search || {};
		var instant = s.instantResults || s.results || {};
		function normalize(items) {
			if (!items || !items.length) return [];
			return items.slice(0, 50).map(function(item) {
				var id = item.id || item.asin || item.trackUniqueId || item.entityId || '';
				var title = item.title || item.name || '';
				var subtitle = item.subtitle || (item.artist && item.artist.name) || item.description || '';
				return { id: String(id), title: String(title), subtitle: subtitle ? String(subtitle) : undefined };
			});
		}
		return JSON.stringify({
			query: '${safeQuery}',
			tracks: normalize(instant.tracks || instant.songResults || []),
			albums: normalize(instant.albums || []),
			playlists: normalize(instant.playlists || [])
		});
	} catch (e) {
		return JSON.stringify({ query: '${safeQuery}', tracks: [], albums: [], playlists: [] });
	}
})()
`.trim();
}

/**
 * Tries commonly used action names for search queries.
 */
export function buildSearchDispatchExpression(query: string): string {
	const safeQuery = escapeSingleQuotes(query);
	return `
(function() {
	try {
		var store = window.App.$store;
		var candidates = ['search/setQuery', 'search/search', 'search/performSearch', 'search/updateSearchTerm'];
		for (var i = 0; i < candidates.length; i++) {
			var action = candidates[i];
			if (store._actions && store._actions[action]) {
				store.dispatch(action, { query: '${safeQuery}' });
				return action;
			}
		}
		return null;
	} catch (e) {
		return null;
	}
})()
`.trim();
}

/**
 * Parses JSON search payloads while preserving a safe empty fallback.
 */
export function parseSearchResults(raw: unknown, query: string): SearchResultsDto {
	if (typeof raw !== "string") {
		return { query, tracks: [], albums: [], playlists: [] };
	}
	try {
		const parsed = JSON.parse(raw) as SearchResultsDto;
		return {
			query: parsed.query || query,
			tracks: parsed.tracks || [],
			albums: parsed.albums || [],
			playlists: parsed.playlists || [],
		};
	} catch (_error) {
		return { query, tracks: [], albums: [], playlists: [] };
	}
}
