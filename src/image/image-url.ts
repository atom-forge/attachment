import type { AttachmentData, Focus, ImgStat, ImageVariantMap, Density } from '../types.js';
import { encodeFocus } from '../types.js';

/**
 * Build a image URL for an image attachment.
 *
 * @param attachment  Attachment with `meta.img` (ImgStat).
 * @param width       Requested width in pixels (0 = derive from height).
 * @param height      Requested height in pixels (0 = derive from width).
 * @param mode        Override crop mode. Defaults to `meta.img.c`.
 *                    Accepts `'e' | 'a' | 'c' | 'b' | Focus`.
 * @param prefix      URL prefix. Default: `/img`.
 */
export function buildImageUrl(
	attachment: AttachmentData<{ img: ImgStat }>,
	width: number,
	height: number,
	mode?: 'e' | 'a' | 'c' | 'b' | Focus,
	prefix: string = '/img',
): string {
	const { groupId, version, filename, meta } = attachment;
	const resolvedMode: 'e' | 'a' | 'c' | 'b' | Focus = mode ?? meta.img.c;

	const size = `${width}x${height}`;

	let modeSegment: string;
	if (typeof resolvedMode === 'string') {
		modeSegment = `${resolvedMode}.${size}`;
	} else {
		const encoded = encodeFocus(resolvedMode);
		const ch = meta.img.ch;
		if (!ch) {
			throw new Error(
				`buildImagelUrl: Focus mode requires a pre-computed hash (meta.img.ch). ` +
				`Use imgstat() with a FocusHashFn to populate it.`,
			);
		}
		modeSegment = `${encoded}.${size}.${ch}`;
	}

	return `${prefix}/${groupId}-${version}/${modeSegment}/${filename}.webp`;
}

/**
 * Build a image URL using a typed variant key from an ImageVariantMap.
 * Density multiplies both dimensions (1 = 1x, 2 = retina, 3 = hi-dpi).
 *
 * Mode resolution order:
 *   1. explicit `mode` argument
 *   2. stored `meta.img.c` (if attachment has ImgStat metadata)
 *   3. `'e'` (entropy) as fallback — works even when meta is `{}`
 */
export function buildVariantUrl<V extends ImageVariantMap>(
	variants: V,
	attachment: AttachmentData<unknown>,
	variant: keyof V & string,
	density: Density = 1,
	mode?: 'e' | 'a' | 'c' | 'b',
	prefix: string = '/img',
): string {
	const def = variants[variant];
	const w = Math.round((def.w ?? 0) * density);
	const h = Math.round((def.h ?? 0) * density);
	const storedMode = (attachment.meta as { img?: ImgStat } | null)?.img?.c;
	const resolvedMode: 'e' | 'a' | 'c' | 'b' | Focus = mode ?? storedMode ?? 'e';
	return buildImageUrl(attachment as AttachmentData<{ img: ImgStat }>, w, h, resolvedMode, prefix);
}
