import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CdpClient } from "../main/cdp/cdpClient";
import {
	buildEnsureRequireExpression,
	buildNetworkInterceptionExpression,
	buildNetworkLogDrainExpression,
} from "../main/cdp/amazonBridge";

interface CdpEventEntry {
	ts: number;
	source: "cdp";
	method: string;
	params: unknown;
}

interface InPageEntry {
	ts: number;
	source: "inpage";
	kind: string;
	method?: string;
	url?: string;
	status?: number;
	ok?: boolean;
	durationMs?: number;
	requestBodySnippet?: string | null;
	responseSnippet?: string | null;
	error?: string;
}

function getArg(name: string, defaultValue?: string): string | undefined {
	const raw = process.argv.find((v) => v.startsWith(`${name}=`));
	if (!raw) return defaultValue;
	const [, value] = raw.split("=");
	return value;
}

function getArgInt(name: string, defaultValue: number): number {
	const raw = getArg(name, String(defaultValue));
	const n = Number(raw);
	return Number.isFinite(n) ? n : defaultValue;
}

function asJsonLine(entry: unknown): string {
	return `${JSON.stringify(entry)}\n`;
}

async function safeGetResponseBody(cdp: CdpClient, requestId: string): Promise<{
	bodySnippet: string | null;
	base64Encoded: boolean;
}> {
	try {
		const result = (await cdp.sendCommand("Network.getResponseBody", { requestId }, 5000)) as
			| { body?: string; base64Encoded?: boolean }
			| undefined;
		const bodyRaw = typeof result?.body === "string" ? result.body : "";
		return {
			bodySnippet: bodyRaw ? bodyRaw.slice(0, 12000) : null,
			base64Encoded: !!result?.base64Encoded,
		};
	} catch (_error) {
		return { bodySnippet: null, base64Encoded: false };
	}
}

async function main(): Promise<void> {
	const debugPort = getArgInt("--debugPort", 9222);
	const durationMs = getArgInt("--durationMs", 30000);
	const outputDir = getArg("--outputDir", "logs") ?? "logs";

	const cdp = new CdpClient(debugPort);
	await cdp.connect();
	await cdp.sendCommand("Page.enable");
	await cdp.sendCommand("Runtime.enable");
	await cdp.sendCommand("Network.enable", {});
	await cdp.sendCommand("Network.setCacheDisabled", { cacheDisabled: true });
	await cdp.sendCommand("Network.setBypassServiceWorker", { bypass: true });

	await cdp.evaluate(buildEnsureRequireExpression(), 10000);
	const interceptResult = await cdp.evaluate(buildNetworkInterceptionExpression(), 10000);
	console.log(`[home-recon] in-page intercept: ${String(interceptResult)}`);

	const events: CdpEventEntry[] = [];
	const responseByRequestId = new Map<
		string,
		{ url: string; method: string; status: number; mimeType?: string }
	>();

	const stopListening = cdp.onEvent((event) => {
		if (!event?.method || !event.method.startsWith("Network.")) return;
		events.push({
			ts: Date.now(),
			source: "cdp",
			method: event.method,
			params: event.params ?? null,
		});
		if (event.method === "Network.responseReceived") {
			const params = (event.params ?? {}) as {
				requestId?: string;
				request?: { method?: string; url?: string };
				response?: { url?: string; status?: number; mimeType?: string };
			};
			if (!params.requestId) return;
			responseByRequestId.set(params.requestId, {
				url: String(params.response?.url || params.request?.url || ""),
				method: String(params.request?.method || "GET"),
				status: Number(params.response?.status || 0),
				mimeType: params.response?.mimeType ? String(params.response.mimeType) : undefined,
			});
		}
	});

	console.log(`[home-recon] capturing for ${durationMs}ms. Open/scroll Home page now.`);
	await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
	stopListening();

	const cdpBodies: Array<Record<string, unknown>> = [];
	for (const event of events) {
		if (event.method !== "Network.loadingFinished") continue;
		const params = (event.params ?? {}) as { requestId?: string; encodedDataLength?: number };
		if (!params.requestId) continue;
		const info = responseByRequestId.get(params.requestId);
		if (!info) continue;
		const lowerMime = String(info.mimeType || "").toLowerCase();
		if (
			lowerMime.indexOf("json") < 0 &&
			lowerMime.indexOf("javascript") < 0 &&
			lowerMime.indexOf("text") < 0 &&
			lowerMime.indexOf("graphql") < 0
		) {
			continue;
		}
		const body = await safeGetResponseBody(cdp, params.requestId);
		cdpBodies.push({
			ts: Date.now(),
			source: "cdp",
			kind: "responseBody",
			requestId: params.requestId,
			url: info.url,
			method: info.method,
			status: info.status,
			mimeType: info.mimeType || null,
			encodedDataLength: Number(params.encodedDataLength || 0),
			base64Encoded: body.base64Encoded,
			bodySnippet: body.bodySnippet,
		});
	}

	const rawInPage = await cdp.evaluate(buildNetworkLogDrainExpression(), 15000);
	let inPageEntries: InPageEntry[] = [];
	if (typeof rawInPage === "string") {
		try {
			const parsed = JSON.parse(rawInPage) as InPageEntry[];
			inPageEntries = Array.isArray(parsed) ? parsed : [];
		} catch (_error) {
			inPageEntries = [];
		}
	}

	mkdirSync(outputDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const outPath = join(outputDir, `home-network-recon-${stamp}.jsonl`);

	let payload = "";
	payload += asJsonLine({
		ts: Date.now(),
		source: "meta",
		kind: "session",
		debugPort,
		durationMs,
		cdpEvents: events.length,
		inPageEvents: inPageEntries.length,
		cdpBodies: cdpBodies.length,
	});
	for (const event of events) payload += asJsonLine(event);
	for (const body of cdpBodies) payload += asJsonLine(body);
	for (const event of inPageEntries) payload += asJsonLine(event);

	writeFileSync(outPath, payload, "utf8");
	console.log(`[home-recon] wrote ${outPath}`);
	await cdp.close();
}

void main().catch((error) => {
	console.error("[home-recon] failed:", error);
	process.exit(1);
});
