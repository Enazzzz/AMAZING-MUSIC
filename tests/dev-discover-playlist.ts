/**
 * Discovery script: find playlist-related Vuex actions, mutations, and store state.
 * Run with: npx ts-node tests/dev-discover-playlist.ts
 * Prereq: Amazon Music running with --remote-debugging-port=9222
 */

import http from "node:http";
import WebSocket from "ws";

const DEBUG_PORT = 9222;

type CdpTarget = { url?: string; webSocketDebuggerUrl?: string };

function log(...args: unknown[]): void {
	// eslint-disable-next-line no-console
	console.log("[dev-discover-playlist]", ...args);
}

async function getMorphoTarget(): Promise<CdpTarget> {
	return new Promise<CdpTarget>((resolve, reject) => {
		http
			.get(`http://localhost:${DEBUG_PORT}/json`, (res) => {
				let data = "";
				res.on("data", (chunk) => { data += chunk; });
				res.on("end", () => {
					try {
						const targets = JSON.parse(data) as CdpTarget[];
						const morpho = targets.find((t) => t.url && t.url.includes("amazon.com/morpho"));
						morpho ? resolve(morpho) : reject(new Error("No Morpho target found"));
					} catch (e) {
						reject(e);
					}
				});
			})
			.on("error", reject);
	});
}

async function sendCdp(ws: WebSocket, id: number, expression: string): Promise<unknown> {
	return new Promise<unknown>((resolve, reject) => {
		const handler = (raw: WebSocket.RawData): void => {
			try {
				const msg = JSON.parse(raw.toString()) as { id?: number; result?: { result?: { value?: string } }; error?: unknown };
				if (msg.id === id) {
					ws.off("message", handler);
					if (msg.error) reject(msg.error);
					else resolve(msg.result?.result?.value ?? null);
				}
			} catch {
				// ignore
			}
		};
		ws.on("message", handler);
		ws.send(JSON.stringify({
			id,
			method: "Runtime.evaluate",
			params: { expression, returnByValue: true },
		}), (err) => { if (err) { ws.off("message", handler); reject(err); } });
	});
}

async function main(): Promise<void> {
	log("Discovering Morpho target...");
	const target = await getMorphoTarget();
	if (!target.webSocketDebuggerUrl) throw new Error("No webSocketDebuggerUrl");

	const ws = new WebSocket(target.webSocketDebuggerUrl);

	ws.on("open", async () => {
		try {
			log("CDP connected.\n");

			// 1) All action names (full list — add-to-playlist may use different naming)
			const actionsExpr = `
				(function() {
					try {
						var keys = Object.keys(window.App.$store._actions || {});
						return JSON.stringify(keys.sort());
					} catch (e) { return JSON.stringify({ error: e.message }); }
				})()
			`;
			const actionsRaw = await sendCdp(ws, 1, actionsExpr);
			log("--- All Vuex action names ---");
			try {
				const actions = JSON.parse(actionsRaw as string) as string[];
				log(Array.isArray(actions) ? actions.join("\n") : actionsRaw);
			} catch {
				log(actionsRaw ?? "null");
			}

			// 2) All mutation names (full list)
			const mutationsExpr = `
				(function() {
					try {
						var keys = Object.keys(window.App.$store._mutations || {});
						return JSON.stringify(keys.sort());
					} catch (e) { return JSON.stringify({ error: e.message }); }
				})()
			`;
			const mutationsRaw = await sendCdp(ws, 2, mutationsExpr);
			log("\n--- All Vuex mutation names ---");
			try {
				const mutations = JSON.parse(mutationsRaw as string) as string[];
				log(Array.isArray(mutations) ? mutations.join("\n") : mutationsRaw);
			} catch {
				log(mutationsRaw ?? "null");
			}

			// 3) Current track IDs (so we know what to pass to "add to playlist")
			const trackExpr = `
				(function() {
					try {
						var p = window.App.$store.state.player;
						if (!p || !p.model || !p.model.currentPlayable) return JSON.stringify({ error: "no current track" });
						var t = p.model.currentPlayable.track;
						return JSON.stringify({
							asin: t && t.asin,
							trackUniqueId: t && t.trackUniqueId,
							title: t && t.title,
							entityType: t && t.entityType
						});
					} catch (e) { return JSON.stringify({ error: e.message }); }
				})()
			`;
			const trackRaw = await sendCdp(ws, 3, trackExpr);
			log("\n--- Current track (for add-to-playlist payload) ---");
			log(trackRaw ?? "null");

			// 4) Top-level store state keys + probe for playlists
			const playlistsExpr = `
				(function() {
					try {
						var s = window.App.$store.state;
						var out = { stateKeys: s ? Object.keys(s).sort() : [] };
						if (s.library) out.libraryKeys = Object.keys(s.library);
						if (s.playlist) out.playlistKeys = Object.keys(s.playlist);
						// Common places playlists live
						if (s.library && s.library.playlists) {
							var pl = s.library.playlists;
							out.libraryPlaylists = Array.isArray(pl) ? pl.length + " items" : typeof pl;
						}
						if (s.library && s.library.userPlaylists) {
							var up = s.library.userPlaylists;
							out.userPlaylists = Array.isArray(up) ? up.slice(0, 3).map(function(p) { return { id: p.id, name: p.name }; }) : typeof up;
						}
						// Any object with 'playlist' in the key
						if (s.library) {
							Object.keys(s.library).forEach(function(k) {
								if (/playlist/i.test(k)) out["library." + k] = Array.isArray(s.library[k]) ? s.library[k].length : Object.keys(s.library[k] || {}).slice(0, 5);
							});
						}
						return JSON.stringify(out, null, 2);
					} catch (e) { return JSON.stringify({ error: e.message }); }
				})()
			`;
			const playlistsRaw = await sendCdp(ws, 4, playlistsExpr);
			log("\n--- Store state keys + playlist probes ---");
			log(playlistsRaw ?? "null");

			log("\nDone. Use these names to grep exported/app.js for the real implementation (e.g. addTracksToPlaylist, playlist/add).");
			ws.close();
		} catch (e) {
			log("Error:", e);
			ws.close();
		}
	});

	ws.on("error", (e) => log("WebSocket error:", e));
}

void main().catch((e) => log("Fatal:", e));
