import http from "node:http";
import WebSocket from "ws";

const DEBUG_PORT = 9222;

type CdpTarget = {
	url?: string;
	webSocketDebuggerUrl?: string;
};

function log(...args: unknown[]): void {
	// eslint-disable-next-line no-console
	console.log("[dev-next]", ...args);
}

async function getMorphoTarget(): Promise<CdpTarget> {
	return new Promise<CdpTarget>((resolve, reject) => {
		http
			.get(`http://localhost:${DEBUG_PORT}/json`, (res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					try {
						const targets = JSON.parse(data) as CdpTarget[];
						const morpho = targets.find((t) => t.url && t.url.includes("amazon.com/morpho"));
						if (!morpho) {
							reject(new Error("No Morpho target found on /json"));
							return;
						}
						resolve(morpho);
					} catch (error) {
						reject(error);
					}
				});
			})
			.on("error", reject);
	});
}

async function sendCdp(ws: WebSocket, message: { id: number; method: string; params?: unknown }): Promise<unknown> {
	return new Promise<unknown>((resolve, reject) => {
		const handler = (raw: WebSocket.RawData): void => {
			try {
				const msg = JSON.parse(raw.toString()) as { id?: number; result?: unknown; error?: unknown };
				if (msg.id === message.id) {
					ws.off("message", handler);
					resolve(msg);
				}
			} catch {
				// ignore parse noise
			}
		};

		ws.on("message", handler);
		ws.send(JSON.stringify(message), (error) => {
			if (error) {
				ws.off("message", handler);
				reject(error);
			}
		});
	});
}

async function main(): Promise<void> {
	try {
		log("Discovering Morpho target on CDP /json...");
		const target = await getMorphoTarget();
		log("Using target:", target.url);
		log("WebSocket:", target.webSocketDebuggerUrl);

		if (!target.webSocketDebuggerUrl) {
			throw new Error("Target is missing webSocketDebuggerUrl.");
		}

		const ws = new WebSocket(target.webSocketDebuggerUrl);

		ws.on("open", async () => {
			log("CDP WebSocket connected.");
			try {
				const stateExpr = `
					(function() {
						try {
							var p = window.App && window.App.$store && window.App.$store.state.player;
							if (!p || !p.model || !p.model.currentPlayable) return null;
							return JSON.stringify({
								title: p.model.currentPlayable.track && p.model.currentPlayable.track.title,
								artist: p.model.currentPlayable.track && p.model.currentPlayable.track.artist && p.model.currentPlayable.track.artist.name,
								state: p.model.state
							});
						} catch (e) {
							return null;
						}
					})()
				`.trim();

				log("Evaluating initial player state...");
				const stateResp = await sendCdp(ws, {
					id: 1,
					method: "Runtime.evaluate",
					params: { expression: stateExpr, returnByValue: true },
				});
				log("Initial state response:", JSON.stringify(stateResp, null, 2));

				const nextExpr = `
					(function() {
						// Try to locate the built-in Next button and click it, just like a real user.
						var candidates = [
							'button[data-qaid="next"]',
							'button[aria-label="Next"]',
							'button[aria-label="Next song"]',
							'button[aria-label="Next track"]',
							'button[data-test-id="player-controls-next"]'
						];
						var btn = null;
						for (var i = 0; i < candidates.length && !btn; i++) {
							btn = document.querySelector(candidates[i]);
						}
						if (!btn) {
							console.log("CDP dev-next: could not find Next button via known selectors.");
							return "no-button";
						}
						console.log("CDP dev-next: clicking Next button:", btn.getAttribute("aria-label") || btn.getAttribute("data-test-id") || btn.className);
						btn.click();
						return "clicked";
					})()
				`.trim();

				log("Clicking native Next button via CDP...");
				const nextResp = await sendCdp(ws, {
					id: 2,
					method: "Runtime.evaluate",
					params: { expression: nextExpr, returnByValue: true },
				});
				log("Next-button click response:", JSON.stringify(nextResp, null, 2));

				log("Evaluating player state after player/next...");
				const stateResp2 = await sendCdp(ws, {
					id: 3,
					method: "Runtime.evaluate",
					params: { expression: stateExpr, returnByValue: true },
				});
				log("Post-next state response:", JSON.stringify(stateResp2, null, 2));

				log("Done. Check Amazon Music for movement and DevTools console for VUEX_DISPATCH logs.");
				ws.close();
			} catch (error) {
				log("Error during CDP sequence:", error);
				ws.close();
			}
		});

		ws.on("error", (error) => {
			log("WebSocket error:", error);
		});
	} catch (error) {
		log("Fatal error in dev-next:", error);
	}
}

// Only run when invoked directly with Node (not when imported in tests).
if (require.main === module) {
	void main();
}

