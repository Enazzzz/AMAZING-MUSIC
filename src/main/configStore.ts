import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MorphoConfig } from "../shared/types";

/**
 * Provides default app-level persistent configuration values.
 */
function getDefaultConfig(): MorphoConfig {
	return {
		amazonExePath: join(homedir(), "AppData", "Local", "Amazon Music", "Amazon Music.exe"),
		debugPort: 9222,
		pollMs: 250,
		hideAmazonWindow: true,
		autostartWithWindows: false,
		audioQuality: "ULTRA_HD",
		groupListening: {
			enabled: false,
			host: "0.0.0.0",
			port: 43843,
		},
	};
}

/**
 * Returns the persisted config file location in userData.
 */
function getConfigPath(): string {
	return join(app.getPath("userData"), "morpho-config.json");
}

/**
 * Reads current persisted app configuration.
 */
export function getConfig(): MorphoConfig {
	const filePath = getConfigPath();
	if (!existsSync(filePath)) {
		return getDefaultConfig();
	}
	try {
		const raw = readFileSync(filePath, "utf8");
		return {
			...getDefaultConfig(),
			...(JSON.parse(raw) as MorphoConfig),
		};
	} catch (_error) {
		return getDefaultConfig();
	}
}

/**
 * Updates config using a partial patch while preserving structure.
 */
export function setConfig(patch: Partial<MorphoConfig>): MorphoConfig {
	const current = getConfig();
	const merged: MorphoConfig = {
		...current,
		...patch,
		groupListening: {
			...current.groupListening,
			...(patch.groupListening ?? {}),
		},
	};
	const filePath = getConfigPath();
	const parent = dirname(filePath);
	if (!existsSync(parent)) {
		mkdirSync(parent, { recursive: true });
	}
	writeFileSync(filePath, JSON.stringify(merged, null, 2), "utf8");
	return merged;
}
