import { AttachmentValidationError } from '../types.js';
import type { UploadMiddleware } from '../types.js';

/**
 * Allow only files whose extension (from their name) is in `extensions`.
 *
 * Extensions must include the leading dot, e.g. `['.jpg', '.png']`.
 */
export function ext(extensions: string[]): UploadMiddleware {
	const lower = extensions.map((e) => e.toLowerCase());

	return async (file, meta) => {
		const dot = file.name.lastIndexOf('.');
		const fileExt = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
		if (!lower.includes(fileExt)) {
			throw new AttachmentValidationError(
				`File extension "${fileExt}" is not allowed.`,
			);
		}
		return { file, meta };
	};
}
