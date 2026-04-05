import { encodeFocus } from '../types.js';
import type { Focus, FocusHashFn, ImgStat, UploadMiddleware } from '../types.js';

/**
 * Read image metadata (dimensions, dominant color, animated flag, crop mode)
 * from the uploaded file using `sharp` and inject it into `meta.img`.
 *
 * @param cropMode  `'e'` (entropy, default) | `'a'` (attention) | `Focus` (focal point)
 *
 * Peer dependency: `sharp` must be installed.
 */
export function imgstat(cropMode: ImgStat['c'] = 'e', focusHash?: FocusHashFn): UploadMiddleware {
	return async (file, meta) => {
		const sharp = (await import('sharp')).default;
		const buffer = await file.arrayBuffer();
		const img = sharp(Buffer.from(buffer));
		const [md, stats] = await Promise.all([img.metadata(), img.stats()]);
		const { r, g, b } = stats.dominant;
		const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
		const imgStat: ImgStat = {
			w: md.width!,
			h: md.height!,
			d: hex,
			a: md.pages ? md.pages > 1 : false,
			c: cropMode,
		};
		if (typeof cropMode === 'object' && focusHash) {
			imgStat.ch = focusHash(encodeFocus(cropMode as Focus));
		}
		(meta as Record<string, unknown>).img = imgStat;
		return { file, meta };
	};
}
