import WebSocket from "ws";

/**
 * CDP target entry from GET /json.
 */
interface CdpTarget {
	url?: string;
	webSocketDebuggerUrl?: string;
}

/**
 * Message envelope for Runtime.evaluate requests.
 */
interface CdpEvaluateMessage {
	id: number;
	method: "Runtime.evaluate";
	params: {
		expression: string;
		returnByValue: true;
	};
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}

/**
 * Creates a Runtime.evaluate request with returnByValue enabled.
 */
export function createCdpMessage(id: number, expression: string): CdpEvaluateMessage {
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
 * Reads the nested value field from a CDP Runtime.evaluate response.
 */
export function parseEvaluateValue(response: unknown): unknown {
	const maybeResponse = response as {
		result?: {
			result?: {
				value?: unknown;
			};
		};
	};
	if (!maybeResponse?.result?.result || !("value" in maybeResponse.result.result)) {
		return null;
	}
	return maybeResponse.result.result.value ?? null;
}

/**
 * Extracts a protocol-level error message from a CDP response.
 */
export function extractCdpError(response: unknown): string | null {
	const maybeResponse = response as {
		error?: {
			message?: string;
		};
	};
	const message = maybeResponse?.error?.message;
	return typeof message === "string" && message.length > 0 ? message : null;
}

/**
 * Resolves the devtools websocket URL for the Morpho target.
 */
async function resolveMorphoWsUrl(port: number): Promise<string> {
	const response = await fetch(`http://localhost:${port}/json`);
	if (!response.ok) {
		throw new Error(`CDP target discovery failed with status ${response.status}`);
	}
	const targets = (await response.json()) as CdpTarget[];
	for (const target of targets) {
		if (target.url?.includes("amazon.com/morpho") && target.webSocketDebuggerUrl) {
			return target.webSocketDebuggerUrl;
		}
	}
	throw new Error("Could not find Amazon Morpho target in CDP /json list.");
}

/**
 * Waits for the Morpho target to become available, retrying with delays.
 */
async function waitForMorphoWsUrl(port: number, retries: number, delayMs: number): Promise<string> {
	let lastError: unknown = null;
	for (let attempt = 0; attempt < retries; attempt += 1) {
		try {
			return await resolveMorphoWsUrl(port);
		} catch (error) {
			lastError = error;
			await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
		}
	}
	throw new Error(`Unable to resolve Morpho websocket URL after ${retries} attempts: ${String(lastError)}`);
}

/**
 * Minimal CDP client that only needs Runtime.evaluate.
 */
export class CdpClient {
	private ws: WebSocket | null = null;
	private nextId = 1;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly debugPort: number;

	/**
	 * Creates a new client pinned to a remote debugging port.
	 */
	public constructor(debugPort: number) {
		this.debugPort = debugPort;
	}

	/**
	 * Opens a websocket to the Morpho target and starts response routing.
	 */
	public async connect(retries = 40, delayMs = 500): Promise<void> {
		const wsUrl = await waitForMorphoWsUrl(this.debugPort, retries, delayMs);
		await new Promise<void>((resolve, reject) => {
			this.ws = new WebSocket(wsUrl);
			this.ws.on("open", () => resolve());
			this.ws.on("error", (error) => reject(error));
			this.ws.on("message", (message) => this.handleIncomingMessage(message.toString()));
			this.ws.on("close", () => {
				this.rejectAllPending(new Error("CDP websocket closed."));
				this.ws = null;
			});
		});
	}

	/**
	 * Closes the websocket cleanly.
	 */
	public async close(): Promise<void> {
		if (!this.ws) {
			this.rejectAllPending(new Error("CDP client closed."));
			return;
		}
		await new Promise<void>((resolve) => {
			const socket = this.ws;
			if (!socket) {
				resolve();
				return;
			}
			socket.once("close", () => resolve());
			socket.close();
		});
		this.ws = null;
	}

	/**
	 * Sends a Runtime.evaluate command and resolves its returnByValue result.
	 */
	public async evaluate(expression: string): Promise<unknown> {
		if (!this.ws) {
			throw new Error("CDP client is not connected.");
		}
		const id = this.nextId;
		this.nextId += 1;
		const message = createCdpMessage(id, expression);
		const payload = JSON.stringify(message);
		const responsePromise = new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP evaluate timed out for request ${id}.`));
			}, 7000);
			this.pending.set(id, { resolve, reject, timeout });
		});
		this.ws.send(payload, (error) => {
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
	 * Handles CDP inbound frames and resolves waiting evaluate calls.
	 */
	private handleIncomingMessage(raw: string): void {
		let message: unknown;
		try {
			message = JSON.parse(raw);
		} catch (_error) {
			return;
		}
		const maybeId = (message as { id?: number }).id;
		if (typeof maybeId !== "number") {
			return;
		}
		const pending = this.pending.get(maybeId);
		if (!pending) {
			return;
		}
		clearTimeout(pending.timeout);
		this.pending.delete(maybeId);
		const protocolError = extractCdpError(message);
		if (protocolError) {
			pending.reject(new Error(`CDP protocol error: ${protocolError}`));
			return;
		}
		pending.resolve(parseEvaluateValue(message));
	}

	/**
	 * Rejects all unresolved requests, usually after socket close/failure.
	 */
	private rejectAllPending(error: Error): void {
		for (const [id, pending] of this.pending.entries()) {
			clearTimeout(pending.timeout);
			pending.reject(new Error(`${error.message} Pending request ${id} aborted.`));
			this.pending.delete(id);
		}
	}
}
