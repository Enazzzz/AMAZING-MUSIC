import { ipcMain, type BrowserWindow, type App } from "electron";
import type { AmazonCommand, MorphoConfig } from "../../shared/types";
import { getConfig, setConfig } from "../configStore";
import { validateAmazonExePath } from "../launcherConfig";
import type { AmazonLauncherService } from "../amazonLauncher";

/**
 * Replaces an IPC handler to support reload-safe development sessions.
 */
function replaceHandler(channel: string, handler: Parameters<typeof ipcMain.handle>[1]): void {
	ipcMain.removeHandler(channel);
	ipcMain.handle(channel, handler);
}

/**
 * Registers all typed IPC contracts exposed through preload contextBridge.
 */
export function registerIpcHandlers(app: App, window: BrowserWindow, launcher: AmazonLauncherService): void {
	replaceHandler("morpho:getState", async () => launcher.getCachedState());
	replaceHandler("morpho:sendCommand", async (_event, command: AmazonCommand) => {
		try {
			return await launcher.sendCommand(command);
		} catch (error) {
			window.webContents.send("morpho:diagnostic", {
				type: "error",
				message: `Command failed (${command.type}): ${String(error)}`,
			});
			throw error;
		}
	});
	replaceHandler("morpho:navigate", async (_event, path: string) => launcher.navigate(path));
	replaceHandler("morpho:search", async (_event, query: string) => launcher.search(query));
	replaceHandler("morpho:getConfig", async () => getConfig());
	replaceHandler("morpho:setConfig", async (_event, patch: Partial<MorphoConfig>) => {
		const nextConfig = setConfig(patch);
		launcher.setConfig(nextConfig);
		return nextConfig;
	});
	replaceHandler("morpho:validateAmazonPath", async (_event, path: string) => validateAmazonExePath(path));
	replaceHandler("morpho:getUserDataPath", async () => app.getPath("userData"));

	launcher.subscribe((state) => {
		window.webContents.send("morpho:stateUpdate", state);
	});
}
