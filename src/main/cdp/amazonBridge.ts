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
				"#morpho-ext-toggle{pointer-events:auto;position:absolute;left:-20px;top:0;width:20px;height:52px;display:flex;align-items:center;justify-content:center;border-radius:12px 0 0 12px;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.28);backdrop-filter:blur(20px);color:#fff;cursor:pointer;user-select:none;}",
				"#morpho-ext-panel{pointer-events:auto;width:330px;height:520px;transform:translateX(0);border-radius:18px 0 0 18px;border:1px solid rgba(255,255,255,0.16);background:rgba(10,14,25,0.55);backdrop-filter:blur(20px);box-shadow:0 26px 60px rgba(0,0,0,0.35);padding:14px;display:none;overflow:hidden;}",
				"#morpho-ext-panel.morpho-open{display:block;}",
				"#morpho-ext-title{font:600 16px/1.2 sans-serif;color:#fff;margin:0 0 10px 0;letter-spacing:0.02em;}",
				".morpho-ext-row{display:flex;gap:10px;margin:10px 0;align-items:center;}",
				".morpho-ext-col{display:flex;flex-direction:column;gap:6px;}",
				".morpho-ext-label{font:600 11px/1.1 sans-serif;color:rgba(255,255,255,0.65);text-transform:uppercase;letter-spacing:0.12em;}",
				".morpho-ext-input{width:100%;border-radius:12px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:#fff;padding:10px 12px;outline:none;}",
				".morpho-ext-btn{border-radius:14px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#fff;padding:10px 12px;cursor:pointer;font:600 13px/1.2 sans-serif;}",
				".morpho-ext-btn:hover{background:rgba(255,255,255,0.12);}",
				"#morpho-ext-status{font:500 12px/1.4 sans-serif;color:rgba(255,255,255,0.75);}",
				"#morpho-ext-code{font:700 18px/1.1 sans-serif;color:#fff;letter-spacing:0.06em;}",
				"#morpho-ext-tempo{margin-top:8px;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);}",
				".morpho-ext-tempo-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}",
				".morpho-ext-tempo-value{font:700 12px/1 sans-serif;color:#fff;letter-spacing:0.08em;}",
				".morpho-ext-tempo-slider{width:100%;margin-top:8px;}",
				".morpho-ext-chip-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}",
				".morpho-ext-chip{border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:#fff;padding:6px 9px;cursor:pointer;font:600 11px/1 sans-serif;}",
				".morpho-ext-chip:hover{background:rgba(255,255,255,0.12);}",
				"#morpho-ext-tempo-note{margin-top:8px;font:500 11px/1.35 sans-serif;color:rgba(255,255,255,0.72);}",
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

		var title = createEl("div", "", "Morpho Extension");
		title.id = "morpho-ext-title";

		var status = createEl("div", "", "");
		status.id = "morpho-ext-status";
		status.innerHTML = "Status: disconnected";

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

		var tempoBox = createEl("div", "", "");
		tempoBox.id = "morpho-ext-tempo";
		var tempoHead = createEl("div", "morpho-ext-tempo-head", "");
		var tempoLabel = createEl("div", "morpho-ext-label", "Tempo (Pitch Preserved)");
		var tempoValue = createEl("div", "morpho-ext-tempo-value", "1.00X");
		tempoHead.appendChild(tempoLabel);
		tempoHead.appendChild(tempoValue);
		var tempoSlider = createEl("input", "morpho-ext-tempo-slider", "");
		tempoSlider.type = "range";
		tempoSlider.min = "0.50";
		tempoSlider.max = "2.00";
		tempoSlider.step = "0.05";
		tempoSlider.value = "1.00";
		var tempoChipRow = createEl("div", "morpho-ext-chip-row", "");
		var tempoPresets = ["0.75", "1.00", "1.25", "1.50", "2.00"];
		for (var p = 0; p < tempoPresets.length; p += 1) {
			var preset = tempoPresets[p];
			var chip = createEl("button", "morpho-ext-chip", String(preset) + "X");
			chip.setAttribute("data-tempo", preset);
			tempoChipRow.appendChild(chip);
		}
		var tempoNote = createEl("div", "", "Uses Amazon's native Player.setTempo bridge (pitch-preserving where supported).");
		tempoNote.id = "morpho-ext-tempo-note";
		tempoBox.appendChild(tempoHead);
		tempoBox.appendChild(tempoSlider);
		tempoBox.appendChild(tempoChipRow);
		tempoBox.appendChild(tempoNote);

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

		panel.appendChild(title);
		panel.appendChild(status);
		panel.appendChild(codeRow);
		panel.appendChild(nameRow);
		panel.appendChild(joinRow);
		panel.appendChild(btnRow);
		panel.appendChild(tempoBox);
		panel.appendChild(chat);
		panel.appendChild(chatInputRow);

		root.appendChild(toggle);
		root.appendChild(panel);
		document.body.appendChild(root);

		// Mark as injected only after we successfully required modules and created DOM nodes.
		window.__morphoExtensionInjected = true;

		function setOpen(open) {
			if (open) panel.className = "morpho-open";
			else panel.className = "";
		}

		setOpen(false);
		toggle.addEventListener("mouseenter", function() { setOpen(true); });
		toggle.addEventListener("click", function() { setOpen(panel.className !== "morpho-open"); });

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

		function getTempoFromStore() {
			try {
				var s = window.App && window.App.$store && window.App.$store.state;
				var t = s && s.player && s.player.settings && s.player.settings.tempo;
				var n = Number(t);
				if (!isFinite(n) || n <= 0) return 1;
				return n;
			} catch (e) {
				return 1;
			}
		}

		function clampTempo(n) {
			var v = Number(n);
			if (!isFinite(v)) v = 1;
			if (v < 0.5) v = 0.5;
			if (v > 2) v = 2;
			return Number(v.toFixed(2));
		}

		function renderTempoUi(n) {
			var t = clampTempo(n);
			tempoSlider.value = t.toFixed(2);
			tempoValue.textContent = t.toFixed(2) + "X";
		}

		function getBridgeExecute() {
			var reqLocal = window.__amazon_require__;
			if (typeof reqLocal !== "function") throw new Error("window.__amazon_require__ missing");
			var m = reqLocal("6586");
			var bridge = m && (m.a || m.default || m);
			if (!bridge || typeof bridge.execute !== "function") throw new Error("bridge.execute unavailable");
			return bridge.execute.bind(bridge);
		}

		function setTempoWithWarning(targetTempo) {
			var target = clampTempo(targetTempo);
			renderTempoUi(target);
			var execute = null;
			try {
				execute = getBridgeExecute();
			} catch (e) {
				tempoNote.textContent = "Tempo bridge unavailable right now. Try again in a few seconds.";
				return;
			}

			try {
				execute("Player.setTempo", target);
			} catch (e2) {
				tempoNote.textContent = "Tempo failed: " + (e2 && e2.message ? e2.message : String(e2));
				return;
			}

			tempoNote.textContent = "Applying " + target.toFixed(2) + "X...";
			setTimeout(function() {
				var observed = clampTempo(getTempoFromStore());
				renderTempoUi(observed);
				if (Math.abs(observed - target) > 0.01) {
					tempoNote.textContent = "Tempo appears unsupported for this content. Amazon usually supports this on podcasts.";
				} else {
					tempoNote.textContent = "Tempo applied via Amazon native bridge.";
				}
			}, 500);
		}

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

		tempoSlider.addEventListener("input", function() {
			renderTempoUi(tempoSlider.value);
		});
		tempoSlider.addEventListener("change", function() {
			setTempoWithWarning(tempoSlider.value);
		});
		tempoChipRow.addEventListener("click", function(evt) {
			var target = evt && evt.target;
			if (!target || !target.getAttribute) return;
			var dataTempo = target.getAttribute("data-tempo");
			if (!dataTempo) return;
			setTempoWithWarning(dataTempo);
		});

		// Initialize tempo UI from live store state when possible.
		renderTempoUi(getTempoFromStore());

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
