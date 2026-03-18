import { CdpClient } from "../main/cdp/cdpClient";
import { buildEnsureRequireExpression, buildInjectMorphoExtensionExpression } from "../main/cdp/amazonBridge";

/**
 * Standalone CDP extension injector.
 * Usage:
 *   node dist/launcher/injectExtension.js --debugPort 9222 --wsUrl ws://127.0.0.1:43843 --waitMs 10000
 */
function getArgValue(name: string, defaultValue?: string): string | undefined {
	const raw = process.argv.find((v) => v.startsWith(`${name}=`));
	if (!raw) return defaultValue;
	const [, value] = raw.split("=");
	return value;
}

function getArgInt(name: string, defaultValue?: number): number | undefined {
	const raw = getArgValue(name, defaultValue == null ? undefined : String(defaultValue));
	if (raw == null) return undefined;
	const n = Number(raw);
	if (!Number.isFinite(n)) return undefined;
	return n;
}

function getArgNumberOrThrow(name: string): number {
	const v = getArgInt(name);
	if (v == null) throw new Error(`Missing/invalid argument: --${name}=number`);
	return v;
}

async function main(): Promise<void> {
	const debugPort = getArgInt("--debugPort", 9222);
    const wsUrl = process.argv.find((v) => v.startsWith("--wsUrl="))?.split("=")[1] ?? "ws://127.0.0.1:43843";
    const waitMs = Number(process.argv.find((v) => v.startsWith("--waitMs="))?.split("=")[1] ?? 10000);
    const timeoutMs = Number(process.argv.find((v) => v.startsWith("--timeoutMs="))?.split("=")[1] ?? 15000);

	const debugPortStart = getArgInt("--debugPortStart");
	const debugPortEnd = getArgInt("--debugPortEnd");

	// If Sandboxie isolation makes the debug port uncertain, we can scan a range.
	// This keeps the workflow simple: "run the same shortcut in each sandbox".
	const ports: number[] =
		debugPortStart != null && debugPortEnd != null
			? Array.from({ length: Math.abs(debugPortEnd - debugPortStart) + 1 }, (_, i) =>
					Math.min(debugPortStart, debugPortEnd) + i
				)
			: [debugPort ?? 9222];

	if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
		throw new Error(`Invalid --wsUrl. Expected ws://... got: ${wsUrl}`);
	}

	const errors: string[] = [];
	for (const port of ports) {
		console.log(`[inject-extension] trying debugPort=${port}`);
		const cdpClient = new CdpClient(port);
		try {
			// Keep port-scan fast. We only need the websocket to appear briefly; once connected we inject immediately.
			await cdpClient.connect(20, 300);

			// Ensure webpack require resolver exists for loading the Player module in injected code.
			await cdpClient.evaluate(buildEnsureRequireExpression(), timeoutMs);

			if (waitMs > 0) {
				await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
			}

			const result = await cdpClient.evaluate(buildInjectMorphoExtensionExpression(wsUrl), timeoutMs);
			console.log(`[inject-extension] injection result (port ${port}): ${String(result)}`);

			await cdpClient.close();
			return;
		} catch (error) {
			errors.push(`debugPort=${port}: ${String(error)}`);
			try {
				await cdpClient.close();
			} catch (_closeError) {
				// ignore
			}
		}
	}

	throw new Error(`Unable to inject extension. Tried ports: ${ports.join(", ")}. Errors:\n${errors.join("\n")}`);
}

void main().catch((error) => {
    console.error("[inject-extension] failed:", error);
    process.exit(1);
});

