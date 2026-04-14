import WebSocket from "ws";

/**
 * Defines a CDP target descriptor entry returned by /json.
 */
interface CdpTarget {
	url?: string;
	webSocketDebuggerUrl?: string;
}

/**
 * Defines the evaluate command payload sent over CDP.
 */
interface EvaluateRequest {
	id: number;
	method: "Runtime.evaluate";
	params: {
		expression: string;
		returnByValue: true;
	};
}

/**
 * Defines the queued promise handlers for in-flight evaluate calls.
 */
interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}

/**
 * Defines a generic CDP command payload.
 */
interface CommandRequest {
	id: number;
	method: string;
	params?: Record<string, unknown>;
}

/**
 * Defines a routed CDP event frame.
 */
interface EventFrame {
	method: string;
	params?: Record<string, unknown>;
}

/**
 * Builds a Runtime.evaluate request object for CDP.
 */
function buildEvaluateRequest(id: number, expression: string): EvaluateRequest {
	return {
		id,
		method: "Runtime.evaluate",
		params: {
			expression,
			returnByValue: true,
		},
	};
}

/**
 * Resolves the Morpho debugging target websocket URL from /json.
 */
async function resolveMorphoSocketUrl(debugPort: number): Promise<string> {
	const response = await fetch(`http://localhost:${debugPort}/json`);
	if (!response.ok) {
		throw new Error(`CDP discovery failed with status ${response.status}.`);
	}
	const targets = (await response.json()) as CdpTarget[];
	const target = targets.find((entry) => entry.url?.includes("amazon.com/morpho") && entry.webSocketDebuggerUrl);
	if (!target?.webSocketDebuggerUrl) {
		throw new Error("Morpho target was not found in CDP discovery output.");
	}
	return target.webSocketDebuggerUrl;
}

/**
 * Waits for a Morpho websocket endpoint to appear with retries.
 */
async function waitForMorphoSocketUrl(debugPort: number, retryCount: number, retryDelayMs: number): Promise<string> {
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= retryCount; attempt += 1) {
		try {
			return await resolveMorphoSocketUrl(debugPort);
		} catch (error) {
			lastError = error;
			await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
		}
	}
	throw new Error(`Unable to discover Morpho target after ${retryCount} retries: ${String(lastError)}`);
}

/**
 * Implements a minimal CDP Runtime.evaluate websocket client.
 */
export class CdpClient {
	private socket: WebSocket | null = null;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly onDisconnectListeners = new Set<() => void>();
	private readonly eventListeners = new Set<(event: EventFrame) => void>();
	private nextMessageId = 1;
	private readonly debugPort: number;

	/**
	 * Constructs a CDP client bound to a single debugging port.
	 */
	public constructor(debugPort: number) {
		this.debugPort = debugPort;
	}

	/**
	 * Connects to the Morpho target and installs event routing handlers.
	 */
	public async connect(retryCount = 60, retryDelayMs = 500): Promise<void> {
		const socketUrl = await waitForMorphoSocketUrl(this.debugPort, retryCount, retryDelayMs);
		await new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(socketUrl);
			this.socket = ws;
			ws.once("open", () => resolve());
			ws.once("error", (error) => reject(error));
			ws.on("message", (data) => this.handleIncomingFrame(data.toString()));
			ws.on("close", () => {
				this.rejectPending(new Error("CDP websocket closed."));
				this.socket = null;
				for (const listener of this.onDisconnectListeners) {
					listener();
				}
			});
		});
	}

	/**
	 * Registers a callback that runs whenever the websocket disconnects.
	 */
	public onDisconnect(listener: () => void): () => void {
		this.onDisconnectListeners.add(listener);
		return () => {
			this.onDisconnectListeners.delete(listener);
		};
	}

	/**
	 * Evaluates a JavaScript expression inside the Morpho runtime.
	 */
	public async evaluate(expression: string, timeoutMs = 8000): Promise<unknown> {
		const request = buildEvaluateRequest(0, expression);
		return this.sendRequest(request, timeoutMs);
	}

	/**
	 * Sends a raw CDP command and resolves with the command result object.
	 */
	public async sendCommand(method: string, params?: Record<string, unknown>, timeoutMs = 8000): Promise<unknown> {
		const requestId = this.nextMessageId;
		const request: CommandRequest = { id: requestId, method, params };
		return this.sendRequest(request, timeoutMs);
	}

	/**
	 * Registers a callback for CDP event frames (messages without id).
	 */
	public onEvent(listener: (event: EventFrame) => void): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	/**
	 * Tries to reconnect once if the socket is not currently available.
	 */
	public async ensureConnected(): Promise<void> {
		if (this.socket) {
			return;
		}
		await this.connect();
	}

	/**
	 * Closes the websocket and rejects all pending requests.
	 */
	public async close(): Promise<void> {
		if (!this.socket) {
			this.rejectPending(new Error("CDP client closed."));
			return;
		}
		await new Promise<void>((resolve) => {
			const ws = this.socket;
			if (!ws) {
				resolve();
				return;
			}
			ws.once("close", () => resolve());
			ws.close();
		});
		this.socket = null;
	}

	/**
	 * Routes inbound websocket messages back to the correct pending request.
	 */
	private handleIncomingFrame(rawFrame: string): void {
		let frame: unknown;
		try {
			frame = JSON.parse(rawFrame);
		} catch (_error) {
			return;
		}
		const messageId = (frame as { id?: number }).id;
		if (typeof messageId !== "number") {
			const eventMethod = (frame as { method?: string }).method;
			if (typeof eventMethod === "string") {
				const eventFrame: EventFrame = {
					method: eventMethod,
					params: (frame as { params?: Record<string, unknown> }).params,
				};
				for (const listener of this.eventListeners) {
					listener(eventFrame);
				}
			}
			return;
		}
		const pending = this.pending.get(messageId);
		if (!pending) {
			return;
		}
		clearTimeout(pending.timeout);
		this.pending.delete(messageId);
		const protocolError = (frame as { error?: { message?: string } }).error?.message;
		if (protocolError) {
			pending.reject(new Error(`CDP protocol error: ${protocolError}`));
			return;
		}
		const value = (frame as { result?: { result?: { value?: unknown } } }).result?.result?.value ?? null;
		pending.resolve(value);
	}

	/**
	 * Sends a JSON CDP request and manages pending-timeout lifecycle.
	 */
	private async sendRequest(request: CommandRequest, timeoutMs: number): Promise<unknown> {
		if (!this.socket) {
			throw new Error("CDP client is not connected.");
		}
		const id = this.nextMessageId;
		this.nextMessageId += 1;
		request.id = id;
		const responsePromise = new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP request ${id} timed out after ${timeoutMs}ms.`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timeout });
		});
		this.socket.send(JSON.stringify(request), (error) => {
			if (!error) {
				return;
			}
			const pending = this.pending.get(id);
			if (!pending) {
				return;
			}
			clearTimeout(pending.timeout);
			this.pending.delete(id);
			pending.reject(error);
		});
		return responsePromise;
	}

	/**
	 * Rejects all pending evaluate promises after transport failure.
	 */
	private rejectPending(error: Error): void {
		for (const [id, pending] of this.pending.entries()) {
			clearTimeout(pending.timeout);
			pending.reject(new Error(`${error.message} requestId=${id}`));
			this.pending.delete(id);
		}
	}
}
