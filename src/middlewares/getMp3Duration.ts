import type { UploadMiddleware } from '../types.js';

/**
 * Extract the duration of an MP3 file and inject it into `meta[metaKey]`
 * (in seconds, as a number).
 *
 * **Note:** The returned `meta` object has an extra runtime key (`metaKey`) that
 * is not reflected in `TMeta` at compile time. Document the expected shape on
 * the call site and cast as needed.
 *
 * Peer dependency: `music-metadata` must be installed.
 */
export function getMp3Duration(metaKey: string = 'duration'): UploadMiddleware {
	return async (file, meta) => {
		const { parseBuffer } = await import('music-metadata');

		const buffer = new Uint8Array(await file.arrayBuffer());
		const parsed = await parseBuffer(buffer, { mimeType: file.type });

		(meta as Record<string, unknown>)[metaKey] = parsed.format.duration ?? 0;
		return { file, meta };
	};
}
