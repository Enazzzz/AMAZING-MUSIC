import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Ensures destination directories exist before copying static assets.
 */
function ensureParent(path) {
	const parent = dirname(path);
	if (!existsSync(parent)) {
		mkdirSync(parent, { recursive: true });
	}
}

/**
 * Copies renderer static files into dist after TypeScript compilation.
 */
function copyRendererAssets() {
	const files = [
		{ from: resolve("src/renderer/index.html"), to: resolve("dist/renderer/index.html") },
		{ from: resolve("src/renderer/styles.css"), to: resolve("dist/renderer/styles.css") },
	];
	for (const entry of files) {
		ensureParent(entry.to);
		cpSync(entry.from, entry.to);
	}
}

copyRendererAssets();
