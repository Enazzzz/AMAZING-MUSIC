import { create } from "zustand";
import type {
	MorphoConfig,
	PlayerStateDto,
	SearchResultsDto,
	PlaylistSummary,
	QueueTrack,
} from "@shared/types";
import { EMPTY_PLAYER_STATE } from "@shared/types";

/**
 * Defines app-level view routing options used by the shell sidebar.
 */
export type MorphoView = "now-playing" | "library" | "queue" | "search" | "settings" | "group-listening";

/**
 * Defines full renderer store state and action contracts.
 */
interface PlayerStoreState {
	activeView: MorphoView;
	playerState: PlayerStateDto;
	playlists: PlaylistSummary[];
	queueTracks: QueueTrack[];
	searchResults: SearchResultsDto;
	config: MorphoConfig | null;
	diagnostics: string[];
	setActiveView: (view: MorphoView) => void;
	setPlayerState: (state: PlayerStateDto) => void;
	setSearchResults: (results: SearchResultsDto) => void;
	setConfig: (config: MorphoConfig) => void;
	setQueueTracks: (tracks: QueueTrack[]) => void;
	setPlaylists: (playlists: PlaylistSummary[]) => void;
	pushDiagnostic: (message: string) => void;
}

/**
 * Central Zustand store for all renderer state slices.
 */
export const usePlayerStore = create<PlayerStoreState>((set) => ({
	activeView: "now-playing",
	playerState: EMPTY_PLAYER_STATE,
	playlists: [],
	queueTracks: [],
	searchResults: {
		query: "",
		items: [],
	},
	config: null,
	diagnostics: [],
	setActiveView: (view) => set({ activeView: view }),
	setPlayerState: (state) =>
		set({
			playerState: state,
			queueTracks: state.nextUp,
		}),
	setSearchResults: (results) => set({ searchResults: results }),
	setConfig: (config) => set({ config }),
	setQueueTracks: (tracks) => set({ queueTracks: tracks }),
	setPlaylists: (playlists) => set({ playlists }),
	pushDiagnostic: (message) =>
		set((state) => ({
			diagnostics: [message, ...state.diagnostics].slice(0, 30),
		})),
}));
