import { AnimatePresence, motion } from "framer-motion";

/**
 * Renders a lightweight, GPU-friendly dynamic background using gradients only.
 * This avoids heavy full-window image blurs that can cause freezes on some GPUs.
 */
export function DynamicBackground(props: { artUrl: string | null; accent: string }): JSX.Element {
	const { accent } = props;
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			<AnimatePresence mode="wait">
				<motion.div
					key={accent}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.8, ease: "easeInOut" }}
					className="absolute inset-0"
					style={{
						background: `
							radial-gradient(circle at 20% 0%, ${accent}55 0, transparent 45%),
							radial-gradient(circle at 80% 100%, ${accent}33 0, transparent 55%),
							radial-gradient(circle at 50% 50%, #020617 0, #020617 60%, #000 100%)
						`,
					}}
				/>
			</AnimatePresence>
		</div>
	);
}
