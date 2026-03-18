import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Represents static discovery output for one bridge namespace.
 */
interface StaticDiscovery {
	namespace: "Library" | "Media" | "User" | "Playback" | "Player";
	methods: string[];
}

/**
 * Extracts unique execute namespace methods from exported Amazon app bundle.
 */
function extractMethods(bundle: string, namespace: StaticDiscovery["namespace"]): string[] {
	const pattern = new RegExp(`execute\\(\\"${namespace}\\.([a-zA-Z0-9_]+)\\"`, "g");
	const methods = new Set<string>();
	let match = pattern.exec(bundle);
	while (match) {
		methods.add(match[1]);
		match = pattern.exec(bundle);
	}
	return [...methods].sort();
}

/**
 * Writes a bridge API map markdown file for implementation and TODO probes.
 */
function writeBridgeMap(
	outputPath: string,
	discoveries: StaticDiscovery[],
	hasSizeParams: boolean,
	ratingMethods: string[],
	eqMethods: string[]
): void {
	const lines: string[] = [];
	lines.push("# Bridge API Map");
	lines.push("");
	lines.push("Generated from static analysis of `exported/app.js`.");
	lines.push("");
	lines.push("## Static execute(...) Namespace Methods");
	lines.push("");
	for (const discovery of discoveries) {
		lines.push(`### ${discovery.namespace}`);
		lines.push("");
		if (discovery.methods.length === 0) {
			lines.push("- none detected");
		} else {
			for (const method of discovery.methods) {
				lines.push(`- ${discovery.namespace}.${method}`);
			}
		}
		lines.push("");
	}
	lines.push("## Targeted Discovery Notes");
	lines.push("");
	lines.push(`- Album art URL size params detected: ${hasSizeParams ? "yes" : "no"}`);
	lines.push(`- Rating calls detected: ${ratingMethods.length ? ratingMethods.join(", ") : "none"}`);
	lines.push(`- EQ or DSP-related calls detected: ${eqMethods.length ? eqMethods.join(", ") : "none"}`);
	lines.push("");
	lines.push("## TODO Probes");
	lines.push("");
	lines.push("- Probe `Library.getPlaylistBrowsePage` and `Library.changePageOffset` for full playlist track list pagination.");
	lines.push("- Probe album art URL rewriting patterns (`._SX400_`, `._UX400_`) and force highest stable size.");
	lines.push("- Probe `Player.rateEntity` argument shape from runtime intercept logs (entity id, direction, context).");
	lines.push("- Probe EQ/DSP bridge names by runtime intercept during settings interactions.");
	lines.push("- Validate whether `User.*` or `Playback.*` execute calls are hidden behind dynamic command strings.");
	lines.push("");
	const outputDir = dirname(outputPath);
	if (!existsSync(outputDir)) {
		mkdirSync(outputDir, { recursive: true });
	}
	writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

/**
 * Runs static bridge discovery against exported/app.js and writes docs output.
 */
export function runStaticBridgeDiscovery(projectRoot: string): { foundBundle: boolean; outputPath: string } {
	const bundlePath = join(projectRoot, "exported", "app.js");
	const outputPath = join(projectRoot, "docs", "bridge-api-map.md");
	if (!existsSync(bundlePath)) {
		writeBridgeMap(
			outputPath,
			[
				{ namespace: "Library", methods: [] },
				{ namespace: "Media", methods: [] },
				{ namespace: "User", methods: [] },
				{ namespace: "Playback", methods: [] },
				{ namespace: "Player", methods: [] },
			],
			false,
			[],
			[]
		);
		return { foundBundle: false, outputPath };
	}
	const bundle = readFileSync(bundlePath, "utf8");
	const discoveries: StaticDiscovery[] = [
		{ namespace: "Library", methods: extractMethods(bundle, "Library") },
		{ namespace: "Media", methods: extractMethods(bundle, "Media") },
		{ namespace: "User", methods: extractMethods(bundle, "User") },
		{ namespace: "Playback", methods: extractMethods(bundle, "Playback") },
		{ namespace: "Player", methods: extractMethods(bundle, "Player") },
	];
	const hasSizeParams = /\._S[X|Y]\d+_|\._U[X|Y]\d+_/g.test(bundle);
	const ratingMethods = discoveries
		.find((entry) => entry.namespace === "Player")
		?.methods.filter((method) => method.toLowerCase().includes("rate")) ?? [];
	const eqMethods = discoveries
		.flatMap((entry) => entry.methods.map((method) => `${entry.namespace}.${method}`))
		.filter((method) => /eq|dsp|equalizer/i.test(method));
	writeBridgeMap(outputPath, discoveries, hasSizeParams, ratingMethods, eqMethods);
	return { foundBundle: true, outputPath };
}
