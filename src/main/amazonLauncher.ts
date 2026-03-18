import { fork, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { App } from "electron";
import type { AmazonCommand, MorphoConfig, PlayerStateDto, SearchResultsDto } from "../shared/types";
import { EMPTY_PLAYER_STATE } from "../shared/types";

interface WorkerRequest {
	type: "request";
	id: number;
	action: "start" | "stop" | "sendCommand" | "navigate" | "search" | "setConfig";
	payload?: unknown;
}

interface WorkerResponse {
	type: "response";
	id: number;
	ok: boolean;
	result?: unknown;
	error?: string;
}

interface WorkerStateEvent {
	type: "state";
	state: PlayerStateDto;
}

interface WorkerLogEvent {
	type: "log";
	level: "info" | "warn" | "error";
	message: string;
}

type WorkerMessage = WorkerResponse | WorkerStateEvent | WorkerLogEvent;

/**
 * Hosts the isolated launcher worker process and proxies commands/states.
 */
export class AmazonLauncherService {
	private readonly app: App;
	private config: MorphoConfig;
	private workerProcess: ChildProcess | null = null;
	private readonly listeners = new Set<(state: PlayerStateDto) => void>();
	private latestState: PlayerStateDto = EMPTY_PLAYER_STATE;
	private requestId = 1;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timeout: NodeJS.Timeout;
		}
	>();

	/**
	 * Constructs launcher host with current app config.
	 */
	public constructor(app: App, config: MorphoConfig) {
		this.app = app;
		this.config = config;
	}

	/**
	 * Updates config and forwards it to worker if active.
	 */
	public setConfig(config: MorphoConfig): void {
		this.config = config;
		if (!this.workerProcess) {
			return;
		}
		void this.request("setConfig", {
			config: this.config,
			userDataPath: this.app.getPath("userData"),
		});
	}

	/**
	 * Starts worker process and launches Amazon/CDP lifecycle there.
	 */
	public async start(): Promise<{ hiddenWindow: boolean }> {
		await this.ensureWorker();
		return (await this.request("start")) as { hiddenWindow: boolean };
	}

	/**
	 * Stops worker process and clears pending requests.
	 */
	public async stop(): Promise<void> {
		if (!this.workerProcess) {
			return;
		}
		try {
			await this.request("stop");
		} catch (_error) {
			// Worker may already be shutting down.
		}
		this.workerProcess.kill();
		this.workerProcess = null;
		for (const [id, pending] of this.pending.entries()) {
			clearTimeout(pending.timeout);
			pending.reject(new Error(`Worker request ${id} aborted during shutdown.`));
			this.pending.delete(id);
		}
	}

	/**
	 * Returns current cached state for renderer hydration.
	 */
	public getCachedState(): PlayerStateDto {
		return this.latestState;
	}

	/**
	 * Subscribes to worker state events forwarded through host.
	 */
	public subscribe(listener: (state: PlayerStateDto) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Proxies typed command execution to the launcher worker.
	 */
	public async sendCommand(command: AmazonCommand): Promise<unknown> {
		return this.request("sendCommand", command);
	}

	/**
	 * Proxies hidden-route navigation to the worker.
	 */
	public async navigate(path: string): Promise<unknown> {
		return this.request("navigate", path);
	}

	/**
	 * Proxies search mutation call to worker.
	 */
	public async search(query: string): Promise<SearchResultsDto> {
		return (await this.request("search", query)) as SearchResultsDto;
	}

	/**
	 * Starts child process and configures message routing.
	 */
	private async ensureWorker(): Promise<void> {
		if (this.workerProcess && this.workerProcess.connected) {
			return;
		}
		const workerPath = join(__dirname, "../launcher/worker.js");
		this.workerProcess = fork(workerPath, [], {
			stdio: ["pipe", "inherit", "inherit", "ipc"],
		});
		this.workerProcess.on("message", (message) => this.handleWorkerMessage(message as WorkerMessage));
		this.workerProcess.on("exit", (code, signal) => {
			console.log(`[launcher-host] worker exited code=${String(code)} signal=${String(signal)}`);
			this.workerProcess = null;
		});
		await this.request("setConfig", {
			config: this.config,
			userDataPath: this.app.getPath("userData"),
		});
	}

	/**
	 * Routes worker events and resolves pending request promises.
	 */
	private handleWorkerMessage(message: WorkerMessage): void {
		if (message.type === "state") {
			this.latestState = message.state;
			for (const listener of this.listeners) {
				listener(message.state);
			}
			return;
		}
		if (message.type === "log") {
			console.log(`[launcher-worker:${message.level}] ${message.message}`);
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		clearTimeout(pending.timeout);
		this.pending.delete(message.id);
		if (!message.ok) {
			pending.reject(new Error(message.error ?? "Worker request failed."));
			return;
		}
		pending.resolve(message.result);
	}

	/**
	 * Sends one request to worker and resolves with response payload.
	 */
	private async request(action: WorkerRequest["action"], payload?: unknown): Promise<unknown> {
		if (!this.workerProcess || !this.workerProcess.connected) {
			throw new Error(`Worker unavailable for action: ${action}`);
		}
		const id = this.requestId;
		this.requestId += 1;
		const timeoutMs = action === "start" ? 120000 : action === "stop" ? 30000 : 20000;
		return new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Worker request timed out: ${action}`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timeout });
			const message: WorkerRequest = {
				type: "request",
				id,
				action,
				payload,
			};
			this.workerProcess?.send(message);
		});
	}
}
