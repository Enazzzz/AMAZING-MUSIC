/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ["./index.html", "./src/renderer/**/*.{ts,tsx}"],
	theme: {
		extend: {
			colors: {
				glass: "rgba(255,255,255,0.14)",
				panel: "rgba(17,24,39,0.46)",
			},
			boxShadow: {
				glass: "0 18px 46px rgba(0,0,0,0.3)",
			},
			backdropBlur: {
				xl: "20px",
			},
		},
	},
	plugins: [],
};
