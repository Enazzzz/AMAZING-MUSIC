import { contextBridge, ipcRenderer } from "electron";
import type { AmazonCommand, MorphoConfig, MorphoDiagnosticsEvent, PlayerStateDto, SearchResultsDto } from "../shared/types";

/**
 * Defines the typed renderer API exposed through contextBridge.
 */
interface MorphoBridgeApi {
	getState: () => Promise<PlayerStateDto>;
	sendCommand: (command: AmazonCommand) => Promise<unknown>;
	navigate: (path: string) => Promise<unknown>;
	search: (query: string) => Promise<SearchResultsDto>;
	getConfig: () => Promise<MorphoConfig>;
	setConfig: (patch: Partial<MorphoConfig>) => Promise<MorphoConfig>;
	validateAmazonPath: (path: string) => Promise<{ ok: boolean; message?: string }>;
	getUserDataPath: () => Promise<string>;
	onStateUpdate: (listener: (state: PlayerStateDto) => void) => () => void;
	onDiagnostic: (listener: (event: MorphoDiagnosticsEvent) => void) => () => void;
}

/**
 * Implements all preload-safe methods delegated to ipcRenderer.
 */
const api: MorphoBridgeApi = {
	getState: () => ipcRenderer.invoke("morpho:getState"),
	sendCommand: (command) => ipcRenderer.invoke("morpho:sendCommand", command),
	navigate: (path) => ipcRenderer.invoke("morpho:navigate", path),
	search: (query) => ipcRenderer.invoke("morpho:search", query),
	getConfig: () => ipcRenderer.invoke("morpho:getConfig"),
	setConfig: (patch) => ipcRenderer.invoke("morpho:setConfig", patch),
	validateAmazonPath: (path) => ipcRenderer.invoke("morpho:validateAmazonPath", path),
	getUserDataPath: () => ipcRenderer.invoke("morpho:getUserDataPath"),
	onStateUpdate: (listener) => {
		const handler = (_event: Electron.IpcRendererEvent, state: PlayerStateDto) => listener(state);
		ipcRenderer.on("morpho:stateUpdate", handler);
		return () => {
			ipcRenderer.removeListener("morpho:stateUpdate", handler);
		};
	},
	onDiagnostic: (listener) => {
		const handler = (_event: Electron.IpcRendererEvent, event: MorphoDiagnosticsEvent) => {
			// Mirror diagnostics into renderer DevTools console for easier debugging.
			const prefix = `[Morpho ${event.type.toUpperCase()}]`;
			if (event.type === "error") {
				// eslint-disable-next-line no-console
				console.error(prefix, event.message);
			} else if (event.type === "warn") {
				// eslint-disable-next-line no-console
				console.warn(prefix, event.message);
			} else {
				// eslint-disable-next-line no-console
				console.log(prefix, event.message);
			}
			listener(event);
		};
		ipcRenderer.on("morpho:diagnostic", handler);
		return () => {
			ipcRenderer.removeListener("morpho:diagnostic", handler);
		};
	},
};

contextBridge.exposeInMainWorld("morpho", api);

declare global {
	interface Window {
		morpho: MorphoBridgeApi;
	}
}
