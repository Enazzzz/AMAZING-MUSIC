import { useEffect } from "react";
import { usePlayerStore } from "@renderer/store/playerStore";

/**
 * Hydrates and streams live player state from preload bridge into Zustand.
 */
export function usePlayerState(): void {
	const setPlayerState = usePlayerStore((state) => state.setPlayerState);
	const pushDiagnostic = usePlayerStore((state) => state.pushDiagnostic);

	useEffect(() => {
		let disposed = false;
		void window.morpho
			.getState()
			.then((state) => {
				if (!disposed) {
					setPlayerState(state);
				}
			})
			.catch((error) => {
				pushDiagnostic(`Initial state hydrate failed: ${String(error)}`);
			});

		const unbindState = window.morpho.onStateUpdate((state) => {
			setPlayerState(state);
		});

		const unbindDiagnostic = window.morpho.onDiagnostic((event) => {
			pushDiagnostic(`${event.type.toUpperCase()}: ${event.message}`);
		});

		return () => {
			disposed = true;
			unbindState();
			unbindDiagnostic();
		};
	}, [pushDiagnostic, setPlayerState]);
}
