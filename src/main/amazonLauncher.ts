import { spawn, type ChildProcess } from "node:child_process";
import { CdpClient } from "./cdp/cdpClient";
import {
	buildDispatchExpression,
	buildNavigateExpression,
	buildSearchDispatchExpression,
	buildSearchReadExpression,
	buildStateExpression,
	mapCommandToDispatch,
	parseSearchResults,
} from "./cdp/amazonBridge";
import type { AmazonCommand, PlayerStateDto, SearchResultsDto } from "../shared/types";
import { EMPTY_PLAYER_STATE } from "../shared/types";
import type { LauncherConfig } from "./launcherConfig";
import { hideAmazonMusicWindow } from "./windows/win32WindowHider";

/**
 * Handles process lifecycle and CDP bridge operations for Amazon Music.
 */
export class AmazonLauncherService {
	private readonly config: LauncherConfig;
	private amazonProcess: ChildProcess | null = null;
	private readonly cdpClient: CdpClient;
	private latestState: PlayerStateDto = EMPTY_PLAYER_STATE;
	private pollInterval: NodeJS.Timeout | null = null;
	private hideEnforcerInterval: NodeJS.Timeout | null = null;
	private readonly listeners = new Set<(state: PlayerStateDto) => void>();

	/**
	 * Creates a launcher service with a static runtime config.
	 */
	public constructor(config: LauncherConfig) {
		this.config = config;
		this.cdpClient = new CdpClient(config.debugPort);
	}

	/**
	 * Starts Amazon Music, connects CDP, and begins state polling.
	 */
	public async start(): Promise<{ hiddenWindow: boolean }> {
		this.amazonProcess = spawn(
			this.config.amazonExePath,
			[`--remote-debugging-port=${this.config.debugPort}`],
			{
				// Prevent child stdout/stderr pipes from filling and stalling startup.
				stdio: "ignore",
				detached: false,
				windowsHide: false,
			}
		);
		await this.cdpClient.connect(this.config.startupRetryCount, 500);
		let hiddenWindow = false;
		if (this.config.hideAmazonWindow) {
			hiddenWindow = await hideAmazonMusicWindow({
				targetProcessId: this.amazonProcess.pid ?? undefined,
				maxAttempts: 80,
				delayMs: 500,
			});
			this.startHideEnforcer(this.amazonProcess.pid ?? undefined);
		}
		this.startPolling();
		return { hiddenWindow };
	}

	/**
	 * Stops polling, closes CDP, and terminates the spawned process.
	 */
	public async stop(): Promise<void> {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
		if (this.hideEnforcerInterval) {
			clearInterval(this.hideEnforcerInterval);
			this.hideEnforcerInterval = null;
		}
		await this.cdpClient.close();
		if (this.amazonProcess && !this.amazonProcess.killed) {
			this.amazonProcess.kill();
		}
		this.amazonProcess = null;
	}

	/**
	 * Returns the current cached state for immediate renderer hydration.
	 */
	public getCachedState(): PlayerStateDto {
		return this.latestState;
	}

	/**
	 * Subscribes to state updates emitted from the polling loop.
	 */
	public subscribe(listener: (state: PlayerStateDto) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Dispatches a typed command to Amazon's Vuex store.
	 */
	public async sendCommand(command: AmazonCommand): Promise<unknown> {
		const mapped = mapCommandToDispatch(command);
		const expression = buildDispatchExpression(mapped.action, mapped.payload);
		return this.cdpClient.evaluate(expression);
	}

	/**
	 * Pushes a route path into Amazon's internal Vue router.
	 */
	public async navigate(path: string): Promise<unknown> {
		const expression = buildNavigateExpression(path);
		return this.cdpClient.evaluate(expression);
	}

	/**
	 * Executes a search action and reads normalized search results.
	 */
	public async search(query: string): Promise<SearchResultsDto> {
		const dispatchExpression = buildSearchDispatchExpression(query);
		await this.cdpClient.evaluate(dispatchExpression);
		const readExpression = buildSearchReadExpression(query);
		const raw = await this.cdpClient.evaluate(readExpression);
		return parseSearchResults(raw, query);
	}

	/**
	 * Enumerates registered Vuex actions from the live store.
	 */
	public async listActions(): Promise<string[]> {
		const raw = await this.cdpClient.evaluate("JSON.stringify(Object.keys(window.App.$store._actions))");
		if (typeof raw !== "string") {
			return [];
		}
		try {
			return JSON.parse(raw) as string[];
		} catch (_error) {
			return [];
		}
	}

	/**
	 * Ensures a direct-call helper exists in the Morpho page by resolving webpack require
	 * and binding to the internal Player module (`0903` from exported app.js).
	 */
	private async ensureInternalPlayerHelper(): Promise<unknown> {
		const expression = `
			(function () {
				if (
					window.AmazonInternalPlayer &&
					typeof window.AmazonInternalPlayer.playNext === "function" &&
					typeof window.AmazonInternalPlayer.playPrevious === "function"
				) {
					return "helper:existing";
				}

				function resolveRequire() {
					if (typeof window.__amazon_require__ === "function") {
						return window.__amazon_require__;
					}
					if (!window.webpackJsonp || !window.webpackJsonp.push) {
						return null;
					}
					try {
						window.webpackJsonp.push([
							["__am_req_chunk__"],
							{
								"__am_req_module__": function (module, exports, req) {
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
				if (!req) {
					return "helper:no-require";
				}

				var playerModule = req("0903");
				var player = playerModule && (playerModule.a || playerModule.default || playerModule);
				if (!player || typeof player.playNext !== "function") {
					return "helper:no-player-module";
				}

				window.AmazonInternalPlayer = {
					playNext: function () {
						return player.playNext();
					},
					playPrevious: function () {
						return player.playPrevious();
					},
					playPause: function () {
						var modelState = player && player.model && player.model.state;
						return player.setPaused(modelState !== "PAUSED");
					},
					toggleShuffle: function () {
						var cur = !!(player && player.settings && player.settings.shuffle);
						return player.setShuffle(!cur);
					},
					toggleRepeat: function () {
						return player.toggleRepeat();
					}
				};

				return "helper:created";
			})()
		`.trim();

		return this.cdpClient.evaluate(expression);
	}

	/**
	 * Sends direct internal controls using Amazon's Player module helper.
	 * Falls back to data-qaid button clicks if helper resolution fails.
	 */
	public async clickControl(control: "next" | "previous" | "playPause" | "shuffle" | "repeat"): Promise<unknown> {
		const helperResult = await this.ensureInternalPlayerHelper();

		const directExpression = `
			(function () {
				var type = "${control}";
				if (!window.AmazonInternalPlayer) {
					return "direct:no-helper";
				}
				if (type === "next") {
					window.AmazonInternalPlayer.playNext();
					return "direct:next";
				}
				if (type === "previous") {
					window.AmazonInternalPlayer.playPrevious();
					return "direct:previous";
				}
				if (type === "playPause") {
					window.AmazonInternalPlayer.playPause();
					return "direct:playPause";
				}
				if (type === "shuffle") {
					window.AmazonInternalPlayer.toggleShuffle();
					return "direct:shuffle";
				}
				if (type === "repeat") {
					window.AmazonInternalPlayer.toggleRepeat();
					return "direct:repeat";
				}
				return "direct:unknown-type";
			})()
		`.trim();

		try {
			return await this.cdpClient.evaluate(directExpression);
		} catch (_error) {
			const fallbackExpression = `
				(function () {
					var type = "${control}";
					var selectors = {
						next: 'button[data-qaid="next"]',
						previous: 'button[data-qaid="previous"]',
						playPause: 'button[data-qaid="playPause"]',
						shuffle: 'button[data-qaid="shuffle"]',
						repeat: 'button[data-qaid="repeat"]'
					};
					var sel = selectors[type];
					if (!sel) return "fallback:unknown-type";
					var btn = document.querySelector(sel);
					if (!btn) return "fallback:no-button:" + type;
					btn.click();
					return "fallback:clicked:" + type;
				})()
			`.trim();

			const fallbackResult = await this.cdpClient.evaluate(fallbackExpression);
			return {
				helperResult,
				directFailed: true,
				fallbackResult,
			};
		}
	}

	/**
	 * Enumerates registered Vuex mutations from the live store.
	 */
	public async listMutations(): Promise<string[]> {
		const raw = await this.cdpClient.evaluate("JSON.stringify(Object.keys(window.App.$store._mutations))");
		if (typeof raw !== "string") {
			return [];
		}
		try {
			return JSON.parse(raw) as string[];
		} catch (_error) {
			return [];
		}
	}

	/**
	 * Starts a fixed-interval polling loop for playback state snapshots.
	 */
	private startPolling(): void {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
		}
		this.pollInterval = setInterval(() => {
			void this.refreshState();
		}, this.config.statePollMs);
		void this.refreshState();
	}

	/**
	 * Re-applies hide shortly after startup in case Amazon re-shows its window.
	 */
	private startHideEnforcer(targetProcessId: number | undefined): void {
		if (this.hideEnforcerInterval) {
			clearInterval(this.hideEnforcerInterval);
		}
		let attemptsRemaining = 45;
		this.hideEnforcerInterval = setInterval(() => {
			attemptsRemaining -= 1;
			void hideAmazonMusicWindow({
				targetProcessId,
				maxAttempts: 1,
				delayMs: 0,
			});
			if (attemptsRemaining <= 0 && this.hideEnforcerInterval) {
				clearInterval(this.hideEnforcerInterval);
				this.hideEnforcerInterval = null;
			}
		}, 1000);
	}

	/**
	 * Fetches and parses the latest player state from CDP.
	 */
	private async refreshState(): Promise<void> {
		try {
			const raw = await this.cdpClient.evaluate(buildStateExpression());
			if (typeof raw !== "string") {
				return;
			}
			const nextState = JSON.parse(raw) as PlayerStateDto;
			const changed = JSON.stringify(nextState) !== JSON.stringify(this.latestState);
			this.latestState = nextState;
			if (changed) {
				for (const listener of this.listeners) {
					listener(nextState);
				}
			}
		} catch (_error) {
			// Intentionally swallow transient polling errors to keep the loop alive.
		}
	}
}
