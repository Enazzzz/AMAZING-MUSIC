import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LauncherConfig } from "./launcherConfig";

/**
 * Shape stored in user-level launcher config JSON.
 */
interface PersistedLauncherConfig {
	amazonExePath?: string;
}

/**
 * Returns the full config file path under Electron userData directory.
 */
function getConfigPath(userDataDir: string): string {
	return join(userDataDir, "launcher-config.json");
}

/**
 * Loads persisted launcher overrides if available.
 */
export function loadPersistedConfig(userDataDir: string): PersistedLauncherConfig {
	const configPath = getConfigPath(userDataDir);
	if (!existsSync(configPath)) {
		return {};
	}
	try {
		const raw = readFileSync(configPath, "utf8");
		return JSON.parse(raw) as PersistedLauncherConfig;
	} catch (_error) {
		return {};
	}
}

/**
 * Persists launcher overrides for future app boots.
 */
export function savePersistedConfig(userDataDir: string, config: PersistedLauncherConfig): void {
	const configPath = getConfigPath(userDataDir);
	const parent = dirname(configPath);
	if (!existsSync(parent)) {
		mkdirSync(parent, { recursive: true });
	}
	writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Applies persisted values on top of runtime defaults.
 */
export function mergeConfig(defaults: LauncherConfig, persisted: PersistedLauncherConfig): LauncherConfig {
	return {
		...defaults,
		amazonExePath: persisted.amazonExePath || defaults.amazonExePath,
	};
}
