import { existsSync, mkdirSync, renameSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Stores persisted bridge-discovery log output with size-based rotation.
 */
export class BridgeDiscoveryLogger {
	private readonly directory: string;
	private readonly filePath: string;
	private readonly maxBytes: number;

	/**
	 * Creates a file logger rooted in the Electron userData path.
	 */
	public constructor(userDataPath: string, maxBytes = 10 * 1024 * 1024) {
		this.directory = join(userDataPath, "logs");
		this.filePath = join(this.directory, "bridge-discovery.log");
		this.maxBytes = maxBytes;
		if (!existsSync(this.directory)) {
			mkdirSync(this.directory, { recursive: true });
		}
	}

	/**
	 * Appends one JSONL entry and rotates when file size exceeds cap.
	 */
	public write(entry: Record<string, unknown>): void {
		this.rotateIfNeeded();
		appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
	}

	/**
	 * Renames the active log file with a timestamp once it grows too large.
	 */
	private rotateIfNeeded(): void {
		if (!existsSync(this.filePath)) {
			return;
		}
		const size = statSync(this.filePath).size;
		if (size < this.maxBytes) {
			return;
		}
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const rotatedPath = join(this.directory, `bridge-discovery-${timestamp}.log`);
		renameSync(this.filePath, rotatedPath);
	}
}
