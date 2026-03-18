import { describe, expect, it } from "vitest";
import { buildBridgeExecuteExpression, buildHighResArtExpression, mapCommandToBridge } from "../src/main/cdp/amazonBridge";

describe("amazonBridge helpers", () => {
	it("maps thumbs-up rating command to player rateEntity", () => {
		const mapped = mapCommandToBridge({ type: "player.rate", direction: "UP" });
		expect(mapped.method).toBe("rateEntity");
		expect(mapped.args).toEqual([1]);
	});

	it("builds bridge execute expression for explicit native command", () => {
		const expression = buildBridgeExecuteExpression("Library.getPlaylists", []);
		expect(expression).toContain("Library.getPlaylists");
		expect(expression).toContain("bridge.execute");
	});

	it("builds art upscaling expression", () => {
		const expression = buildHighResArtExpression("https://example.com/art._SX400_.jpg");
		expect(expression).toContain("SX1200");
	});
});
