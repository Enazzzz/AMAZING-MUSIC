import { spawn, type ChildProcess } from "node:child_process";
import type { AmazonCommand, MorphoConfig, PlayerStateDto, SearchResultsDto } from "../shared/types";
import { EMPTY_PLAYER_STATE } from "../shared/types";
import { CdpClient } from "../main/cdp/cdpClient";
import {
	buildBridgeExecuteExpression,
	buildBridgeInterceptionExpression,
	buildBridgeLogDrainExpression,
	buildEnsureRequireExpression,
	buildNavigateExpression,
	buildPlayerCallExpression,
	buildSearchExpression,
	buildStateExtractionExpression,
	buildInjectMorphoExtensionExpression,
	mapCommandToBridge,
} from "../main/cdp/amazonBridge";
import { StatePoller } from "../main/cdp/statePoller";
import { BridgeDiscoveryLogger } from "../main/cdp/bridgeDiscoveryLogger";
import { hideAmazonMusicWindow } from "../main/windows/win32WindowHider";

interface WorkerRequestMessage {
	type: "request";
	id: number;
	action: "start" | "stop" | "sendCommand" | "navigate" | "search" | "setConfig";
	payload?: unknown;
}

interface WorkerResponseMessage {
	type: "response";
	id: number;
	ok: boolean;
	result?: unknown;
	error?: string;
}

interface WorkerStateMessage {
	type: "state";
	state: PlayerStateDto;
}

interface WorkerLogMessage {
	type: "log";
	level: "info" | "warn" | "error";
	message: string;
}

/**
 * Runs Amazon/CDP lifecycle in an isolated Node process.
 */
class LauncherWorkerRuntime {
	private config: MorphoConfig | null = null;
	private cdpClient: CdpClient | null = null;
	private poller: StatePoller | null = null;
	private bridgeLogger: BridgeDiscoveryLogger | null = null;
	private amazonProcess: ChildProcess | null = null;
	private latestState: PlayerStateDto = EMPTY_PLAYER_STATE;
	private hideEnforcerInterval: NodeJS.Timeout | null = null;
	private bridgeLogDrainInterval: NodeJS.Timeout | null = null;
	private started = false;
	private readonly discoveryMode = process.env.MORPHO_BRIDGE_DISCOVERY === "1";
	private readonly enableStatePolling = process.env.MORPHO_ENABLE_POLLING === "1";

	/**
	 * Applies updated runtime configuration from the host process.
	 */
	public setConfig(config: MorphoConfig, userDataPath: string): void {
		this.config = config;
		this.cdpClient = new CdpClient(config.debugPort);
		this.poller = new StatePoller(async () => this.readState(), (state) => this.emitState(state), config.pollMs);
		this.bridgeLogger = new BridgeDiscoveryLogger(userDataPath);
		this.log("info", "Launcher worker config applied.");
	}

	/**
	 * Starts Amazon process management and CDP polling loops.
	 */
	public async start(): Promise<{ hiddenWindow: boolean }> {
		if (this.started) {
			return { hiddenWindow: false };
		}
		if (!this.config || !this.cdpClient || !this.poller) {
			throw new Error("Launcher worker is not configured.");
		}
		await this.ensureAmazonRunning();
		await this.cdpClient.connect();
		await this.waitForStoreReady();
		// Ensure webpack require resolver is injected before extension injection.
		const requireResult = await this.cdpClient.evaluate(buildEnsureRequireExpression(), 15000);
		this.log("info", `Webpack require injection result: ${String(requireResult)}`);

		// For now: wait a bit before injecting to avoid freezing Amazon during early boot.
		this.log("info", "Waiting 10s before extension injection...");
		await new Promise<void>((resolve) => setTimeout(resolve, 10000));
		this.log("info", "Attempting extension injection now...");

		const clientHost =
			this.config && this.config.groupListening.host === "0.0.0.0" ? "127.0.0.1" : this.config.groupListening.host;
		const wsUrl = `ws://${clientHost}:${this.config.groupListening.port}`;
		const injectResult = await this.cdpClient.evaluate(buildInjectMorphoExtensionExpression(wsUrl), 15000);
		this.log("info", `Extension injection result: ${String(injectResult)}`);
		if (this.discoveryMode) {
			await this.cdpClient.evaluate(buildBridgeInterceptionExpression());
			this.startBridgeLogDrainLoop();
			this.log("info", "Bridge discovery interception enabled.");
		}
		// Temporarily keep Amazon window visible while stabilizing Morpho launcher.
		const hiddenWindow = false;
		if (this.enableStatePolling) {
			this.poller.start();
			this.log("info", "State polling enabled; emitting snapshots.");
		} else {
			this.log("info", "State polling disabled; extension-only mode.");
		}
		this.started = true;
		this.log("info", "Launcher worker started.");
		return { hiddenWindow };
	}

	/**
	 * Stops polling loops and closes transport/process resources.
	 */
	public async stop(): Promise<void> {
		this.poller?.stop();
		if (this.hideEnforcerInterval) {
			clearInterval(this.hideEnforcerInterval);
			this.hideEnforcerInterval = null;
		}
		if (this.bridgeLogDrainInterval) {
			clearInterval(this.bridgeLogDrainInterval);
			this.bridgeLogDrainInterval = null;
		}
		await this.cdpClient?.close();
		if (this.amazonProcess && !this.amazonProcess.killed) {
			this.amazonProcess.kill();
		}
		this.amazonProcess = null;
		this.started = false;
		this.log("info", "Launcher worker stopped.");
	}

	/**
	 * Executes one typed command through the internal Player bridge.
	 */
	public async sendCommand(command: AmazonCommand): Promise<unknown> {
		if (!this.cdpClient) {
			throw new Error("CDP client not initialized.");
		}
		const mapped = mapCommandToBridge(command);
		if (mapped.nativeExecute) {
			return this.cdpClient.evaluate(buildBridgeExecuteExpression(mapped.nativeExecute, mapped.args ?? []), 12000);
		}
		return this.cdpClient.evaluate(buildPlayerCallExpression(mapped.method, mapped.args ?? []), 12000);
	}

	/**
	 * Navigates Amazon's hidden route context.
	 */
	public async navigate(path: string): Promise<unknown> {
		if (!this.cdpClient) {
			throw new Error("CDP client not initialized.");
		}
		return this.cdpClient.evaluate(buildNavigateExpression(path), 12000);
	}

	/**
	 * Performs Amazon search commits in the hidden app context.
	 */
	public async search(query: string): Promise<SearchResultsDto> {
		if (!this.cdpClient) {
			throw new Error("CDP client not initialized.");
		}
		await this.cdpClient.evaluate(buildSearchExpression(query), 12000);
		return { query, items: [] };
	}

	/**
	 * Returns the most recently emitted state for host hydration.
	 */
	public getCachedState(): PlayerStateDto {
		return this.latestState;
	}

	/**
	 * Ensures Amazon is running with debugging enabled.
	 */
	private async ensureAmazonRunning(): Promise<void> {
		if (!this.config) {
			throw new Error("Worker config missing.");
		}
		const hasLiveTarget = await this.hasMorphoTarget();
		if (hasLiveTarget) {
			this.log("info", "Reusing existing Amazon CDP target.");
			return;
		}
		this.amazonProcess = spawn(this.config.amazonExePath, [`--remote-debugging-port=${this.config.debugPort}`], {
			stdio: "ignore",
			detached: false,
			windowsHide: false,
		});
		this.log("info", `Spawned Amazon Music process pid=${this.amazonProcess.pid ?? "unknown"}.`);
	}

	/**
	 * Waits until Vuex store/player module are ready before polling.
	 */
	private async waitForStoreReady(): Promise<void> {
		if (!this.cdpClient) {
			throw new Error("CDP client not initialized.");
		}
		const expression = `
(function() {
	try {
		if (typeof window.__amazon_require__ !== "function") return false;
		if (!window.App || !window.App.$store || !window.App.$store.state) return false;
		return true;
	} catch (e) {
		return false;
	}
})()
`.trim();

		for (let attempt = 0; attempt < 40; attempt += 1) {
			const ready = await this.cdpClient.evaluate(expression, 1000);
			if (ready === true) {
				this.log("info", "Amazon Vuex store/player is ready.");
				return;
			}
			await new Promise<void>((resolve) => setTimeout(resolve, 200));
		}
		this.log("warn", "Timed out waiting for Amazon Vuex store; proceeding cautiously.");
	}

	/**
	 * Waits for in-page prerequisites needed by the injected extension UI.
	 * This prevents injecting too early and freezing Amazon Music.
	 */
	private async waitForExtensionPrereqs(): Promise<boolean> {
		if (!this.cdpClient) {
			throw new Error("CDP client not initialized.");
		}
		const expression = `
(function() {
	try {
		// Ensure require resolver + Vuex player module exist.
		if (typeof window.__amazon_require__ !== "function") return false;
		if (!window.App || !window.App.$store || !window.App.$store.state) return false;
		// We only require that the store/player tree is present.
		// The injected UI itself checks for optional player methods before calling them.
		var s = window.App.$store.state;
		if (!s.player || !s.player.model) return false;
		if (!document || !document.body) return false;
		return true;
	} catch (e) {
		return false;
	}
})()
`.trim();

		for (let attempt = 0; attempt < 120; attempt += 1) {
			const ok = await this.cdpClient.evaluate(expression, 2000);
			if (ok === true) {
				return true;
			}
			await new Promise<void>((resolve) => setTimeout(resolve, 250));
		}
		this.log("warn", "Timed out waiting for extension prerequisites; skipping injection.");
		return false;
	}

	/**
	 * Tests whether localhost /json contains the Morpho target.
	 */
	private async hasMorphoTarget(): Promise<boolean> {
		if (!this.config) {
			return false;
		}
		try {
			const response = await fetch(`http://localhost:${this.config.debugPort}/json`);
			if (!response.ok) {
				return false;
			}
			const targets = (await response.json()) as Array<{ url?: string }>;
			return targets.some((target) => target.url?.includes("amazon.com/morpho"));
		} catch (_error) {
			return false;
		}
	}

	/**
	 * Re-hides Amazon window for a short stabilization period.
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
	 * Reads and parses one player-state snapshot from CDP.
	 */
	private async readState(): Promise<PlayerStateDto | null> {
		if (!this.cdpClient) {
			return null;
		}
		const rawState = await this.cdpClient.evaluate(buildStateExtractionExpression(), 5000);
		if (typeof rawState !== "string") {
			return null;
		}
		try {
			return JSON.parse(rawState) as PlayerStateDto;
		} catch (_error) {
			return null;
		}
	}

	/**
	 * Emits latest state snapshot to host process.
	 */
	private emitState(state: PlayerStateDto): void {
		this.latestState = state;
		const message: WorkerStateMessage = { type: "state", state };
		process.send?.(message);
	}

	/**
	 * Starts periodic bridge log drains to rotating app-data logs.
	 */
	private startBridgeLogDrainLoop(): void {
		if (this.bridgeLogDrainInterval) {
			clearInterval(this.bridgeLogDrainInterval);
		}
		this.bridgeLogDrainInterval = setInterval(() => {
			void this.drainBridgeLogs();
		}, 1000);
	}

	/**
	 * Drains buffered bridge logs from page context into file logger.
	 */
	private async drainBridgeLogs(): Promise<void> {
		if (!this.cdpClient || !this.bridgeLogger) {
			return;
		}
		try {
			const raw = await this.cdpClient.evaluate(buildBridgeLogDrainExpression());
			if (typeof raw !== "string") {
				return;
			}
			const entries = JSON.parse(raw) as Array<{ ts: number; args: unknown[] }>;
			for (const entry of entries) {
				this.bridgeLogger.write({
					timestamp: new Date(entry.ts).toISOString(),
					command: entry.args?.[0] ?? null,
					arg1: entry.args?.[1] ?? null,
					arg2: entry.args?.[2] ?? null,
					arg3: entry.args?.[3] ?? null,
				});
			}
		} catch (error) {
			this.log("warn", `Bridge log drain failed: ${String(error)}`);
		}
	}

	/**
	 * Emits log lines both to console and host process.
	 */
	private log(level: "info" | "warn" | "error", message: string): void {
		console.log(`[launcher:${level}] ${message}`);
		const payload: WorkerLogMessage = { type: "log", level, message };
		process.send?.(payload);
	}
}

const runtime = new LauncherWorkerRuntime();

/**
 * Handles host messages and returns request responses via IPC channel.
 */
process.on("message", async (message: WorkerRequestMessage | undefined) => {
	if (!message || message.type !== "request") {
		return;
	}
	const respond = (response: WorkerResponseMessage): void => {
		process.send?.(response);
	};
	try {
		switch (message.action) {
			case "setConfig": {
				const payload = message.payload as { config: MorphoConfig; userDataPath: string };
				runtime.setConfig(payload.config, payload.userDataPath);
				respond({ type: "response", id: message.id, ok: true, result: true });
				return;
			}
			case "start": {
				const result = await runtime.start();
				respond({ type: "response", id: message.id, ok: true, result });
				return;
			}
			case "stop": {
				await runtime.stop();
				respond({ type: "response", id: message.id, ok: true, result: true });
				return;
			}
			case "sendCommand": {
				const result = await runtime.sendCommand(message.payload as AmazonCommand);
				respond({ type: "response", id: message.id, ok: true, result });
				return;
			}
			case "navigate": {
				const result = await runtime.navigate(String(message.payload ?? ""));
				respond({ type: "response", id: message.id, ok: true, result });
				return;
			}
			case "search": {
				const result = await runtime.search(String(message.payload ?? ""));
				respond({ type: "response", id: message.id, ok: true, result });
				return;
			}
			default: {
				respond({ type: "response", id: message.id, ok: false, error: `Unknown action: ${String(message.action)}` });
			}
		}
	} catch (error) {
		respond({ type: "response", id: message.id, ok: false, error: String(error) });
	}
});

process.on("uncaughtException", (error) => {
	console.error("[launcher:error] uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
	console.error("[launcher:error] unhandledRejection", reason);
});
