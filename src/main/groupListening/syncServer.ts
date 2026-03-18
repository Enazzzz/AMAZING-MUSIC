import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";

type ParticipantRole = "host" | "listener";

interface Participant {
	id: string;
	role: ParticipantRole;
	roomCode: string;
	name: string;
	socket: WebSocket;
}

interface RoomState {
	hostId: string | null;
	listeners: Map<string, Participant>;
}

type IncomingMessage =
	| { type: "join"; role: ParticipantRole; roomCode: string; name: string }
	| { type: "chat"; roomCode: string; from: string; message: string }
	| { type: "hostState"; roomCode: string; payload: Record<string, unknown> };

/**
 * Provides a lightweight group-listening room server (host + listeners).
 */
export class GroupListeningServer {
	private server: WebSocketServer | null = null;
	private readonly participants = new Map<string, Participant>();
	private readonly rooms = new Map<string, RoomState>();

	/**
	 * Starts a websocket server if one is not already running.
	 */
	public start(port: number): void {
		if (this.server) return;

		this.server = new WebSocketServer({ port });
		this.server.on("connection", (socket) => {
			const id = randomUUID();
			socket.on("message", (raw) => {
				void this.handleMessage(id, socket, String(raw));
			});
			socket.on("close", () => {
				this.removeParticipant(id);
			});
		});
	}

	/**
	 * Stops the websocket server and clears in-memory rooms.
	 */
	public stop(): void {
		this.server?.close();
		this.server = null;
		this.participants.clear();
		this.rooms.clear();
	}

	/**
	 * Sends a JSON payload to every participant in a given room.
	 */
	private broadcastToRoom(roomCode: string, message: Record<string, unknown>): void {
		const room = this.rooms.get(roomCode);
		if (!room) return;

		const serialized = JSON.stringify(message);

		if (room.hostId) {
			const host = this.participants.get(room.hostId);
			if (host) host.socket.send(serialized);
		}

		for (const listener of room.listeners.values()) {
			listener.socket.send(serialized);
		}
	}

	/**
	 * Handles one JSON message from a socket.
	 */
	private async handleMessage(participantId: string, socket: WebSocket, raw: string): Promise<void> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (_error) {
			return;
		}
		if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return;

		const message = parsed as IncomingMessage;

		if (message.type === "join") {
			const room = this.rooms.get(message.roomCode) || { hostId: null, listeners: new Map<string, Participant>() };
			const name = String(message.name || "Anonymous");

			const participant: Participant = {
				id: participantId,
				role: message.role,
				roomCode: message.roomCode,
				name,
				socket,
			};

			// If they re-join, overwrite.
			this.participants.set(participantId, participant);

			if (message.role === "host") {
				room.hostId = participantId;
			} else {
				room.listeners.set(participantId, participant);
			}

			this.rooms.set(message.roomCode, room);
			return;
		}

		if (message.type === "chat") {
			this.broadcastToRoom(message.roomCode, { type: "chat", from: message.from, message: message.message });
			return;
		}

		if (message.type === "hostState") {
			// Only accept host-originated sync messages from the currently registered host.
			const participant = this.participants.get(participantId);
			if (!participant || participant.role !== "host") return;
			if (participant.roomCode !== message.roomCode) return;
			this.broadcastToRoom(message.roomCode, { type: "hostState", payload: message.payload });
			return;
		}
	}

	/**
	 * Removes a participant from server bookkeeping.
	 */
	private removeParticipant(participantId: string): void {
		const participant = this.participants.get(participantId);
		if (!participant) return;

		const room = this.rooms.get(participant.roomCode);
		if (room) {
			if (room.hostId === participantId) room.hostId = null;
			room.listeners.delete(participantId);
		}

		this.participants.delete(participantId);
	}
}
