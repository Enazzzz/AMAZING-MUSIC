import { windowManager } from "node-window-manager";

/**
 * Heuristic matcher for Amazon Music desktop windows.
 */
function isAmazonWindow(windowTitle: string, executablePath: string): boolean {
	const normalizedTitle = windowTitle.toLowerCase();
	const normalizedPath = executablePath.toLowerCase();
	return (
		normalizedTitle === "amazon music" ||
		normalizedTitle.includes("amazon music") ||
		normalizedPath.endsWith("\\amazon music.exe") ||
		normalizedPath.includes("\\amazon music\\")
	);
}

/**
 * Tries to hide the Amazon Music window by title/path with retries.
 */
export async function hideAmazonMusicWindow(
	options: { targetProcessId?: number; maxAttempts?: number; delayMs?: number } = {}
): Promise<boolean> {
	const maxAttempts = options.maxAttempts ?? 40;
	const delayMs = options.delayMs ?? 500;
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const windows = windowManager.getWindows();
		for (const windowHandle of windows) {
			const title = windowHandle.getTitle();
			const executablePath = windowHandle.path || "";
			const pidMatch = options.targetProcessId != null && windowHandle.processId === options.targetProcessId;
			if (pidMatch || isAmazonWindow(title, executablePath)) {
				// A two-step call is more reliable on some Win32 hosts.
				windowHandle.minimize();
				windowHandle.hide();
				if (!windowHandle.isVisible()) {
					return true;
				}
			}
		}
		await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
	}
	return false;
}
