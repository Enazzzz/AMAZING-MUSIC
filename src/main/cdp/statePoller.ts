import type { PlayerStateDto } from "../../shared/types";
import { EMPTY_PLAYER_STATE } from "../../shared/types";

/**
 * Defines the callback contract used to fetch a fresh player state snapshot.
 */
type SnapshotReader = () => Promise<PlayerStateDto | null>;

/**
 * Defines the callback contract used to emit state updates.
 */
type StateEmitter = (state: PlayerStateDto) => void;

/**
 * Provides a fixed-interval diff-based polling loop for CDP player state.
 */
export class StatePoller {
	private readonly readSnapshot: SnapshotReader;
	private readonly emitUpdate: StateEmitter;
	private readonly intervalMs: number;
	private timer: NodeJS.Timeout | null = null;
	private previousState: PlayerStateDto = EMPTY_PLAYER_STATE;
	private inFlight = false;

	/**
	 * Constructs a poller with state read and emit callbacks.
	 */
	public constructor(readSnapshot: SnapshotReader, emitUpdate: StateEmitter, intervalMs: number) {
		this.readSnapshot = readSnapshot;
		this.emitUpdate = emitUpdate;
		this.intervalMs = intervalMs;
	}

	/**
	 * Starts polling immediately and then every configured interval.
	 */
	public start(): void {
		this.stop();
		void this.tick();
		this.timer = setInterval(() => {
			void this.tick();
		}, this.intervalMs);
	}

	/**
	 * Stops any active polling timer.
	 */
	public stop(): void {
		if (!this.timer) {
			return;
		}
		clearInterval(this.timer);
		this.timer = null;
	}

	/**
	 * Returns the most recently accepted state snapshot.
	 */
	public getLatestState(): PlayerStateDto {
		return this.previousState;
	}

	/**
	 * Executes one polling cycle and emits only on state change.
	 */
	private async tick(): Promise<void> {
		if (this.inFlight) {
			return;
		}
		this.inFlight = true;
		try {
			const nextState = await this.readSnapshot();
			if (!nextState) {
				return;
			}
			const changed = JSON.stringify(nextState) !== JSON.stringify(this.previousState);
			if (!changed) {
				return;
			}
			this.previousState = nextState;
			this.emitUpdate(nextState);
		} catch (_error) {
			// Keep polling resilient to transient CDP failures.
		} finally {
			this.inFlight = false;
		}
	}
}
