import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
import { AmazonLauncherService } from "./amazonLauncher";
import { getDefaultLauncherConfig, validateAmazonExePath } from "./launcherConfig";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import { loadPersistedConfig, mergeConfig, savePersistedConfig } from "./configStore";

/**
 * Creates the launcher renderer window.
 */
function createWindow(): BrowserWindow {
	return new BrowserWindow({
		width: 1280,
		height: 860,
		minWidth: 980,
		minHeight: 640,
		backgroundColor: "#0b0f1a",
		webPreferences: {
			preload: join(__dirname, "../preload/preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
}

/**
 * Prompts the user to locate Amazon Music.exe when auto-detection fails.
 */
async function promptForAmazonExePath(): Promise<string | null> {
	const result = await dialog.showOpenDialog({
		title: "Locate Amazon Music executable",
		properties: ["openFile"],
		filters: [{ name: "Executable", extensions: ["exe"] }],
	});
	if (result.canceled || !result.filePaths[0]) {
		return null;
	}
	return result.filePaths[0];
}

/**
 * Boots the Electron app and wires the launcher services.
 */
async function bootstrap(): Promise<void> {
	const defaults = getDefaultLauncherConfig();
	const persisted = loadPersistedConfig(app.getPath("userData"));
	let config = mergeConfig(defaults, persisted);

	let validation = validateAmazonExePath(config.amazonExePath);
	if (!validation.ok) {
		const selectedPath = await promptForAmazonExePath();
		if (!selectedPath) {
			void dialog.showErrorBox("Amazon Music not found", validation.message || "Missing executable path.");
			app.quit();
			return;
		}
		config = { ...config, amazonExePath: selectedPath };
		validation = validateAmazonExePath(config.amazonExePath);
		if (!validation.ok) {
			void dialog.showErrorBox("Invalid executable", validation.message || "Unable to use selected executable.");
			app.quit();
			return;
		}
		savePersistedConfig(app.getPath("userData"), { amazonExePath: selectedPath });
	}

	const mainWindow = createWindow();
	const launcher = new AmazonLauncherService(config);
	registerIpcHandlers(mainWindow, launcher);
	await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	const startResult = await launcher.start();
	if (config.hideAmazonWindow && !startResult.hiddenWindow) {
		mainWindow.webContents.send(
			"amazon:diagnostic",
			"Amazon Music launched and connected, but the native window could not be hidden automatically."
		);
	}

	app.on("before-quit", () => {
		void launcher.stop();
	});
}

app.whenReady().then(() => {
	void bootstrap().catch((error) => {
		void dialog.showErrorBox("Launcher startup failed", String(error));
		app.quit();
	});
});
