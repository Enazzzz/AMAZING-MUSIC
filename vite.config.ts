import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * Provides renderer bundling settings for the Morpho React UI.
 */
export default defineConfig({
	plugins: [react()],
	root: ".",
	build: {
		outDir: "dist/renderer",
		emptyOutDir: false,
	},
	resolve: {
		alias: {
			"@renderer": resolve(__dirname, "src/renderer"),
			"@shared": resolve(__dirname, "src/shared"),
		},
	},
});
