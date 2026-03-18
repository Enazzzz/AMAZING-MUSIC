import { useEffect, useMemo, useState } from "react";
import { FastAverageColor } from "fast-average-color";

/**
 * Stores dynamic accent colors extracted from the current album artwork.
 */
interface DominantColorState {
	rgb: string;
	rgbaSoft: string;
}

const DEFAULT_COLOR: DominantColorState = {
	rgb: "rgb(91, 170, 255)",
	rgbaSoft: "rgba(91, 170, 255, 0.28)",
};

/**
 * Extracts dominant artwork color and returns CSS-safe accent variants.
 */
export function useDominantColor(imageUrl: string | null): DominantColorState {
	const [color, setColor] = useState<DominantColorState>(DEFAULT_COLOR);
	const fac = useMemo(() => new FastAverageColor(), []);

	useEffect(() => {
		return () => {
			fac.destroy();
		};
	}, [fac]);

	useEffect(() => {
		if (!imageUrl) {
			setColor(DEFAULT_COLOR);
			return;
		}
		let cancelled = false;
		const image = new Image();
		image.crossOrigin = "anonymous";
		image.src = imageUrl;
		image.onload = async () => {
			try {
				const result = await fac.getColorAsync(image);
				if (cancelled) {
					return;
				}
				setColor({
					rgb: `rgb(${result.value[0]}, ${result.value[1]}, ${result.value[2]})`,
					rgbaSoft: `rgba(${result.value[0]}, ${result.value[1]}, ${result.value[2]}, 0.28)`,
				});
			} catch (_error) {
				if (!cancelled) {
					setColor(DEFAULT_COLOR);
				}
			}
		};
		image.onerror = () => {
			if (!cancelled) {
				setColor(DEFAULT_COLOR);
			}
		};
		return () => {
			cancelled = true;
		};
	}, [fac, imageUrl]);

	return color;
}
