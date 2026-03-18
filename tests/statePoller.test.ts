import { describe, expect, it } from "vitest";
import { StatePoller } from "../src/main/cdp/statePoller";
import type { PlayerStateDto } from "../src/shared/types";
import { EMPTY_PLAYER_STATE } from "../src/shared/types";

/**
 * Clones a player state and applies overrides for concise test setup.
 */
function makeState(overrides: Partial<PlayerStateDto>): PlayerStateDto {
	return {
		...EMPTY_PLAYER_STATE,
		...overrides,
	};
}

describe("StatePoller", () => {
	it("emits only when state changes", async () => {
		let index = 0;
		const states: Array<PlayerStateDto | null> = [
			makeState({}),
			makeState({}),
			makeState({ playback: { ...EMPTY_PLAYER_STATE.playback, currentTimeMs: 1000 } }),
		];
		const emitted: PlayerStateDto[] = [];
		const poller = new StatePoller(async () => states[index++] ?? null, (state) => emitted.push(state), 5);

		poller.start();
		await new Promise<void>((resolve) => setTimeout(resolve, 30));
		poller.stop();

		expect(emitted.length).toBe(1);
		expect(emitted[0].playback.currentTimeMs).toBe(1000);
	});
});
