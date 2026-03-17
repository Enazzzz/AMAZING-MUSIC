/**
 * Test: append current track to first user playlist via Library.appendTracksToPlaylist.
 * Prereq: Amazon Music running with --remote-debugging-port=9222.
 * Run: npm run dev:append-to-playlist
 *
 * Test playlist (use this for repeat runs): "2 mile run + warmup" (id 9051b67a-cdf8-4ae6-aa06-f516f23dae83).
 * Test song: https://music.amazon.com/albums/B073JTXVYG?trackAsin=B073SCYJ1Y — track B073SCYJ1Y, album B073JTXVYG.
 * Note: In early testing the bridge call sometimes cleared the playlist; keep using a dedicated test playlist.
 */

import http from "node:http";
import WebSocket from "ws";

const DEBUG_PORT = 9222;

/** If set, use this playlist id when it appears in user playlists. */
const TEST_PLAYLIST_ID: string | undefined = "0c231a7bf0c94e0cbc16eb4d0ffec48d";

/** If set, add this track by ASIN using the app's item normalizer (3e08 "g") — no need for the track to be playing. */
const TEST_TRACK_ASIN: string | undefined = "B073SCYJ1Y";

type CdpTarget = { url?: string; webSocketDebuggerUrl?: string };

function log(...args: unknown[]): void {
	// eslint-disable-next-line no-console
	console.log("[dev-append-to-playlist]", ...args);
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
						morpho ? resolve(morpho) : reject(new Error("No Morpho target"));
					} catch (e) {
						reject(e);
					}
				});
			})
			.on("error", reject);
	});
}

async function sendCdp(
	ws: WebSocket,
	id: number,
	expression: string
): Promise<{ value?: string }> {
	return new Promise((resolve, reject) => {
		const handler = (raw: WebSocket.RawData): void => {
			try {
				const msg = JSON.parse(raw.toString()) as {
					id?: number;
					result?: { result?: { value?: string } };
					error?: unknown;
				};
				if (msg.id === id) {
					ws.off("message", handler);
					if (msg.error) reject(msg.error);
					else resolve(msg.result?.result ?? {});
				}
			} catch {
				// ignore
			}
		};
		ws.on("message", handler);
		ws.send(
			JSON.stringify({
				id,
				method: "Runtime.evaluate",
				params: { expression, returnByValue: true },
			}),
			(err) => {
				if (err) {
					ws.off("message", handler);
					reject(err);
				}
			}
		);
	});
}

async function main(): Promise<void> {
	log("Discovering Morpho target...");
	const target = await getMorphoTarget();
	if (!target.webSocketDebuggerUrl) throw new Error("No webSocketDebuggerUrl");

	const ws = new WebSocket(target.webSocketDebuggerUrl);

	ws.on("open", async () => {
		try {
			log("CDP connected.");

			const useAsin = !!TEST_TRACK_ASIN;

			if (useAsin) {
				// Append by ASIN using the app's item normalizer (module 3e08 export "g"), same shape as
				// single-item "Add to playlist" from a catalog row (Object(m["g"])([this.item], this.context)).
				const appendByAsinNormalizer = `
					(function() {
						try {
							function resolveRequire() {
								if (typeof window.__amazon_require__ === "function") return window.__amazon_require__;
								if (!window.webpackJsonp || !window.webpackJsonp.push) return null;
								window.webpackJsonp.push([
									["__am_req_chunk__"],
									{ "__am_req_module__": function(module, exports, req) { window.__amazon_require__ = req; } },
									[["__am_req_module__"]]
								]);
								return typeof window.__amazon_require__ === "function" ? window.__amazon_require__ : null;
							}
							var req = resolveRequire();
							if (!req) return JSON.stringify({ error: "no-require" });
							var bridge = req("6586") && req("6586").a;
							if (!bridge || typeof bridge.execute !== "function") return JSON.stringify({ error: "no-bridge" });
							var normalizer = req("3e08") && req("3e08").g;
							if (typeof normalizer !== "function") return JSON.stringify({ error: "no-normalizer-3e08" });
							var asin = ${JSON.stringify(TEST_TRACK_ASIN)};
							var item = { asin: asin, id: asin, uniqueId: asin, type: "track", context: "prime" };
							var selection = normalizer([item], "prime");
							if (!selection || !selection.length) return JSON.stringify({ error: "normalizer-returned-empty" });
							var pl = bridge.execute("Library.getPlaylists");
							var user = pl && pl.playlists && pl.playlists.user;
							if (!user || !user.length) return JSON.stringify({ error: "no-user-playlists" });
							var testId = ${TEST_PLAYLIST_ID ? JSON.stringify(TEST_PLAYLIST_ID) : "null"};
							var chosen = testId ? user.filter(function(p) { return p.id === testId; })[0] : null;
							if (!chosen) chosen = user[0];
							var playlistId = chosen.id;
							var playlistTitle = chosen.title || chosen.name || "";
							var noop = function() {};
							bridge.execute("Library.appendTracksToPlaylist", playlistId, selection, false, false, "prime", noop, noop, noop);
							try {
								var CheckSel = req("d08e") && req("d08e").a;
								if (CheckSel) new CheckSel(selection).execute();
							} catch (e2) {}
							return JSON.stringify({ ok: true, playlistId: playlistId, playlistTitle: playlistTitle, trackAsin: asin, source: "normalizer" });
						} catch (e) {
							return JSON.stringify({ error: e && e.message ? e.message : String(e) });
						}
					})()
				`.trim();
				const result = await sendCdp(ws, 1, appendByAsinNormalizer);
				const value = result?.value;
				log("Result:", value ?? "null");
				try {
					const parsed = value ? JSON.parse(value) : {};
					if (parsed.error) log("Failed:", parsed.error);
					else if (parsed.ok) log("Append called (by ASIN, no playing). Check app: track " + parsed.trackAsin + " -> \"" + parsed.playlistTitle + "\" (" + parsed.playlistId + ")");
				} catch {
					// ignore
				}
			} else {
				// Current-track path (one evaluate)
				const expr = `
					(function() {
						try {
							function resolveRequire() {
								if (typeof window.__amazon_require__ === "function") return window.__amazon_require__;
								if (!window.webpackJsonp || !window.webpackJsonp.push) return null;
								window.webpackJsonp.push([
									["__am_req_chunk__"],
									{ "__am_req_module__": function(module, exports, req) { window.__amazon_require__ = req; } },
									[["__am_req_module__"]]
								]);
								return typeof window.__amazon_require__ === "function" ? window.__amazon_require__ : null;
							}
							var req = resolveRequire();
							if (!req) return JSON.stringify({ error: "no-require" });
							var bridge = req("6586") && req("6586").a;
							if (!bridge || typeof bridge.execute !== "function") return JSON.stringify({ error: "no-bridge" });
							var p = window.App && window.App.$store && window.App.$store.state && window.App.$store.state.player;
							if (!p || !p.model || !p.model.currentPlayable || !p.model.currentPlayable.track)
								return JSON.stringify({ error: "no-current-track" });
							var raw = p.model.currentPlayable.track;
							if (!raw || !raw.asin) return JSON.stringify({ error: "current track has no asin" });
							var track;
							try {
								track = JSON.parse(JSON.stringify(raw));
							} catch (e) {
								track = { asin: raw.asin, trackUniqueId: raw.trackUniqueId || raw.asin, id: raw.trackUniqueId || raw.id || raw.asin, uniqueId: raw.trackUniqueId || raw.uniqueId || raw.asin };
							}
							var pl = bridge.execute("Library.getPlaylists");
							var user = pl && pl.playlists && pl.playlists.user;
							if (!user || !user.length) return JSON.stringify({ error: "no-user-playlists" });
							var testId = ${TEST_PLAYLIST_ID ? JSON.stringify(TEST_PLAYLIST_ID) : "null"};
							var chosen = testId ? user.filter(function(p) { return p.id === testId; })[0] : null;
							if (!chosen) chosen = user[0];
							var playlistId = chosen.id;
							var playlistTitle = chosen.title || chosen.name || "";
							var noop = function() {};
							bridge.execute("Library.appendTracksToPlaylist", playlistId, [track], false, false, "prime", noop, noop, noop);
							return JSON.stringify({ ok: true, playlistId: playlistId, playlistTitle: playlistTitle, trackAsin: raw.asin, trackId: track.id });
						} catch (e) {
							return JSON.stringify({ error: e && e.message ? e.message : String(e) });
						}
					})()
				`.trim();
				const result = await sendCdp(ws, 1, expr);
				const value = result && result.value;
				log("Result:", value ?? "null");
				try {
					const parsed = value ? JSON.parse(value) : {};
					if (parsed.error) log("Failed:", parsed.error);
					else if (parsed.ok) log("Append called. Check app: track " + (parsed.trackAsin || parsed.trackId) + " -> playlist \"" + parsed.playlistTitle + "\" (" + parsed.playlistId + ")");
				} catch {
					// ignore
				}
			}

			ws.close();
		} catch (e) {
			log("Error:", e);
			ws.close();
		}
	});

	ws.on("error", (e) => log("WebSocket error:", e));
}

void main().catch((e) => log("Fatal:", e));
