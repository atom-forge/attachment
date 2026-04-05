import { AttachmentValidationError } from '../types.js';
import type { UploadMiddleware } from '../types.js';

/** Reject files larger than `max` bytes. */
export function size(max: number): UploadMiddleware {
	return async (file, meta) => {
		if (file.size > max) {
			throw new AttachmentValidationError(
				`File size ${file.size} exceeds limit of ${max} bytes.`,
			);
		}
		return { file, meta };
	};
}
