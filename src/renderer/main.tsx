import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@renderer/app";
import "@renderer/styles.css";

/**
 * Boots the React renderer root for the Morpho desktop shell.
 */
function bootstrapRenderer(): void {
	const root = document.getElementById("root");
	if (!root) {
		throw new Error("Renderer root element is missing.");
	}
	ReactDOM.createRoot(root).render(
		<React.StrictMode>
			<App />
		</React.StrictMode>
	);
}

bootstrapRenderer();
