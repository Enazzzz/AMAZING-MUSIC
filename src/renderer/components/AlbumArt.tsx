import { motion } from "framer-motion";

/**
 * Renders prominent album artwork with accent-tinted drop shadow.
 */
export function AlbumArt(props: { artUrl: string | null; accent: string; title: string }): JSX.Element {
	const { artUrl, accent, title } = props;
	return (
		<motion.div
			layout
			initial={{ scale: 0.94, opacity: 0.8 }}
			animate={{ scale: 1, opacity: 1 }}
			transition={{ type: "spring", stiffness: 220, damping: 24 }}
			className="relative aspect-square w-full max-w-[420px] overflow-hidden rounded-3xl border border-white/20 bg-white/10"
			style={{ boxShadow: `0 26px 60px ${accent}55` }}
		>
			{artUrl ? (
				<img src={artUrl} alt={title} className="h-full w-full object-cover" />
			) : (
				<div className="flex h-full w-full items-center justify-center text-white/60">No Artwork</div>
			)}
		</motion.div>
	);
}
