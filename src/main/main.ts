import { app, BrowserWindow, dialog, nativeTheme } from "electron";
import { getConfig, setConfig } from "./configStore";
import { validateAmazonExePath } from "./launcherConfig";
import { AmazonLauncherService } from "./amazonLauncher";
import { GroupListeningServer } from "./groupListening/syncServer";

/**
 * Creates a tiny hidden window to keep Electron alive.
 */
function createKeepAliveWindow(): BrowserWindow {
	return new BrowserWindow({
		width: 1,
		height: 1,
		show: false,
		skipTaskbar: true,
		frame: false,
		resizable: false,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
}

/**
 * Prompts for a valid Amazon Music executable when config path is invalid.
 */
async function promptForAmazonExePath(): Promise<string | null> {
	const selection = await dialog.showOpenDialog({
		title: "Select Amazon Music executable",
		properties: ["openFile"],
		filters: [{ name: "Executable", extensions: ["exe"] }],
	});
	if (selection.canceled || !selection.filePaths[0]) {
		return null;
	}
	return selection.filePaths[0];
}

/**
 * Bootstraps Electron app lifecycle, config validation, and launcher startup.
 */
async function bootstrap(): Promise<void> {
	nativeTheme.themeSource = "dark";
	const config = getConfig();

	// Sandboxie-compatible mode: run only the Group Listening server (no Amazon launch / no CDP worker).
	// This lets you run Amazon inside each sandbox independently and then inject the extension via the injector shortcut.
	const serverOnly = process.env.MORPHO_SERVER_ONLY === "1" || process.env.MORPHO_SKIP_AMAZON === "1";
	if (!serverOnly) {
		let exeValidation = validateAmazonExePath(config.amazonExePath);
		if (!exeValidation.ok) {
			const selectedPath = await promptForAmazonExePath();
			if (!selectedPath) {
				throw new Error(exeValidation.message ?? "Amazon Music executable path is required.");
			}
			setConfig({ amazonExePath: selectedPath });
			exeValidation = validateAmazonExePath(selectedPath);
			if (!exeValidation.ok) {
				throw new Error(exeValidation.message ?? "Invalid Amazon Music executable.");
			}
		}
	}

	const groupServer = new GroupListeningServer();
	groupServer.start(config.groupListening.port);

	// Morpho UI is intentionally disabled: Electron exists only to run the CDP launcher/extension injector.
	const keepAliveWindow = createKeepAliveWindow();

	const launcher = serverOnly ? null : new AmazonLauncherService(app, getConfig());
	if (launcher) {
		void launcher
			.start()
			.then((startResult) => {
				if (!startResult.hiddenWindow && getConfig().hideAmazonWindow) {
					console.warn("[Morpho] Amazon Music launched but its native window was not hidden automatically.");
				}
			})
			.catch((error) => {
				console.error("[Morpho] Amazon launcher failed to start:", error);
			});
	}

	app.on("before-quit", () => {
		if (launcher) {
			void launcher.stop();
		}
		groupServer.stop();
		keepAliveWindow.destroy();
	});
}

app.whenReady().then(() => {
	void bootstrap().catch((error) => {
		dialog.showErrorBox("Morpho startup failed", String(error));
		app.quit();
	});
});
