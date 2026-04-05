import type { UploadMiddleware } from '../types.js';

/**
 * Convert the uploaded image to WebP, with optional resizing.
 *
 * @param lossy  `false` (default) = lossless WebP; a number 0–100 = lossy quality.
 * @param width  Optional max width. One dimension → proportional. Both → contain.
 * @param height Optional max height.
 *
 * Peer dependency: `sharp` must be installed.
 */
export function toWebP(
	lossy: false | number = false,
	width?: number,
	height?: number,
): UploadMiddleware {
	return async (file, meta) => {
		// Dynamic import so the package remains usable without sharp installed
		// (only transformers fail at runtime, not the whole module).
		const sharp = (await import('sharp')).default;

		const buffer = await file.arrayBuffer();
		const webpOptions =
			lossy === false
				? { lossless: true }
				: { quality: lossy as number };

		let pipeline = sharp(buffer);
		if (width !== undefined || height !== undefined) {
			pipeline = pipeline.resize({ width, height, fit: 'inside', withoutEnlargement: true });
		}
		const converted = await pipeline.webp(webpOptions).toBuffer();

		const baseName = file.name.replace(/\.[^.]+$/, '') || file.name;
		const newFile = new File([converted as any], `${baseName}.webp`, {
			type: 'image/webp',
		});

		return { file: newFile, meta };
	};
}
