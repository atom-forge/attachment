import type { UploadMiddleware } from '../types.js';

/** Replace the uploaded filename with a random UUID-based name, keeping the original extension. */
export function randname(): UploadMiddleware {
	return async (file, meta) => {
		const dot  = file.name.lastIndexOf('.');
		const ext  = dot >= 0 ? file.name.slice(dot) : '';
		const name = crypto.randomUUID() + ext;
		return { file: new File([file], name, { type: file.type }), meta };
	};
}
