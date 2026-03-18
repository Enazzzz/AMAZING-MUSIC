import { existsSync } from "node:fs";

/**
 * Validates that the configured Amazon executable path is usable.
 */
export function validateAmazonExePath(exePath: string): { ok: boolean; message?: string } {
	if (!exePath.trim()) {
		return { ok: false, message: "Amazon Music executable path is empty." };
	}
	if (!existsSync(exePath)) {
		return { ok: false, message: `Amazon Music executable not found at ${exePath}` };
	}
	if (!exePath.toLowerCase().endsWith(".exe")) {
		return { ok: false, message: "Amazon executable must be a .exe file." };
	}
	return { ok: true };
}
