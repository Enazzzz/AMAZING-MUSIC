import { useEffect, useRef } from "react";
import type { LyricLine } from "@shared/types";

/**
 * Displays synced lyrics with auto-scroll toward the active line.
 */
export function LyricsPanel(props: { lines: LyricLine[]; activeIndex: number }): JSX.Element {
	const { lines, activeIndex } = props;
	const activeLineRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!activeLineRef.current) {
			return;
		}
		activeLineRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
	}, [activeIndex]);

	return (
		<div className="glass-panel h-[320px] overflow-y-auto p-4">
			<div className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-white/70">Lyrics</div>
			{lines.length === 0 ? (
				<div className="pt-6 text-sm text-white/60">Lyrics unavailable for this track.</div>
			) : (
				<div className="space-y-2">
					{lines.map((line, index) => {
						const isActive = index === activeIndex;
						return (
							<div
								key={`${line.startTime}-${index}`}
								ref={isActive ? activeLineRef : null}
								className={isActive ? "text-base font-semibold text-white" : "text-sm text-white/65"}
							>
								{line.text}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
