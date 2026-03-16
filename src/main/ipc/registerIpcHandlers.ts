import { ipcMain, BrowserWindow } from "electron";
import type { AmazonLauncherService } from "../amazonLauncher";
import type { AmazonCommand } from "../../shared/types";

/**
 * Re-registers a handler safely across app reloads.
 */
function replaceHandler(channel: string, handler: Parameters<typeof ipcMain.handle>[1]): void {
	ipcMain.removeHandler(channel);
	ipcMain.handle(channel, handler);
}

/**
 * Registers IPC contracts consumed by the renderer custom UI.
 */
export function registerIpcHandlers(mainWindow: BrowserWindow, launcher: AmazonLauncherService): void {
	replaceHandler("amazon:getState", async () => {
		return launcher.getCachedState();
	});

	replaceHandler("amazon:command", async (_event, command: AmazonCommand) => {
		return launcher.sendCommand(command);
	});

	replaceHandler("amazon:navigate", async (_event, path: string) => {
		return launcher.navigate(path);
	});

	replaceHandler("amazon:search", async (_event, query: string) => {
		return launcher.search(query);
	});

	replaceHandler("amazon:listActions", async () => {
		return launcher.listActions();
	});

	replaceHandler("amazon:listMutations", async () => {
		return launcher.listMutations();
	});

	replaceHandler("amazon:clickControl", async (_event, control: "next" | "previous" | "playPause" | "shuffle" | "repeat") => {
		return launcher.clickControl(control);
	});

	launcher.subscribe((state) => {
		mainWindow.webContents.send("amazon:stateUpdate", state);
	});
}
