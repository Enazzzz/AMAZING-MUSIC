import http from "node:http";
import WebSocket from "ws";

const DEBUG_PORT = 9222;

type CdpTarget = {
	url?: string;
	webSocketDebuggerUrl?: string;
};

function log(...args: unknown[]): void {
	// eslint-disable-next-line no-console
	console.log("[dev-direct-next]", ...args);
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
				const msg = JSON.parse(raw.toString()) as { id?: number };
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
	log("Discovering Morpho target...");
	const target = await getMorphoTarget();
	if (!target.webSocketDebuggerUrl) {
		throw new Error("Morpho target has no webSocketDebuggerUrl.");
	}

	log("Using target URL:", target.url);
	log("Using WS:", target.webSocketDebuggerUrl);

	const ws = new WebSocket(target.webSocketDebuggerUrl);

	ws.on("open", async () => {
		try {
			log("CDP connected.");

			const readStateExpr = `
				(function() {
					try {
						var p = window.App && window.App.$store && window.App.$store.state && window.App.$store.state.player;
						if (!p || !p.model || !p.model.currentPlayable || !p.model.currentPlayable.track) return null;
						return JSON.stringify({
							title: p.model.currentPlayable.track.title || null,
							artist: p.model.currentPlayable.track.artist && p.model.currentPlayable.track.artist.name || null,
							state: p.model.state || null
						});
					} catch (e) {
						return null;
					}
				})()
			`.trim();

			const before = await sendCdp(ws, {
				id: 1,
				method: "Runtime.evaluate",
				params: { expression: readStateExpr, returnByValue: true },
			});
			log("Before state:", JSON.stringify(before, null, 2));

			const directNextExpr = `
				(function() {
					try {
						function resolveRequire() {
							if (typeof window.__amazon_require__ === "function") return window.__amazon_require__;
							if (!window.webpackJsonp || !window.webpackJsonp.push) return null;
							try {
								window.webpackJsonp.push([
									["__am_req_chunk__"],
									{
										"__am_req_module__": function(module, exports, req) {
											window.__amazon_require__ = req;
										}
									},
									[["__am_req_module__"]]
								]);
							} catch (e) {
								return null;
							}
							return typeof window.__amazon_require__ === "function" ? window.__amazon_require__ : null;
						}

						var req = resolveRequire();
						if (!req) return "direct:no-require";

						var playerModule = req("0903");
						var player = playerModule && (playerModule.a || playerModule.default || playerModule);
						if (!player) return "direct:no-player";
						if (typeof player.playNext !== "function") return "direct:no-playNext";

						player.playNext();
						return "direct:ok";
					} catch (e) {
						return "direct:error:" + (e && e.message ? e.message : String(e));
					}
				})()
			`.trim();

			const invoke = await sendCdp(ws, {
				id: 2,
				method: "Runtime.evaluate",
				params: { expression: directNextExpr, returnByValue: true },
			});
			log("Direct invocation result:", JSON.stringify(invoke, null, 2));

			const after = await sendCdp(ws, {
				id: 3,
				method: "Runtime.evaluate",
				params: { expression: readStateExpr, returnByValue: true },
			});
			log("After state:", JSON.stringify(after, null, 2));

			log("Done.");
			ws.close();
		} catch (error) {
			log("Run failed:", error);
			ws.close();
		}
	});

	ws.on("error", (error) => {
		log("WebSocket error:", error);
	});
}

if (require.main === module) {
	void main().catch((error) => {
		log("Fatal:", error);
	});
}

