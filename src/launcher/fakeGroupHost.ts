import WebSocket from "ws";
import { randomBytes } from "node:crypto";

type HostJoinMessage = {
	type: "join";
	role: "host";
	roomCode: string;
	name: string;
};

type HostStateMessage = {
	type: "hostState";
	roomCode: string;
	payload: {
		trackId: string;
		isPlaying: boolean;
		currentTimeMs: number;
	};
};

type IncomingMessage = HostJoinMessage | HostStateMessage;

function escapeArg(s: string): string {
	return String(s ?? "").replace(/\s+/g, "");
}

function getArg(name: string, defaultValue?: string): string | undefined {
	const raw = process.argv.find((v) => v.startsWith(`${name}=`));
	if (!raw) return defaultValue;
	const [, value] = raw.split("=");
	return value;
}

function getArgInt(name: string, defaultValue?: number): number | undefined {
	const raw = getArg(name, defaultValue == null ? undefined : String(defaultValue));
	if (raw == null) return undefined;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

function genRoomCode(): string {
	// 6-character-ish uppercase code.
	return randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
}

async function main(): Promise<void> {
	const wsUrl = getArg("--wsUrl", "ws://127.0.0.1:43843");
	if (!wsUrl) throw new Error("Missing --wsUrl");

	const roomCode = getArg("--roomCode") ?? genRoomCode();
	const name = getArg("--name", "FakeHost") ?? "FakeHost";

	const intervalMs = getArgInt("--intervalMs", 250) ?? 250;
	const stepMs = getArgInt("--stepMs", intervalMs) ?? intervalMs;
	const startTimeMs = getArgInt("--startTimeMs", 0) ?? 0;
	const playFromStart = getArg("--isPlaying", "true")?.toLowerCase() === "true";

	const ws = new WebSocket(wsUrl);

	// Use a monotonic-ish clock by incrementing currentTimeMs ourselves,
	// which makes the test independent of local playback.
	let currentTimeMs = startTimeMs;
	let isPlaying = playFromStart;
	let interval: NodeJS.Timeout | null = null;

	const send = (message: IncomingMessage): void => {
		ws.send(JSON.stringify(message));
	};

	ws.on("open", () => {
		// Register as a host in the room.
		send({
			type: "join",
			role: "host",
			roomCode,
			name: escapeArg(name),
		});

		console.log(`[fake-host] connected. wsUrl=${wsUrl} roomCode=${roomCode} name=${name}`);

		interval = setInterval(() => {
			send({
				type: "hostState",
				roomCode,
				payload: {
					trackId: "fake-track",
					isPlaying,
					currentTimeMs,
				},
			});

			// Advance time. This simulates a real host's playback cursor.
			currentTimeMs += stepMs;
		}, intervalMs);
	});

	ws.on("close", () => {
		if (interval) clearInterval(interval);
		console.log("[fake-host] websocket closed");
	});

	ws.on("error", (err) => {
		console.error("[fake-host] websocket error:", err);
	});

	// Keep process alive.
	await new Promise<void>(() => {
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		ws.on("message", () => {});
	});
}

void main().catch((error) => {
	console.error("[fake-host] failed:", error);
	process.exit(1);
});

