import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CdpClient } from "../main/cdp/cdpClient";
import { buildEnsureRequireExpression } from "../main/cdp/amazonBridge";

function getArg(name: string, defaultValue?: string): string | undefined {
	const raw = process.argv.find((v) => v.startsWith(`${name}=`));
	if (!raw) return defaultValue;
	const [, value] = raw.split("=");
	return value;
}

function getArgInt(name: string, defaultValue: number): number {
	const raw = getArg(name, String(defaultValue));
	const n = Number(raw);
	return Number.isFinite(n) ? n : defaultValue;
}

function buildStartProbeExpression(): string {
	return `
(function() {
	try {
		if (window.__morphoAudioPathProbe && window.__morphoAudioPathProbe.active) {
			return "probe:already-active";
		}

		window.__morphoAudioPathProbe = {
			active: true,
			startedAt: Date.now(),
			events: [],
			snapshots: [],
			originals: {}
		};
		var probe = window.__morphoAudioPathProbe;

		function pushEvent(kind, payload) {
			try {
				probe.events.push({ ts: Date.now(), kind: kind, payload: payload || null });
				if (probe.events.length > 4000) {
					probe.events.splice(0, 2000);
				}
			} catch (e) {
				// ignore
			}
		}

		function mediaSnapshot() {
			var nodes = Array.prototype.slice.call(document.querySelectorAll("audio,video"));
			return nodes.map(function(n) {
				return {
					tag: n.tagName,
					currentSrc: n.currentSrc || n.src || null,
					paused: !!n.paused,
					playbackRate: Number(n.playbackRate || 1),
					defaultPlaybackRate: Number(n.defaultPlaybackRate || 1),
					preservesPitch:
						(typeof n.preservesPitch === "boolean" ? n.preservesPitch : null),
					webkitPreservesPitch:
						(typeof n.webkitPreservesPitch === "boolean" ? n.webkitPreservesPitch : null),
					mozPreservesPitch:
						(typeof n.mozPreservesPitch === "boolean" ? n.mozPreservesPitch : null),
					readyState: Number(n.readyState || 0),
					duration: Number(isFinite(n.duration) ? n.duration : 0),
					currentTime: Number(isFinite(n.currentTime) ? n.currentTime : 0),
					muted: !!n.muted,
					volume: Number(n.volume == null ? 1 : n.volume),
				};
			});
		}

		function appSnapshot() {
			try {
				var s = window.App && window.App.$store && window.App.$store.state;
				var p = s && s.player;
				var track = p && p.model && p.model.currentPlayable && p.model.currentPlayable.track;
				return {
					state: p && p.model && p.model.state || null,
					tempo: p && p.settings && p.settings.tempo || null,
					trackTitle: track && track.title || null,
					trackAsin: track && track.asin || null,
					trackType: track && track.type || null,
					isPodcast:
						track && (track.isPodcastEpisode || track.isEpisode || track.contentType === "podcast") || false,
				};
			} catch (e) {
				return { error: String(e && e.message ? e.message : e) };
			}
		}

		function pushSnapshot() {
			var snap = {
				ts: Date.now(),
				media: mediaSnapshot(),
				app: appSnapshot(),
			};
			probe.snapshots.push(snap);
			if (probe.snapshots.length > 1000) {
				probe.snapshots.splice(0, 500);
			}
		}

		function describeMediaElement(el) {
			if (!el) return null;
			var srcAttr = null;
			try { srcAttr = el.getAttribute && el.getAttribute("src"); } catch (e0) {}
			return {
				tag: el.tagName || null,
				currentSrc: el.currentSrc || null,
				srcAttr: srcAttr || null,
				paused: !!el.paused,
				playbackRate: Number(el.playbackRate || 1),
				readyState: Number(el.readyState || 0),
				networkState: Number(el.networkState || 0),
				muted: !!el.muted,
				volume: Number(el.volume == null ? 1 : el.volume),
			};
		}

		// Observe existing media nodes at start.
		pushSnapshot();

		// 1) Hook bridge execute (native calls).
		try {
			var req = window.__amazon_require__;
			if (typeof req === "function") {
				var bridgeModule = req("6586");
				var bridge = bridgeModule && (bridgeModule.a || bridgeModule.default || bridgeModule);
				if (bridge && typeof bridge.execute === "function") {
					probe.originals.bridgeExecute = bridge.execute.bind(bridge);
					bridge.execute = function() {
						var args = Array.prototype.slice.call(arguments, 0, 6);
						pushEvent("bridge.execute", args);
						return probe.originals.bridgeExecute.apply(this, arguments);
					};
					pushEvent("hook", { target: "bridge.execute", status: "ok" });
				} else {
					pushEvent("hook", { target: "bridge.execute", status: "missing" });
				}
			} else {
				pushEvent("hook", { target: "bridge.execute", status: "missing-require" });
			}
		} catch (e0) {
			pushEvent("hook-error", { target: "bridge.execute", error: String(e0 && e0.message ? e0.message : e0) });
		}

		// 2) Hook AudioContext creation.
		try {
			var Ctx = window.AudioContext || window.webkitAudioContext;
			if (Ctx && !probe.originals.AudioContext) {
				probe.originals.AudioContext = Ctx;
				var WrappedCtx = function() {
					var instance = new probe.originals.AudioContext();
					pushEvent("audiocontext.create", {
						sampleRate: instance.sampleRate || null,
						state: instance.state || null
					});
					return instance;
				};
				WrappedCtx.prototype = probe.originals.AudioContext.prototype;
				if (window.AudioContext) window.AudioContext = WrappedCtx;
				if (window.webkitAudioContext) window.webkitAudioContext = WrappedCtx;
				pushEvent("hook", { target: "AudioContext", status: "ok" });
			}
		} catch (e1) {
			pushEvent("hook-error", { target: "AudioContext", error: String(e1 && e1.message ? e1.message : e1) });
		}

		// 2b) Hook common WebAudio node creation APIs.
		try {
			var CtxProto = (window.AudioContext && window.AudioContext.prototype) ||
				(window.webkitAudioContext && window.webkitAudioContext.prototype);
			if (CtxProto) {
				function wrapCtxMethod(name) {
					if (!CtxProto[name] || CtxProto[name].__morphoWrapped) return;
					var original = CtxProto[name];
					var wrapped = function() {
						pushEvent("audiocontext." + name, { argc: arguments.length });
						return original.apply(this, arguments);
					};
					wrapped.__morphoWrapped = true;
					CtxProto[name] = wrapped;
				}
				wrapCtxMethod("createMediaElementSource");
				wrapCtxMethod("createBufferSource");
				wrapCtxMethod("createScriptProcessor");
				wrapCtxMethod("audioWorklet");
				pushEvent("hook", { target: "AudioContext.prototype.methods", status: "ok" });
			}
		} catch (e2) {
			pushEvent("hook-error", { target: "AudioContext.prototype.methods", error: String(e2 && e2.message ? e2.message : e2) });
		}

		// 3) Hook HTMLMediaElement prototype methods.
		try {
			var mediaProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
			if (mediaProto) {
				function wrapMediaMethod(name) {
					if (!mediaProto[name] || mediaProto[name].__morphoWrapped) return;
					var original = mediaProto[name];
					var wrapped = function() {
						pushEvent("media." + name, {
							element: describeMediaElement(this),
							argc: arguments.length
						});
						return original.apply(this, arguments);
					};
					wrapped.__morphoWrapped = true;
					mediaProto[name] = wrapped;
				}
				wrapMediaMethod("play");
				wrapMediaMethod("pause");
				wrapMediaMethod("load");
				wrapMediaMethod("setMediaKeys");
				wrapMediaMethod("captureStream");
				pushEvent("hook", { target: "HTMLMediaElement.prototype", status: "ok" });
			}
		} catch (e3) {
			pushEvent("hook-error", { target: "HTMLMediaElement.prototype", error: String(e3 && e3.message ? e3.message : e3) });
		}

		// 4) Hook EME APIs (DRM path signals).
		try {
			if (navigator && navigator.requestMediaKeySystemAccess) {
				var reqMksa = navigator.requestMediaKeySystemAccess.bind(navigator);
				navigator.requestMediaKeySystemAccess = function() {
					var keySystem = arguments[0];
					pushEvent("eme.requestMediaKeySystemAccess", { keySystem: String(keySystem || "") });
					return reqMksa.apply(this, arguments);
				};
				pushEvent("hook", { target: "navigator.requestMediaKeySystemAccess", status: "ok" });
			}
		} catch (e4) {
			pushEvent("hook-error", { target: "navigator.requestMediaKeySystemAccess", error: String(e4 && e4.message ? e4.message : e4) });
		}

		// 5) Hook MediaSource/SourceBuffer as another path signal.
		try {
			if (window.MediaSource && window.MediaSource.prototype) {
				var msProto = window.MediaSource.prototype;
				if (msProto.addSourceBuffer && !msProto.addSourceBuffer.__morphoWrapped) {
					var addSbOriginal = msProto.addSourceBuffer;
					var addSbWrapped = function() {
						pushEvent("mediasource.addSourceBuffer", { mimeType: String(arguments[0] || "") });
						var sb = addSbOriginal.apply(this, arguments);
						try {
							if (sb && sb.appendBuffer && !sb.appendBuffer.__morphoWrapped) {
								var appendOriginal = sb.appendBuffer;
								var appendWrapped = function() {
									var bytes = arguments[0] && arguments[0].byteLength || null;
									pushEvent("sourcebuffer.appendBuffer", { bytes: bytes });
									return appendOriginal.apply(this, arguments);
								};
								appendWrapped.__morphoWrapped = true;
								sb.appendBuffer = appendWrapped;
							}
						} catch (_sbErr) {
							// ignore
						}
						return sb;
					};
					addSbWrapped.__morphoWrapped = true;
					msProto.addSourceBuffer = addSbWrapped;
				}
				pushEvent("hook", { target: "MediaSource.prototype", status: "ok" });
			}
		} catch (e5) {
			pushEvent("hook-error", { target: "MediaSource.prototype", error: String(e5 && e5.message ? e5.message : e5) });
		}

		// 6) Track dynamic audio/video node creation.
		try {
			var originalCreateElement = document.createElement.bind(document);
			document.createElement = function(tagName) {
				var el = originalCreateElement(tagName);
				var tag = String(tagName || "").toLowerCase();
				if (tag === "audio" || tag === "video") {
					pushEvent("dom.createElement.media", { tag: tag });
				}
				return el;
			};
			pushEvent("hook", { target: "document.createElement", status: "ok" });
		} catch (e6) {
			pushEvent("hook-error", { target: "document.createElement", error: String(e6 && e6.message ? e6.message : e6) });
		}

		// 3) Periodic sampling while probe runs.
		probe.interval = setInterval(function() {
			pushSnapshot();
		}, 500);

		return "probe:started";
	} catch (error) {
		return "probe:error:" + (error && error.message ? error.message : String(error));
	}
})()
`.trim();
}

function buildStopProbeExpression(): string {
	return `
(function() {
	try {
		var probe = window.__morphoAudioPathProbe;
		if (!probe || !probe.active) {
			return JSON.stringify({ status: "probe:not-active" });
		}
		probe.active = false;
		if (probe.interval) {
			clearInterval(probe.interval);
			probe.interval = null;
		}

		// Attempt to restore bridge.execute if we patched it.
		try {
			var req = window.__amazon_require__;
			if (typeof req === "function" && probe.originals && probe.originals.bridgeExecute) {
				var bridgeModule = req("6586");
				var bridge = bridgeModule && (bridgeModule.a || bridgeModule.default || bridgeModule);
				if (bridge && typeof bridge.execute === "function") {
					bridge.execute = probe.originals.bridgeExecute;
				}
			}
		} catch (_restoreError) {
			// ignore restore errors
		}

		var result = {
			status: "probe:stopped",
			startedAt: probe.startedAt || null,
			endedAt: Date.now(),
			events: probe.events || [],
			snapshots: probe.snapshots || [],
		};
		return JSON.stringify(result);
	} catch (error) {
		return JSON.stringify({ status: "probe:error", error: String(error && error.message ? error.message : error) });
	}
})()
`.trim();
}

async function main(): Promise<void> {
	const debugPort = getArgInt("--debugPort", 9222);
	const durationMs = getArgInt("--durationMs", 15000);
	const outputDir = getArg("--outputDir", "logs") ?? "logs";

	const cdp = new CdpClient(debugPort);
	await cdp.connect();
	await cdp.evaluate(buildEnsureRequireExpression(), 15000);

	const startResult = await cdp.evaluate(buildStartProbeExpression(), 15000);
	console.log(`[audio-probe] start=${String(startResult)} debugPort=${debugPort}`);
	console.log(`[audio-probe] capture window=${durationMs}ms. Play a normal music track now.`);

	await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

	const rawResult = await cdp.evaluate(buildStopProbeExpression(), 15000);
	const payload = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);

	mkdirSync(outputDir, { recursive: true });
	const filename = `audio-path-probe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
	const outPath = join(outputDir, filename);
	writeFileSync(outPath, payload, "utf8");

	console.log(`[audio-probe] saved ${outPath}`);
	await cdp.close();
}

void main().catch((error) => {
	console.error("[audio-probe] failed:", error);
	process.exit(1);
});

