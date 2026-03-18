import type { MorphoView } from "@renderer/store/playerStore";

/**
 * Defines each left-sidebar route button and its display label.
 */
const NAV_ITEMS: Array<{ id: MorphoView; label: string }> = [
	{ id: "now-playing", label: "Now Playing" },
	{ id: "library", label: "Library" },
	{ id: "search", label: "Search" },
	{ id: "queue", label: "Queue" },
	{ id: "settings", label: "Settings" },
	{ id: "group-listening", label: "Group Listening" },
];

/**
 * Renders the Morpho sidebar, navigation, and mini-player summary.
 */
export function Sidebar(props: {
	activeView: MorphoView;
	onViewChange: (view: MorphoView) => void;
	miniTitle: string;
	miniArtist: string;
	miniArt: string | null;
	isPlaying: boolean;
	onTogglePlay: () => void;
}): JSX.Element {
	const { activeView, onViewChange, miniTitle, miniArtist, miniArt, isPlaying, onTogglePlay } = props;

	return (
		<aside className="glass-panel flex h-full w-[240px] flex-shrink-0 flex-col p-4">
			<div className="mb-6">
				<div className="text-xs uppercase tracking-[0.24em] text-white/60">Morpho</div>
				<div className="text-2xl font-semibold text-white">Amazon Shell</div>
			</div>
			<nav className="space-y-1">
				{NAV_ITEMS.map((item) => (
					<button
						key={item.id}
						onClick={() => onViewChange(item.id)}
						className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
							activeView === item.id ? "bg-white/20 text-white" : "bg-transparent text-white/75 hover:bg-white/10"
						}`}
					>
						{item.label}
					</button>
				))}
			</nav>
			<div className="mt-auto rounded-xl border border-white/20 bg-white/10 p-3">
				<div className="mb-2 text-xs uppercase tracking-[0.16em] text-white/60">Mini Player</div>
				<div className="flex items-center gap-3">
					<div className="h-12 w-12 overflow-hidden rounded-lg bg-white/10">
						{miniArt ? <img src={miniArt} alt={miniTitle} className="h-full w-full object-cover" /> : null}
					</div>
					<div className="min-w-0">
						<div className="truncate text-sm font-semibold text-white">{miniTitle}</div>
						<div className="truncate text-xs text-white/70">{miniArtist}</div>
					</div>
					<button onClick={onTogglePlay} className="rounded-full border border-white/25 px-3 py-1 text-xs">
						{isPlaying ? "Pause" : "Play"}
					</button>
				</div>
			</div>
		</aside>
	);
}
