import { contextBridge, ipcRenderer } from "electron";
import type { AmazonCommand, PlayerStateDto, SearchResultsDto } from "../shared/types";

/**
 * Typed API exposed to the isolated renderer context.
 */
interface AmazonBridgeApi {
	getState(): Promise<PlayerStateDto>;
	sendCommand(command: AmazonCommand): Promise<unknown>;
	navigate(path: string): Promise<unknown>;
	search(query: string): Promise<SearchResultsDto>;
	listActions(): Promise<string[]>;
	listMutations(): Promise<string[]>;
	clickControl(control: "next" | "previous" | "playPause" | "shuffle" | "repeat"): Promise<unknown>;
	onStateUpdate(listener: (state: PlayerStateDto) => void): () => void;
	onDiagnostic(listener: (message: string) => void): () => void;
}

/**
 * Concrete preload bridge implementation that wraps IPC channels.
 */
const api: AmazonBridgeApi = {
	getState() {
		return ipcRenderer.invoke("amazon:getState");
	},
	sendCommand(command) {
		return ipcRenderer.invoke("amazon:command", command);
	},
	navigate(path) {
		return ipcRenderer.invoke("amazon:navigate", path);
	},
	search(query) {
		return ipcRenderer.invoke("amazon:search", query);
	},
	listActions() {
		return ipcRenderer.invoke("amazon:listActions");
	},
	listMutations() {
		return ipcRenderer.invoke("amazon:listMutations");
	},
	clickControl(control) {
		return ipcRenderer.invoke("amazon:clickControl", control);
	},
	onStateUpdate(listener) {
		const handler = (_event: Electron.IpcRendererEvent, state: PlayerStateDto) => listener(state);
		ipcRenderer.on("amazon:stateUpdate", handler);
		return () => {
			ipcRenderer.removeListener("amazon:stateUpdate", handler);
		};
	},
	onDiagnostic(listener) {
		const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message);
		ipcRenderer.on("amazon:diagnostic", handler);
		return () => {
			ipcRenderer.removeListener("amazon:diagnostic", handler);
		};
	},
};

contextBridge.exposeInMainWorld("amazonBridge", api);

declare global {
	interface Window {
		amazonBridge: AmazonBridgeApi;
	}
}
