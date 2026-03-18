import { useEffect } from "react";
import type { AmazonCommand, MorphoConfig } from "@shared/types";
import { DynamicBackground } from "@renderer/components/DynamicBackground";
import { GroupListening } from "@renderer/components/GroupListening";
import { Sidebar } from "@renderer/components/Sidebar";
import { useDominantColor } from "@renderer/hooks/useDominantColor";
import { usePlayerState } from "@renderer/hooks/usePlayerState";
import { usePlayerStore } from "@renderer/store/playerStore";
import { Library } from "@renderer/views/Library";
import { NowPlaying } from "@renderer/views/NowPlaying";
import { QueueView } from "@renderer/views/Queue";
import { SearchView } from "@renderer/views/Search";
import { SettingsView } from "@renderer/views/Settings";

/**
 * Hosts top-level Morpho layout, view routing, and command dispatching.
 */
export function App(): JSX.Element {
	usePlayerState();
	const activeView = usePlayerStore((state) => state.activeView);
	const setActiveView = usePlayerStore((state) => state.setActiveView);
	const playerState = usePlayerStore((state) => state.playerState);
	const diagnostics = usePlayerStore((state) => state.diagnostics);
	const playlists = usePlayerStore((state) => state.playlists);
	const queueTracks = usePlayerStore((state) => state.queueTracks);
	const searchResults = usePlayerStore((state) => state.searchResults);
	const setSearchResults = usePlayerStore((state) => state.setSearchResults);
	const config = usePlayerStore((state) => state.config);
	const setConfig = usePlayerStore((state) => state.setConfig);
	const { rgb, rgbaSoft } = useDominantColor(playerState.track?.artUrl ?? null);

	/**
	 * Sends typed commands from renderer controls to main process bridge.
	 */
	const sendCommand = (command: AmazonCommand): void => {
		void window.morpho.sendCommand(command);
	};

	/**
	 * Applies settings patch to main process config and local store.
	 */
	const patchConfig = (patch: Partial<MorphoConfig>): void => {
		void window.morpho.setConfig(patch).then((nextConfig) => {
			setConfig(nextConfig);
		});
	};

	/**
	 * Loads initial persisted configuration snapshot once on first render.
	 */
	useEffect(() => {
		void window.morpho.getConfig().then((loaded) => setConfig(loaded));
	}, [setConfig]);

	/**
	 * Requests search results and stores response.
	 * For now this is purely in-memory so the Search tab cannot block the UI.
	 */
	const search = (query: string): void => {
		const trimmed = query.trim();
		if (!trimmed) {
			setSearchResults({ query: "", items: [] });
			return;
		}
		setSearchResults({
			query: trimmed,
			items: [
				{
					id: "local-" + trimmed,
					type: "track",
					title: `Sample result for "${trimmed}"`,
					subtitle: "Search is wired locally; CDP search is disabled for now.",
					imageUrl: null,
				},
			],
		});
	};

	return (
		<div className="relative h-screen overflow-hidden bg-[#070b13] text-white">
			<DynamicBackground artUrl={playerState.track?.artUrl ?? null} accent={rgb} />
			<div className="relative z-10 flex h-full gap-4 p-4">
				<Sidebar
					activeView={activeView}
					onViewChange={setActiveView}
					miniTitle={playerState.track?.title ?? "No track"}
					miniArtist={playerState.track?.artist ?? "Disconnected"}
					miniArt={playerState.track?.artUrl ?? null}
					isPlaying={playerState.playback.isPlaying}
					onTogglePlay={() => sendCommand({ type: playerState.playback.isPlaying ? "player.pause" : "player.play" })}
				/>
				<main className="glass-panel relative min-w-0 flex-1 overflow-auto p-4" style={{ borderColor: rgbaSoft }}>
					{activeView === "now-playing" ? <NowPlaying state={playerState} accent={rgb} onCommand={sendCommand} /> : null}
					{activeView === "library" ? (
						<Library playlists={playlists} onPlayPlaylist={(playlistId) => sendCommand({ type: "library.playPlaylist", playlistId })} />
					) : null}
					{activeView === "queue" ? (
						<QueueView
							tracks={queueTracks}
							onRemove={(id) => sendCommand({ type: "queue.remove", ids: [id] })}
							onMoveUp={(track, index) => {
								if (index === 0) {
									return;
								}
								sendCommand({ type: "queue.reorder", id: track.id, targetIndex: index - 1 });
							}}
						/>
					) : null}
					{activeView === "search" ? <SearchView results={searchResults} onSearch={search} /> : null}
					{activeView === "settings" ? <SettingsView config={config} onConfigPatch={patchConfig} /> : null}
					{activeView === "group-listening" ? <GroupListening /> : null}
				</main>
			</div>
			{diagnostics.length > 0 ? (
				<div className="absolute bottom-3 right-3 z-20 w-[420px] rounded-xl border border-white/20 bg-black/35 p-3 text-xs text-white/80">
					<div className="mb-2 font-semibold">Diagnostics</div>
					<div className="max-h-[120px] space-y-1 overflow-y-auto">
						{diagnostics.map((message) => (
							<div key={message}>{message}</div>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
