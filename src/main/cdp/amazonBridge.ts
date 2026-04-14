import type { AmazonCommand } from "../../shared/types";

/**
 * Escapes single quotes for safe inline JavaScript string composition.
 */
function escapeSingleQuotes(value: string): string {
	return value.replace(/'/g, "\\'");
}

/**
 * Returns the one-time webpack require resolver injection expression.
 */
export function buildEnsureRequireExpression(): string {
	return `
(function() {
	try {
		if (typeof window.__amazon_require__ === "function") return "require:existing";
		if (!window.webpackJsonp || !window.webpackJsonp.push) return "require:missing-webpack";
		window.webpackJsonp.push([
			["__morpho_req_chunk__"],
			{
				"__morpho_req_module__": function(module, exports, req) {
					window.__amazon_require__ = req;
				}
			},
			[["__morpho_req_module__"]]
		]);
		return typeof window.__amazon_require__ === "function" ? "require:created" : "require:failed";
	} catch (error) {
		return "require:error:" + (error && error.message ? error.message : String(error));
	}
})()
`.trim();
}

/**
 * Builds the stable state extraction expression from reverse-engineering docs.
 */
export function buildStateExtractionExpression(): string {
	return `
(function() {
	try {
		var s = window.App.$store.state;
		var p = s.player;
		if (!p || !p.model || !p.model.currentPlayable || !p.model.currentPlayable.track) return null;
		var track = p.model.currentPlayable.track;
		var nextItems = p.model.playQueue && p.model.playQueue.playables || [];
		var next = [];
		for (var i = 0; i < nextItems.length && next.length < 3; i += 1) {
			var n = nextItems[i];
			if (!n || !n.track || !n.track.title) continue;
			next.push({
				id: String(n.track.trackUniqueId || n.track.asin || ("queue-" + i)),
				title: String(n.track.title || ""),
				artist: String((n.track.artist && n.track.artist.name) || ""),
				art: n.track.album && n.track.album.image || null,
				durationMs: Number(n.track.duration || 0)
			});
		}
		var lyricsLines = track.lyricsData && track.lyricsData.lyrics && track.lyricsData.lyrics.lines || [];
		return JSON.stringify({
			track: {
				id: String(track.trackUniqueId || ""),
				asin: String(track.asin || ""),
				title: String(track.title || ""),
				artist: String((track.artist && track.artist.name) || ""),
				album: String((track.album && track.album.name) || ""),
				artUrl: track.album && track.album.image || null
			},
			playback: {
				isPlaying: p.model.state === "PLAYING",
				currentTimeMs: Number((p.progress && p.progress.currentTime) || 0),
				durationMs: Number(p.model.duration || 0),
				bufferedMs: Number((p.progress && p.progress.buffered) || 0),
				shuffle: !!(p.settings && p.settings.shuffle),
				repeat: (p.settings && p.settings.repeatSettings) || "NONE",
				volume: Number((p.settings && p.settings.volume != null ? p.settings.volume : 1)),
				muted: !!(p.settings && p.settings.muted),
				tempo: Number((p.settings && p.settings.tempo) || 1)
			},
			audio: {
				quality: (p.settings && p.settings.audioQualitySetting) || "UNKNOWN",
				bitrate: p.model.audioAttributes && p.model.audioAttributes.bitrate || null,
				bitDepth: p.model.audioAttributes && p.model.audioAttributes.bitDepth || null,
				sampleRate: p.model.audioAttributes && p.model.audioAttributes.sampleRate || null
			},
			device: {
				id: p.model.outputDeviceAttributes &&
					p.model.outputDeviceAttributes.currentDevice &&
					p.model.outputDeviceAttributes.currentDevice.id || null,
				displayName: p.model.outputDeviceAttributes &&
					p.model.outputDeviceAttributes.currentDevice &&
					p.model.outputDeviceAttributes.currentDevice.displayName || null
			},
			nextUp: next,
			lyrics: lyricsLines,
			rating: "NONE",
			playlistContext: {
				id: p.model.currentPlayable.containerInfo && p.model.currentPlayable.containerInfo.id || null,
				name: p.model.currentPlayable.containerInfo && p.model.currentPlayable.containerInfo.containerName || null,
				type: p.model.currentPlayable.containerInfo && p.model.currentPlayable.containerInfo.type || null
			}
		});
	} catch (error) {
		return null;
	}
})()
`.trim();
}

/**
 * Builds an expression that upgrades Amazon album art URL size markers.
 */
export function buildHighResArtExpression(rawUrl: string): string {
	const safeUrl = escapeSingleQuotes(rawUrl);
	return `
(function() {
	var url = '${safeUrl}';
	if (!url) return null;
	// Amazon images often use segments like ._SX400_ or ._UX400_.
	url = url.replace(/\\._S[X|Y]\\d+_/g, "._SX1200_");
	url = url.replace(/\\._U[X|Y]\\d+_/g, "._UX1200_");
	return url;
})()
`.trim();
}

/**
 * Builds a bridge call expression against Player methods in module 0903.
 */
export function buildPlayerCallExpression(method: string, args: unknown[] = []): string {
	return `
(function() {
	var req = window.__amazon_require__;
	if (typeof req !== "function") throw new Error("window.__amazon_require__ missing");
	var m = req("0903");
	var player = m && (m.a || m.default || m);
	if (!player || typeof player["${method}"] !== "function") {
		throw new Error("Player method not available: ${method}");
	}
	return player["${method}"].apply(player, ${JSON.stringify(args)});
})()
`.trim();
}

/**
 * Builds a bridge call expression against the native execute bridge module 6586.
 */
export function buildBridgeExecuteExpression(command: string, args: unknown[] = []): string {
	const safeCommand = escapeSingleQuotes(command);
	return `
(function() {
	var req = window.__amazon_require__;
	if (typeof req !== "function") throw new Error("window.__amazon_require__ missing");
	var m = req("6586");
	var bridge = m && (m.a || m.default || m);
	if (!bridge || typeof bridge.execute !== "function") throw new Error("Bridge execute unavailable");
	return bridge.execute('${safeCommand}', ...${JSON.stringify(args)});
})()
`.trim();
}

/**
 * Converts renderer command payloads to direct Player bridge actions.
 */
export function mapCommandToBridge(command: AmazonCommand): { method: string; args?: unknown[]; nativeExecute?: string } {
	switch (command.type) {
		case "player.play":
			return { method: "setPaused", args: [false] };
		case "player.pause":
			return { method: "setPaused", args: [true] };
		case "player.next":
			return { method: "playNext" };
		case "player.previous":
			return { method: "playPrevious" };
		case "player.seek":
			return { method: "seek", args: [command.positionMs] };
		case "player.setVolume":
			return { method: "setVolume", args: [command.volume] };
		case "player.toggleMute":
			return { method: "toggleMute" };
		case "player.setShuffle":
			return { method: "setShuffle", args: [command.enabled] };
		case "player.toggleRepeat":
			return { method: "toggleRepeat" };
		case "player.setTempo":
			return { nativeExecute: "Player.setTempo", method: "", args: [command.tempo] };
		case "player.setAudioQuality":
			return { method: "setAudioQuality", args: [command.quality] };
		case "player.setOutputDevice":
			return { method: "setOutputDevice", args: [command.deviceId] };
		case "player.setExclusiveMode":
			return { method: "setExclusiveMode", args: [command.enabled] };
		case "player.toggleLoudnessNormalization":
			return { method: "toggleLoudnessNormalization" };
		case "player.rate":
			return { method: "rateEntity", args: [command.direction === "UP" ? 1 : -1] };
		case "queue.remove":
			return { method: "removeFromPlayQueue", args: [command.ids] };
		case "queue.reorder":
			return { method: "reorderPlayables", args: [[command.id], [String(command.targetIndex)]] };
		case "queue.appendTrack":
			return { method: "appendTracks", args: [[{ asin: command.asin }], false, false] };
		case "library.playPlaylist":
			return { nativeExecute: "Library.startPlaylistPlayback", method: "", args: [command.playlistId] };
		case "library.addCurrentTrackToPlaylist":
			return { nativeExecute: "Library.appendTracksToPlaylist", method: "", args: [command.playlistId] };
		default: {
			const exhaustive: never = command;
			return exhaustive;
		}
	}
}

/**
 * Builds the bridge execute interception script used for discovery logging.
 */
export function buildBridgeInterceptionExpression(): string {
	return `
(function() {
	try {
		var req = window.__amazon_require__;
		if (typeof req !== "function") return "intercept:missing-require";
		var m = req("6586");
		var bridge = m && (m.a || m.default || m);
		if (!bridge || typeof bridge.execute !== "function") return "intercept:missing-bridge";
		if (bridge.__morphoIntercepted) return "intercept:existing";
		var original = bridge.execute.bind(bridge);
		window.__morphoBridgeLogs = window.__morphoBridgeLogs || [];
		bridge.execute = function() {
			try {
				var args = Array.prototype.slice.call(arguments, 0, 4);
				window.__morphoBridgeLogs.push({
					ts: Date.now(),
					args: args
				});
				if (window.__morphoBridgeLogs.length > 2000) {
					window.__morphoBridgeLogs.splice(0, 1000);
				}
			} catch (error) {
				// no-op: discovery logger should never break playback.
			}
			return original.apply(this, arguments);
		};
		bridge.__morphoIntercepted = true;
		return "intercept:enabled";
	} catch (error) {
		return "intercept:error:" + (error && error.message ? error.message : String(error));
	}
})()
`.trim();
}

/**
 * Pulls and clears buffered bridge interception logs from page memory.
 */
export function buildBridgeLogDrainExpression(): string {
	return `
(function() {
	try {
		var logs = window.__morphoBridgeLogs || [];
		window.__morphoBridgeLogs = [];
		return JSON.stringify(logs);
	} catch (error) {
		return "[]";
	}
})()
`.trim();
}

/**
 * Installs fetch/XHR interception in page context for network reconnaissance.
 */
export function buildNetworkInterceptionExpression(): string {
	return `
(function() {
	try {
		if (window.__morphoNetworkIntercepted) return "net-intercept:existing";
		window.__morphoNetworkLogs = window.__morphoNetworkLogs || [];

		function pushLog(entry) {
			try {
				window.__morphoNetworkLogs.push(entry);
				if (window.__morphoNetworkLogs.length > 4000) {
					window.__morphoNetworkLogs.splice(0, 2000);
				}
			} catch (_error) {}
		}

		var originalFetch = window.fetch;
		if (typeof originalFetch === "function") {
			window.fetch = function(input, init) {
				var startedAt = Date.now();
				var method = "GET";
				var url = "";
				try {
					if (typeof input === "string") url = input;
					else if (input && input.url) url = String(input.url);
					if (init && init.method) method = String(init.method);
					else if (input && input.method) method = String(input.method);
				} catch (_parseError) {}
				var reqBody = null;
				try {
					if (init && init.body != null) reqBody = String(init.body).slice(0, 4000);
				} catch (_bodyError) {}
				return originalFetch.apply(this, arguments).then(function(response) {
					try {
						var clone = response.clone();
						clone.text().then(function(bodyText) {
							pushLog({
								kind: "fetch",
								ts: Date.now(),
								method: method,
								url: url,
								status: response.status,
								ok: response.ok,
								durationMs: Date.now() - startedAt,
								requestBodySnippet: reqBody,
								responseSnippet: String(bodyText || "").slice(0, 8000)
							});
						}).catch(function(_readErr) {
							pushLog({
								kind: "fetch",
								ts: Date.now(),
								method: method,
								url: url,
								status: response.status,
								ok: response.ok,
								durationMs: Date.now() - startedAt,
								requestBodySnippet: reqBody,
								responseSnippet: null
							});
						});
					} catch (_cloneErr) {}
					return response;
				}).catch(function(error) {
					pushLog({
						kind: "fetch",
						ts: Date.now(),
						method: method,
						url: url,
						status: 0,
						ok: false,
						durationMs: Date.now() - startedAt,
						requestBodySnippet: reqBody,
						error: error && error.message ? error.message : String(error)
					});
					throw error;
				});
			};
		}

		var originalOpen = XMLHttpRequest.prototype.open;
		var originalSend = XMLHttpRequest.prototype.send;
		XMLHttpRequest.prototype.open = function(method, url) {
			try {
				this.__morphoMethod = method || "GET";
				this.__morphoUrl = url || "";
			} catch (_assignError) {}
			return originalOpen.apply(this, arguments);
		};
		XMLHttpRequest.prototype.send = function(body) {
			var self = this;
			var startedAt = Date.now();
			var bodySnippet = null;
			try {
				if (body != null) bodySnippet = String(body).slice(0, 4000);
			} catch (_bodyErr) {}
			function done() {
				pushLog({
					kind: "xhr",
					ts: Date.now(),
					method: String(self.__morphoMethod || "GET"),
					url: String(self.__morphoUrl || ""),
					status: Number(self.status || 0),
					ok: Number(self.status || 0) >= 200 && Number(self.status || 0) < 300,
					durationMs: Date.now() - startedAt,
					requestBodySnippet: bodySnippet,
					responseSnippet: String(self.responseText || "").slice(0, 8000)
				});
			}
			this.addEventListener("loadend", done);
			return originalSend.apply(this, arguments);
		};

		window.__morphoNetworkIntercepted = true;
		return "net-intercept:enabled";
	} catch (error) {
		return "net-intercept:error:" + (error && error.message ? error.message : String(error));
	}
})()
`.trim();
}

/**
 * Pulls and clears buffered in-page network interception logs.
 */
export function buildNetworkLogDrainExpression(): string {
	return `
(function() {
	try {
		var logs = window.__morphoNetworkLogs || [];
		window.__morphoNetworkLogs = [];
		return JSON.stringify(logs);
	} catch (error) {
		return "[]";
	}
})()
`.trim();
}

/**
 * Builds a route navigation expression in Amazon's internal router.
 */
export function buildNavigateExpression(path: string): string {
	const safePath = escapeSingleQuotes(path);
	return `window.App.$router.push('${safePath}')`;
}

/**
 * Builds a search expression using known Vuex search commits from docs.
 */
export function buildSearchExpression(query: string): string {
	const safeQuery = escapeSingleQuotes(query);
	return `
(function() {
	try {
		var store = window.App.$store;
		store.commit("search/changeKeyword", { keyword: '${safeQuery}' });
		store.commit("search/searchForKeyword", { keyword: '${safeQuery}' });
		return true;
	} catch (error) {
		return false;
	}
})()
`.trim();
}

/**
 * Injects a minimal Morpho "extension" panel directly into Amazon's UI DOM.
 * The extension provides Group Listening UI and uses in-page Player module calls for playback sync.
 */
export function buildInjectMorphoExtensionExpression(wsUrl: string): string {
	const safeWsUrl = escapeSingleQuotes(wsUrl);

	return `
(function() {
	try {
		if (window.__morphoExtensionInjected) return "extension:already";

		var req = window.__amazon_require__;
		if (typeof req !== "function") {
			return "extension:missing-require";
		}

		var playerModule;
		try {
			// Requiring Amazon internal player module can throw if the app is mid-boot.
			playerModule = req("0903");
		} catch (e) {
			return "extension:playerModule-error:" + (e && e.message ? e.message : String(e));
		}
		var player = playerModule && (playerModule.a || playerModule.default || playerModule);
		var store = window.App && window.App.$store && window.App.$store.state;

		function $(sel) { return document.querySelector(sel); }
		function createEl(tag, className, text) {
			var el = document.createElement(tag);
			if (className) el.className = className;
			if (text != null) el.textContent = text;
			return el;
		}

		// Inject styles once.
		var styleId = "morpho-ext-style";
		if (!document.getElementById(styleId)) {
			var style = createEl("style", "", "");
			style.id = styleId;
			style.textContent = [
				"#morpho-ext-root{position:fixed;right:0;top:90px;z-index:2147483000;pointer-events:none;}",
				"#morpho-ext-toggle{pointer-events:auto;position:absolute;left:-22px;top:0;width:22px;height:56px;display:flex;align-items:center;justify-content:center;border-radius:14px 0 0 14px;border:1px solid rgba(129,140,248,0.35);background:linear-gradient(145deg,rgba(99,102,241,0.35),rgba(15,23,42,0.55));backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);color:#e0e7ff;cursor:pointer;user-select:none;box-shadow:-4px 8px 24px rgba(0,0,0,0.25);}",
				"#morpho-ext-toggle:hover{border-color:rgba(165,180,252,0.55);background:linear-gradient(145deg,rgba(129,140,248,0.45),rgba(30,41,59,0.6));}",
				"#morpho-ext-panel{pointer-events:auto;width:340px;height:560px;display:none;flex-direction:column;border-radius:20px 0 0 20px;border:1px solid rgba(129,140,248,0.22);background:linear-gradient(165deg,rgba(15,23,42,0.42),rgba(30,27,75,0.38),rgba(15,23,42,0.48));backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);box-shadow:-8px 0 48px rgba(0,0,0,0.35),inset 0 1px 0 rgba(255,255,255,0.08);padding:12px 14px 14px;overflow:hidden;}",
				"#morpho-ext-panel.morpho-open{display:flex;}",
				".morpho-ext-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-shrink:0;}",
				"#morpho-ext-title{font:700 15px/1.2 ui-sans-serif,system-ui,sans-serif;color:#f8fafc;margin:0;letter-spacing:0.03em;text-shadow:0 1px 2px rgba(0,0,0,0.35);}",
				".morpho-ext-mode-switch{display:flex;border-radius:12px;padding:3px;background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.1);}",
				".morpho-ext-mode-btn{border:0;background:transparent;color:rgba(226,232,240,0.75);padding:6px 10px;border-radius:9px;cursor:pointer;font:600 11px/1 ui-sans-serif,system-ui,sans-serif;}",
				".morpho-ext-mode-btn.morpho-active{background:linear-gradient(180deg,rgba(99,102,241,0.55),rgba(79,70,229,0.45));color:#fff;box-shadow:0 2px 8px rgba(79,70,229,0.35);}",
				"#morpho-ext-view-panel{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding-right:4px;}",
				"#morpho-ext-view-layout{display:none;flex:1;flex-direction:column;min-height:0;gap:10px;}",
				"#morpho-ext-view-layout.morpho-layout-visible{display:flex;}",
				"#morpho-ext-view-panel.morpho-panel-hidden{display:none;}",
				"#morpho-ext-now-playing{font:600 12px/1.35 ui-sans-serif,system-ui,sans-serif;color:rgba(248,250,252,0.92);padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);margin-bottom:8px;max-height:52px;overflow:hidden;text-overflow:ellipsis;}",
				".morpho-ext-quick-row{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;align-items:center;}",
				".morpho-ext-icon-btn{border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.07);color:#f1f5f9;padding:8px 10px;cursor:pointer;font:600 12px/1 ui-sans-serif,system-ui,sans-serif;}",
				".morpho-ext-icon-btn:hover{background:rgba(129,140,248,0.25);border-color:rgba(165,180,252,0.35);}",
				".morpho-ext-layout-hint{font:500 11px/1.4 ui-sans-serif,system-ui,sans-serif;color:rgba(226,232,240,0.8);}",
				"#morpho-ext-layout-css{width:100%;min-height:120px;flex:1;resize:vertical;border-radius:14px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.25);color:#e2e8f0;padding:10px;font:500 12px/1.4 Consolas,monospace;outline:none;box-sizing:border-box;}",
				".morpho-ext-row{display:flex;gap:10px;margin:10px 0;align-items:center;}",
				".morpho-ext-col{display:flex;flex-direction:column;gap:6px;}",
				".morpho-ext-label{font:600 11px/1.1 sans-serif;color:rgba(226,232,240,0.7);text-transform:uppercase;letter-spacing:0.12em;}",
				".morpho-ext-input{width:100%;border-radius:12px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.07);color:#fff;padding:10px 12px;outline:none;}",
				".morpho-ext-btn{border-radius:14px;border:1px solid rgba(129,140,248,0.3);background:linear-gradient(180deg,rgba(99,102,241,0.35),rgba(79,70,229,0.2));color:#f8fafc;padding:10px 12px;cursor:pointer;font:600 13px/1.2 sans-serif;}",
				".morpho-ext-btn:hover{background:linear-gradient(180deg,rgba(129,140,248,0.45),rgba(99,102,241,0.35));}",
				"#morpho-ext-status{font:500 12px/1.4 sans-serif;color:rgba(226,232,240,0.85);}",
				"#morpho-ext-code{font:700 18px/1.1 sans-serif;color:#fff;letter-spacing:0.06em;}",
				"#morpho-ext-chat{height:240px;overflow:auto;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.18);padding:10px;margin-top:12px;}",
				".morpho-ext-msg{font:500 12px/1.4 sans-serif;color:rgba(255,255,255,0.85);margin:6px 0;}",
			].join("\\n");
			document.head.appendChild(style);
		}

		var root = createEl("div", "", "");
		root.id = "morpho-ext-root";
		var toggle = createEl("div", "", "<-");
		toggle.id = "morpho-ext-toggle";
		var panel = createEl("div", "morpho-ext-panel", "");
		panel.id = "morpho-ext-panel";

		var title = createEl("div", "", "Morpho");
		title.id = "morpho-ext-title";

		var header = createEl("div", "morpho-ext-header", "");
		var modeSwitch = createEl("div", "morpho-ext-mode-switch", "");
		var modePanelBtn = createEl("button", "morpho-ext-mode-btn morpho-active", "Panel");
		modePanelBtn.type = "button";
		modePanelBtn.setAttribute("aria-pressed", "true");
		var modeLayoutBtn = createEl("button", "morpho-ext-mode-btn", "Layout");
		modeLayoutBtn.type = "button";
		modeLayoutBtn.setAttribute("aria-pressed", "false");
		modeSwitch.appendChild(modePanelBtn);
		modeSwitch.appendChild(modeLayoutBtn);
		header.appendChild(title);
		header.appendChild(modeSwitch);

		var viewPanel = createEl("div", "", "");
		viewPanel.id = "morpho-ext-view-panel";

		var viewLayout = createEl("div", "", "");
		viewLayout.id = "morpho-ext-view-layout";
		var layoutHintTop = createEl("div", "morpho-ext-layout-hint", "Add CSS rules to tweak Amazon Music layout. If something breaks, press Ctrl+Shift+M to clear styles, or Ctrl+R to reload and re-inject Morpho.");
		var layoutTextarea = createEl("textarea", "", "");
		layoutTextarea.id = "morpho-ext-layout-css";
		layoutTextarea.placeholder = "/* Example: body { filter: contrast(1.05); } */";
		var layoutBtnRow = createEl("div", "morpho-ext-row", "");
		layoutBtnRow.style.marginTop = "0";
		var layoutApplyBtn = createEl("button", "morpho-ext-btn", "Apply");
		layoutApplyBtn.type = "button";
		var layoutClearBtn = createEl("button", "morpho-ext-btn", "Clear");
		layoutClearBtn.type = "button";
		layoutBtnRow.appendChild(layoutApplyBtn);
		layoutBtnRow.appendChild(layoutClearBtn);
		viewLayout.appendChild(layoutHintTop);
		viewLayout.appendChild(layoutTextarea);
		viewLayout.appendChild(layoutBtnRow);

		var status = createEl("div", "", "");
		status.id = "morpho-ext-status";
		status.innerHTML = "Status: disconnected";

		var nowPlayingEl = createEl("div", "", "Now playing: —");
		nowPlayingEl.id = "morpho-ext-now-playing";

		var quickRow = createEl("div", "morpho-ext-quick-row", "");
		var quickPrevBtn = createEl("button", "morpho-ext-icon-btn", "Prev");
		quickPrevBtn.type = "button";
		var quickNextBtn = createEl("button", "morpho-ext-icon-btn", "Next");
		quickNextBtn.type = "button";
		var quickThumbUpBtn = createEl("button", "morpho-ext-icon-btn", "Thumb +");
		quickThumbUpBtn.type = "button";
		var quickThumbDnBtn = createEl("button", "morpho-ext-icon-btn", "Thumb −");
		quickThumbDnBtn.type = "button";
		var quickCopyBtn = createEl("button", "morpho-ext-icon-btn", "Copy track");
		quickCopyBtn.type = "button";
		quickRow.appendChild(quickPrevBtn);
		quickRow.appendChild(quickNextBtn);
		quickRow.appendChild(quickThumbUpBtn);
		quickRow.appendChild(quickThumbDnBtn);
		quickRow.appendChild(quickCopyBtn);

		var codeRow = createEl("div", "morpho-ext-row", "");
		var codeCol = createEl("div", "morpho-ext-col", "");
		var codeLabel = createEl("div", "morpho-ext-label", "Room Code");
		var codeEl = createEl("div", "", "—");
		codeEl.id = "morpho-ext-code";
		codeCol.appendChild(codeLabel);
		codeCol.appendChild(codeEl);
		codeRow.appendChild(codeCol);

		// Inputs.
		var nameRow = createEl("div", "morpho-ext-row", "");
		var nameCol = createEl("div", "morpho-ext-col", "");
		var nameLabel = createEl("div", "morpho-ext-label", "Display Name");
		var nameInput = createEl("input", "", "");
		nameInput.className = "morpho-ext-input";
		nameInput.placeholder = "You";
		nameInput.maxLength = 24;
		nameCol.appendChild(nameLabel);
		nameCol.appendChild(nameInput);
		nameRow.appendChild(nameCol);

		var joinRow = createEl("div", "morpho-ext-row", "");
		var joinCodeInput = createEl("input", "", "");
		joinCodeInput.className = "morpho-ext-input";
		joinCodeInput.placeholder = "Enter room code";
		joinCodeInput.maxLength = 10;
		joinRow.appendChild(joinCodeInput);

		var hostBtn = createEl("button", "morpho-ext-btn", "Start Room");
		var joinBtn = createEl("button", "morpho-ext-btn", "Join Room");

		var btnRow = createEl("div", "morpho-ext-row", "");
		btnRow.appendChild(hostBtn);
		btnRow.appendChild(joinBtn);

		var chat = createEl("div", "", "");
		chat.id = "morpho-ext-chat";
		var chatInputRow = createEl("div", "morpho-ext-row", "");
		var chatInput = createEl("input", "", "");
		chatInput.className = "morpho-ext-input";
		chatInput.placeholder = "Type a message…";
		chatInput.maxLength = 220;
		var chatBtn = createEl("button", "morpho-ext-btn", "Send");
		chatInputRow.appendChild(chatInput);
		chatInputRow.appendChild(chatBtn);

		viewPanel.appendChild(status);
		viewPanel.appendChild(nowPlayingEl);
		viewPanel.appendChild(quickRow);
		viewPanel.appendChild(codeRow);
		viewPanel.appendChild(nameRow);
		viewPanel.appendChild(joinRow);
		viewPanel.appendChild(btnRow);
		viewPanel.appendChild(chat);
		viewPanel.appendChild(chatInputRow);

		panel.appendChild(header);
		panel.appendChild(viewPanel);
		panel.appendChild(viewLayout);

		root.appendChild(toggle);
		root.appendChild(panel);
		document.body.appendChild(root);

		// Mark as injected only after we successfully required modules and created DOM nodes.
		window.__morphoExtensionInjected = true;

		function setOpen(open) {
			panel.className = open ? "morpho-ext-panel morpho-open" : "morpho-ext-panel";
		}

		var LAYOUT_STYLE_ID = "morpho-ext-layout-user-css";
		var LS_MODE = "morpho_ext_mode";
		var LS_LAYOUT_CSS = "morpho_layout_css";

		function getNowPlayingLine() {
			try {
				var st = window.App && window.App.$store && window.App.$store.state;
				var tr = st && st.player && st.player.model && st.player.model.currentPlayable && st.player.model.currentPlayable.track;
				if (!tr) return "Nothing playing";
				var ttl = String(tr.title || "Unknown title");
				var art = tr.artist && tr.artist.name ? String(tr.artist.name) : "";
				return art ? (ttl + " — " + art) : ttl;
			} catch (e) {
				return "—";
			}
		}

		function refreshNowPlaying() {
			nowPlayingEl.textContent = "Now playing: " + getNowPlayingLine();
		}

		function copyTextToClipboard(text) {
			try {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(text);
					return true;
				}
			} catch (e1) {}
			try {
				var ta = document.createElement("textarea");
				ta.value = text;
				ta.setAttribute("readonly", "readonly");
				ta.style.position = "fixed";
				ta.style.left = "-9999px";
				document.body.appendChild(ta);
				ta.select();
				var ok = document.execCommand("copy");
				document.body.removeChild(ta);
				return ok;
			} catch (e2) {}
			return false;
		}

		function ensureLayoutStyleEl() {
			var el = document.getElementById(LAYOUT_STYLE_ID);
			if (el) return el;
			el = document.createElement("style");
			el.id = LAYOUT_STYLE_ID;
			el.setAttribute("data-morpho-layout", "1");
			document.head.appendChild(el);
			return el;
		}

		function applyLayoutCssFromUi() {
			var css = String(layoutTextarea.value || "");
			try {
				localStorage.setItem(LS_LAYOUT_CSS, css);
			} catch (e) {}
			if (!css.trim()) {
				clearLayoutCss(false);
				return;
			}
			var el = ensureLayoutStyleEl();
			el.textContent = css;
		}

		function clearLayoutCss(clearTextarea) {
			var el = document.getElementById(LAYOUT_STYLE_ID);
			if (el && el.parentNode) el.parentNode.removeChild(el);
			try {
				localStorage.removeItem(LS_LAYOUT_CSS);
			} catch (e) {}
			if (clearTextarea !== false) layoutTextarea.value = "";
		}

		function setMode(mode) {
			var isLayout = mode === "layout";
			if (isLayout) {
				viewPanel.className = "morpho-panel-hidden";
				viewLayout.className = "morpho-layout-visible";
				modeLayoutBtn.className = "morpho-ext-mode-btn morpho-active";
				modePanelBtn.className = "morpho-ext-mode-btn";
				modeLayoutBtn.setAttribute("aria-pressed", "true");
				modePanelBtn.setAttribute("aria-pressed", "false");
			} else {
				viewPanel.className = "";
				viewLayout.className = "";
				modePanelBtn.className = "morpho-ext-mode-btn morpho-active";
				modeLayoutBtn.className = "morpho-ext-mode-btn";
				modePanelBtn.setAttribute("aria-pressed", "true");
				modeLayoutBtn.setAttribute("aria-pressed", "false");
			}
			try {
				localStorage.setItem(LS_MODE, isLayout ? "layout" : "panel");
			} catch (e) {}
		}

		modePanelBtn.addEventListener("click", function() { setMode("panel"); });
		modeLayoutBtn.addEventListener("click", function() { setMode("layout"); });
		layoutApplyBtn.addEventListener("click", function() { applyLayoutCssFromUi(); });
		layoutClearBtn.addEventListener("click", function() { clearLayoutCss(true); });

		setOpen(false);
		toggle.addEventListener("mouseenter", function() { setOpen(true); });
		toggle.addEventListener("click", function() {
			var isOpen = panel.className.indexOf("morpho-open") >= 0;
			setOpen(!isOpen);
		});

		var hostWs = null;
		var listenerWs = null;
		var hostRoomCode = null;
		var listenerRoomCode = null;

		function genCode() {
			return Math.random().toString(36).slice(2, 8).toUpperCase();
		}

		function setStatus() {
			var hostConnected = !!hostWs && hostWs.readyState === 1;
			var listenerConnected = !!listenerWs && listenerWs.readyState === 1;
			if (hostConnected && listenerConnected) status.innerHTML = "Status: connected (host+listener)";
			else if (hostConnected) status.innerHTML = "Status: connected (host)";
			else if (listenerConnected) status.innerHTML = "Status: connected (listener)";
			else status.innerHTML = "Status: disconnected";
		}

		function logMsg(line) {
			var el = createEl("div", "morpho-ext-msg", line);
			chat.appendChild(el);
			chat.scrollTop = chat.scrollHeight;
		}

		document.addEventListener("keydown", function(e) {
			if (!e) return;
			if (e.ctrlKey && e.shiftKey && (e.key === "M" || e.key === "m" || e.keyCode === 77)) {
				clearLayoutCss(true);
				setMode("panel");
				logMsg("Morpho: layout CSS cleared (Ctrl+Shift+M).");
			}
		}, false);

		quickPrevBtn.addEventListener("click", function() {
			if (player && typeof player.playPrevious === "function") {
				try { player.playPrevious(); } catch (err) { logMsg("Prev failed."); }
			}
		});
		quickNextBtn.addEventListener("click", function() {
			if (player && typeof player.playNext === "function") {
				try { player.playNext(); } catch (err) { logMsg("Next failed."); }
			}
		});
		quickThumbUpBtn.addEventListener("click", function() {
			if (player && typeof player.rateEntity === "function") {
				try { player.rateEntity(1); logMsg("Thumbs up sent."); } catch (err) { logMsg("Thumb+ unavailable."); }
			} else {
				logMsg("Thumb+ unavailable.");
			}
		});
		quickThumbDnBtn.addEventListener("click", function() {
			if (player && typeof player.rateEntity === "function") {
				try { player.rateEntity(-1); logMsg("Thumbs down sent."); } catch (err) { logMsg("Thumb− unavailable."); }
			} else {
				logMsg("Thumb− unavailable.");
			}
		});
		quickCopyBtn.addEventListener("click", function() {
			var line = getNowPlayingLine();
			if (copyTextToClipboard(line)) logMsg("Copied: " + line);
			else logMsg("Copy failed — select text manually.");
		});

		try {
			var savedCss = localStorage.getItem(LS_LAYOUT_CSS);
			if (savedCss) {
				layoutTextarea.value = savedCss;
				applyLayoutCssFromUi();
			}
		} catch (eCss) {}
		try {
			var savedMode = localStorage.getItem(LS_MODE);
			if (savedMode === "layout") setMode("layout");
		} catch (eMode) {}

		refreshNowPlaying();
		setInterval(function() { refreshNowPlaying(); }, 2000);

		function connectHost() {
			if (!hostRoomCode) return;
			if (hostWs) return;

			hostWs = new WebSocket('${safeWsUrl}');

			hostWs.onopen = function() {
				setStatus();
				hostWs.send(JSON.stringify({ type: "join", role: "host", roomCode: hostRoomCode, name: nameInput.value || "You" }));
			};

			hostWs.onmessage = function(evt) {
				var data = null;
				try { data = JSON.parse(evt.data); } catch (e) {}
				if (!data || !data.type) return;
				if (data.type === "chat") {
					logMsg(String(data.from) + ": " + String(data.message));
				}
			};

			hostWs.onclose = function() {
				hostWs = null;
				setStatus();
			};

			hostWs.onerror = function() {
				status.innerHTML = "Status: websocket error";
			};
		}

		function connectListener() {
			if (!listenerRoomCode) return;
			if (listenerWs) return;

			listenerWs = new WebSocket('${safeWsUrl}');

			listenerWs.onopen = function() {
				setStatus();
				listenerWs.send(JSON.stringify({ type: "join", role: "listener", roomCode: listenerRoomCode, name: nameInput.value || "You" }));
			};

			listenerWs.onmessage = function(evt) {
				var data = null;
				try { data = JSON.parse(evt.data); } catch (e) {}
				if (!data || !data.type) return;
				if (data.type === "chat") {
					logMsg(String(data.from) + ": " + String(data.message));
				}
				if (data.type === "hostState") {
					handleHostState(data.payload || {});
				}
			};

			listenerWs.onclose = function() {
				listenerWs = null;
				setStatus();
			};

			listenerWs.onerror = function() {
				status.innerHTML = "Status: websocket error";
			};
		}

		function handleHostState(payload) {
			// payload: { trackId, isPlaying, currentTimeMs }
			if (!payload) return;
			if (!listenerWs || !listenerRoomCode) return;
			// Playback sync assumptions:
			// - Track switching is a TODO (we only seek/pause/play for now).
			var s = window.App && window.App.$store && window.App.$store.state;
			if (!s || !s.player) return;
			var currentTrackId = s.player.model && s.player.model.currentPlayable && s.player.model.currentPlayable.track && s.player.model.currentPlayable.track.trackUniqueId;
			var desiredTrackId = payload.trackId;

			// If track differs, we still attempt pause/play/seek; track switching is out-of-scope right now.
			var isPlaying = !!payload.isPlaying;
			player && typeof player.setPaused === "function";
			if (typeof player.setPaused === "function") {
				// setPaused(true) pauses; setPaused(false) resumes.
				player.setPaused(!isPlaying);
			}
			var targetTime = Number(payload.currentTimeMs || 0);

			var curTime = Number((s.player.progress && s.player.progress.currentTime) || 0);
			var drift = Math.abs(curTime - targetTime);
			if (isPlaying && drift > 350 && typeof player.seek === "function") {
				player.seek(targetTime);
			}
		}

		hostBtn.addEventListener("click", function() {
			hostRoomCode = genCode();
			codeEl.textContent = hostRoomCode;
			// Make single-instance self testing easy: host generates a code, and we prefill join.
			joinCodeInput.value = hostRoomCode;
			connectHost();
			setOpen(true);
			logMsg("Hosting room " + hostRoomCode);
		});

		joinBtn.addEventListener("click", function() {
			var code = String(joinCodeInput.value || "").trim().toUpperCase();
			if (!code) {
				logMsg("Enter a room code first.");
				return;
			}
			listenerRoomCode = code;
			codeEl.textContent = listenerRoomCode;
			connectListener();
			setOpen(true);
			logMsg("Joining room " + listenerRoomCode);
		});

		chatBtn.addEventListener("click", function() {
			var msg = String(chatInput.value || "").trim();
			if (!msg) return;

			// Prefer sending from the listener connection if present; fall back to host.
			var wsToUse = null;
			var targetRoomCode = null;
			if (listenerWs && listenerWs.readyState === 1 && listenerRoomCode) {
				wsToUse = listenerWs;
				targetRoomCode = listenerRoomCode;
			} else if (hostWs && hostWs.readyState === 1 && hostRoomCode) {
				wsToUse = hostWs;
				targetRoomCode = hostRoomCode;
			}
			if (!wsToUse || !targetRoomCode) return;

			wsToUse.send(JSON.stringify({
				type: "chat",
				roomCode: targetRoomCode,
				from: nameInput.value || "You",
				message: msg
			}));
			chatInput.value = "";
		});

		// Host broadcaster loop.
		setInterval(function() {
			if (!hostWs || hostWs.readyState !== 1) return;
			if (!hostRoomCode) return;
			var s = window.App && window.App.$store && window.App.$store.state;
			if (!s || !s.player || !s.player.model) return;
			var model = s.player.model;
			var track = model.currentPlayable && model.currentPlayable.track;
			if (!track) return;
			var trackId = track.trackUniqueId || track.asin || "";
			var isPlaying = model.state === "PLAYING";
			var currentTimeMs = Number((s.player.progress && s.player.progress.currentTime) || 0);

			// Broadcast at a steady cadence; dedupe at server/receiver if needed later.
			hostWs.send(JSON.stringify({
				type: "hostState",
				roomCode: hostRoomCode,
				payload: { trackId: trackId, isPlaying: isPlaying, currentTimeMs: currentTimeMs }
			}));
		}, 250);

		return "extension:injected";
	} catch (error) {
		return "extension:error:" + (error && error.message ? error.message : String(error));
	}
})()
`.trim();
}
