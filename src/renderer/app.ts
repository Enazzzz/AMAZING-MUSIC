type ControlType = "previous" | "playPause" | "next" | "shuffle" | "repeat";

function renderRemote(): void {
	const root = document.querySelector<HTMLDivElement>("#app");
	if (!root) {
		return;
	}
	root.innerHTML = `
		<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:16px;">
			<div style="font-size:18px;font-weight:600;">AMAZING MUSIC Remote</div>
			<div style="display:flex;gap:12px;">
				<button data-control="previous">⏮ Prev</button>
				<button data-control="playPause">⏯ Play / Pause</button>
				<button data-control="next">⏭ Next</button>
				<button data-control="shuffle">🔀 Shuffle</button>
				<button data-control="repeat">🔁 Repeat</button>
			</div>
			<div id="remote-log" style="font-size:12px;color:#95a6c7;"></div>
		</div>
	`;

	document.querySelectorAll<HTMLButtonElement>("[data-control]").forEach((button) => {
		button.addEventListener("click", () => {
			const type = button.dataset.control as ControlType;
			void runRemoteAction(type);
		});
	});
}

async function runRemoteAction(control: ControlType): Promise<void> {
	const logEl = document.querySelector<HTMLDivElement>("#remote-log");
	if (logEl) {
		logEl.textContent = `Sending control: ${control}...`;
	}
	try {
		await window.amazonBridge.clickControl(control);
		if (logEl) {
			logEl.textContent = `Clicked: ${control}`;
		}
	} catch (error) {
		if (logEl) {
			logEl.textContent = `Error for ${control}: ${String(error)}`;
		}
	}
}

renderRemote();
