import { AttachmentValidationError } from '../types.js';
import type { UploadMiddleware } from '../types.js';

/**
 * Allow only files whose MIME type matches `pattern`.
 *
 * Patterns can be:
 * - exact strings:  `'image/jpeg'`
 * - wildcard type:  `'image/*'`  (matches any subtype)
 * - an array of the above
 */
export function mime(pattern: string | string[]): UploadMiddleware {
	const patterns = Array.isArray(pattern) ? pattern : [pattern];

	function matches(fileMime: string): boolean {
		return patterns.some((p) => {
			if (p.endsWith('/*')) {
				return fileMime.startsWith(p.slice(0, -1));
			}
			return fileMime === p;
		});
	}

	return async (file, meta) => {
		if (!matches(file.type)) {
			throw new AttachmentValidationError(
				`MIME type "${file.type}" is not allowed.`,
			);
		}
		return { file, meta };
	};
}
