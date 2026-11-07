import { AttachmentValidationError } from '../types.js';
import type { AttachmentData, UploadMiddleware } from '../types.js';

/** Reject upload when the category already has `max` or more files. */
export function count(max: number): UploadMiddleware {
	const check = (_file: File, files: { length: number }) => {
		if (files.length >= max) {
			throw new AttachmentValidationError(
				`Category already contains ${files.length} file(s); max is ${max}.`,
			);
		}
	};
	return Object.assign(async (file: File, meta: unknown, files: AttachmentData[]) => {
		check(file, files);
		return { file, meta };
	}, { check });
}
