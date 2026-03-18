import { useMemo } from "react";
import type { LyricLine } from "@shared/types";

/**
 * Returns the current lyric line index based on playback position.
 */
export function useLyricSync(lines: LyricLine[], currentTimeMs: number): number {
	return useMemo(() => {
		if (!lines.length) {
			return -1;
		}
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			if (currentTimeMs >= line.startTime && currentTimeMs <= line.endTime) {
				return index;
			}
		}
		return -1;
	}, [currentTimeMs, lines]);
}
