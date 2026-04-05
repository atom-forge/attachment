import { AttachmentValidationError } from '../types.js';
import type { UploadMiddleware } from '../types.js';

/** Reject upload when the category already has `max` or more files. */
export function count(max: number): UploadMiddleware {
	return async (file, meta, files) => {
		if (files.length >= max) {
			throw new AttachmentValidationError(
				`Category already contains ${files.length} file(s); max is ${max}.`,
			);
		}
		return { file, meta };
	};
}
