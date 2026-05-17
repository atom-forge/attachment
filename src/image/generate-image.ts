import type { Focus } from '../types.js';

/**
 * Generate a WebP image from a source image file.
 *
 * @param sourcePath  Absolute path to the original image.
 * @param mode        Crop mode: `'e'` entropy | `'a'` attention | `'c'` center |
 *                    `'b'` box/contain | `Focus` manual focal point (permille coords).
 * @param width       Target width in pixels. Derived from height + aspect ratio if omitted.
 * @param height      Target height in pixels. Derived from width + aspect ratio if omitted.
 * @returns           WebP-encoded Buffer.
 *
 * Notes:
 * - Animated images (`pages > 1`): Focus mode falls back to `'c'` (centre).
 * - EXIF rotation is applied first via `.rotate()`.
 * - `withoutEnlargement: true` is enforced for all modes.
 *
 * Peer dependency: `sharp`
 */
export async function generateImage(
	source: string | Buffer,
	mode: 'e' | 'a' | 'c' | 'b' | Focus,
	width?: number,
	height?: number,
) {
	const sharp = (await import('sharp')).default;

	const img = sharp(source, { animated: true });
	const metadata = await img.metadata();

	// Account for EXIF rotation when reading dimensions
	const rotated =
		metadata.orientation !== undefined && [5, 6, 7, 8].includes(metadata.orientation);
	const oWidth  = rotated ? metadata.height! : metadata.width!;
	const oHeight = rotated ? metadata.width!  : metadata.height!;
	const oAspect = oWidth / oHeight;

	const isAnimated = (metadata.pages ?? 1) > 1;

	// Resolve target dimensions — derive missing axis from aspect ratio
	const w = width  ?? (height !== undefined ? Math.floor(height * oAspect) : oWidth);
	const h = height ?? (width  !== undefined ? Math.floor(width  / oAspect) : oHeight);

	// Animated images: attention/entropy fall back to centre; manual Focus is preserved
	const resolvedMode: 'e' | 'a' | 'c' | 'b' | Focus =
		isAnimated && (mode === 'a' || mode === 'e') ? 'c' : mode;

	// EXIF rotation is always applied first
	const pipeline = img.rotate();

	if (resolvedMode === 'b') {
		return pipeline
			.resize(w, h, {
				fit: 'contain',
				withoutEnlargement: true,
				kernel: sharp.kernel.lanczos3,
			})
			.webp({ lossless: true })
			.toBuffer();
	}

	if (typeof resolvedMode === 'string') {
		const positionMap = { e: 'entropy', a: 'attention', c: 'centre' } as const;
		return pipeline
			.resize(w, h, {
				fit: 'cover',
				position: positionMap[resolvedMode],
				withoutEnlargement: true,
				kernel: sharp.kernel.lanczos3,
			})
			.webp({ lossless: true })
			.toBuffer();
	}

	// Manual Focus — permille (0–1000) → pixel conversion
	const focus = resolvedMode;
	const focusPx = {
		x: (focus.x / 1000) * oWidth,
		y: (focus.y / 1000) * oHeight,
	};
	const safePx = {
		x:      (focus.s.x / 1000) * oWidth,
		y:      (focus.s.y / 1000) * oHeight,
		width:  (focus.s.w / 1000) * oWidth,
		height: (focus.s.h / 1000) * oHeight,
	};

	const rect = cropCalc({ width: oWidth, height: oHeight }, { width: w, height: h }, safePx, focusPx);

	return pipeline
		.extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })
		.resize(w, h, { withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
		.webp({ lossless: true })
		.toBuffer();
}

// ---------------------------------------------------------------------------
// Internal helpers (ported from legacy cropCalc / get2DCrop)
// ---------------------------------------------------------------------------

function cropCalc(
	imgSize:   { width: number; height: number },
	cropSize:  { width: number; height: number },
	safeZone:  { x: number; y: number; width: number; height: number },
	focusPoint: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
	const cropRatio  = cropSize.width / cropSize.height;
	const horizontal = imgSize.height * cropRatio < imgSize.width;
	const cropArea = {
		width:  horizontal ? imgSize.height * cropRatio : imgSize.width,
		height: horizontal ? imgSize.height : imgSize.width / cropRatio,
	};
	return {
		x: horizontal
			? Math.floor(get2DCrop(imgSize.width, focusPoint.x, cropArea.width, [safeZone.x, safeZone.width]))
			: 0,
		y: horizontal
			? 0
			: Math.floor(get2DCrop(imgSize.height, focusPoint.y, cropArea.height, [safeZone.y, safeZone.height])),
		width:  Math.floor(cropArea.width),
		height: Math.floor(cropArea.height),
	};
}

function get2DCrop(size: number, focus: number, crop: number, safe: [number, number]): number {
	let optimal = focus - crop / 2;
	const d1 = safe[0] - optimal;
	const d2 = optimal + crop - (safe[0] + safe[1]);
	if (Math.sign(d1) !== Math.sign(d2)) optimal += Math.abs(d1) < Math.abs(d2) ? d1 : -d2;
	if (optimal < 0) optimal = 0;
	if (optimal + crop > size) optimal = size - crop;
	return optimal;
}
