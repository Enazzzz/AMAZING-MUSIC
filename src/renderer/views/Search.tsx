import { useState } from "react";
import type { SearchResultsDto } from "@shared/types";

/**
 * Provides search input and displays track/album/artist result cards.
 */
export function SearchView(props: {
	results: SearchResultsDto;
	onSearch: (query: string) => void;
}): JSX.Element {
	const { results, onSearch } = props;
	const [query, setQuery] = useState(results.query);
	return (
		<div className="glass-panel p-5">
			<div className="mb-4 text-2xl font-semibold text-white">Search</div>
			<div className="mb-4 flex gap-2">
				<input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search tracks, albums, artists"
					className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white outline-none"
				/>
				<button className="control-btn" onClick={() => onSearch(query)}>
					Search
				</button>
			</div>
			<div className="grid grid-cols-2 gap-3">
				{results.items.map((item) => (
					<div key={`${item.type}-${item.id}`} className="rounded-lg border border-white/20 bg-white/10 px-3 py-2">
						<div className="text-xs uppercase tracking-[0.16em] text-white/60">{item.type}</div>
						<div className="text-sm font-semibold text-white">{item.title}</div>
						<div className="text-xs text-white/70">{item.subtitle}</div>
					</div>
				))}
			</div>
		</div>
	);
}
