import { describe, expect, it } from "vitest";
import { buildDispatchExpression, mapCommandToDispatch } from "../src/main/cdp/amazonBridge";

describe("mapCommandToDispatch", () => {
	it("maps transport commands to expected Vuex actions", () => {
		expect(mapCommandToDispatch({ type: "play" })).toEqual({
			action: "player/play",
		});
		expect(mapCommandToDispatch({ type: "pause" })).toEqual({
			action: "player/pause",
		});
		expect(mapCommandToDispatch({ type: "next" })).toEqual({
			action: "player/next",
		});
	});

	it("maps seek and volume commands with payload", () => {
		expect(mapCommandToDispatch({ type: "seek", positionMs: 15000 })).toEqual({
			action: "player/seekTo",
			payload: { position: 15000 },
		});
		expect(mapCommandToDispatch({ type: "setVolume", volume: 0.6 })).toEqual({
			action: "player/setVolume",
			payload: { volume: 0.6 },
		});
	});
});

describe("buildDispatchExpression", () => {
	it("builds a JSON-safe expression for payload dispatch", () => {
		const expression = buildDispatchExpression("player/setVolume", { volume: 0.5 });
		expect(expression).toContain("window.App.$store.dispatch");
		expect(expression).toContain("'player/setVolume'");
		expect(expression).toContain("\"volume\":0.5");
	});
});
