import { describe, expect, it } from "vitest";
import { createCdpMessage, extractCdpError, parseEvaluateValue } from "../src/main/cdp/cdpClient";

describe("createCdpMessage", () => {
	it("builds Runtime.evaluate payload with returnByValue", () => {
		const message = createCdpMessage(7, "1 + 1");
		expect(message).toEqual({
			id: 7,
			method: "Runtime.evaluate",
			params: {
				expression: "1 + 1",
				returnByValue: true,
			},
		});
	});
});

describe("parseEvaluateValue", () => {
	it("returns nested CDP result value", () => {
		const value = parseEvaluateValue({
			id: 1,
			result: {
				result: {
					type: "string",
					value: "PLAYING",
				},
			},
		});
		expect(value).toBe("PLAYING");
	});

	it("returns null when value path is missing", () => {
		const value = parseEvaluateValue({
			id: 1,
			result: {},
		});
		expect(value).toBeNull();
	});
});

describe("extractCdpError", () => {
	it("returns null when no protocol error exists", () => {
		const error = extractCdpError({
			id: 1,
			result: {
				result: {
					type: "string",
					value: "ok",
				},
			},
		});
		expect(error).toBeNull();
	});

	it("returns message when protocol error exists", () => {
		const error = extractCdpError({
			id: 2,
			error: {
				message: "Execution context was destroyed.",
			},
		});
		expect(error).toBe("Execution context was destroyed.");
	});
});
