import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Runtime configuration for launching and controlling Amazon Music.
 */
export interface LauncherConfig {
	amazonExePath: string;
	debugPort: number;
	statePollMs: number;
	startupRetryCount: number;
	hideAmazonWindow: boolean;
}

/**
 * Returns default launcher values for a typical Windows setup.
 */
export function getDefaultLauncherConfig(): LauncherConfig {
	return {
		amazonExePath: join(homedir(), "AppData", "Local", "Amazon Music", "Amazon Music.exe"),
		debugPort: 9222,
		statePollMs: 750,
		startupRetryCount: 40,
		// Keep Amazon visible during debugging sessions.
		hideAmazonWindow: false,
	};
}

/**
 * Validates the configured Amazon executable path.
 */
export function validateAmazonExePath(exePath: string): { ok: boolean; message?: string } {
	if (!exePath.trim()) {
		return { ok: false, message: "Amazon Music executable path is empty." };
	}
	if (!existsSync(exePath)) {
		return { ok: false, message: `Amazon Music executable not found: ${exePath}` };
	}
	return { ok: true };
}
