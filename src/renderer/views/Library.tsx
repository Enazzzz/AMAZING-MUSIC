import type { PlaylistSummary } from "@shared/types";

/**
 * Displays playlist, album, and artist sections from discovered library data.
 */
export function Library(props: { playlists: PlaylistSummary[]; onPlayPlaylist: (playlistId: string) => void }): JSX.Element {
	const { playlists, onPlayPlaylist } = props;

	return (
		<div className="glass-panel p-5">
			<div className="mb-4 text-2xl font-semibold text-white">Library</div>
			<div className="mb-5 text-sm text-white/70">
				Playlists, albums, and artists are sourced via discovered `Library.*` bridge calls.
			</div>
			<div className="grid grid-cols-3 gap-4">
				{playlists.map((playlist) => (
					<button
						key={playlist.id}
						onClick={() => onPlayPlaylist(playlist.id)}
						className="rounded-xl border border-white/20 bg-white/10 p-3 text-left"
					>
						<div className="mb-2 h-32 overflow-hidden rounded-lg bg-white/10">
							{playlist.imageUrl ? <img src={playlist.imageUrl} className="h-full w-full object-cover" alt={playlist.name} /> : null}
						</div>
						<div className="truncate text-sm font-semibold text-white">{playlist.name}</div>
						<div className="text-xs text-white/65">{playlist.trackCount} tracks</div>
					</button>
				))}
				{playlists.length === 0 ? <div className="text-sm text-white/60">No playlists loaded yet.</div> : null}
			</div>
		</div>
	);
}
