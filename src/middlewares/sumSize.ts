import { AttachmentValidationError } from '../types.js';
import type { AttachmentData, UploadMiddleware } from '../types.js';

/**
 * Reject upload when the sum of existing files' sizes plus the new file would
 * exceed `max` bytes.
 */
export function sumSize(max: number): UploadMiddleware {
	const check = (file: File, files: AttachmentData[]) => {
		const existing = files.reduce((acc, f) => acc + f.size, 0);
		if (existing + file.size > max) {
			throw new AttachmentValidationError(
				`Total size ${existing + file.size} would exceed limit of ${max} bytes.`,
			);
		}
	};
	return Object.assign(async (file: File, meta: unknown, files: AttachmentData[]) => {
		check(file, files);
		return { file, meta };
	}, { check });
}
