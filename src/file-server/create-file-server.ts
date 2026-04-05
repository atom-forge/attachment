import mime from 'mime';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Driver interface — swap Bun vs Node implementations
// ---------------------------------------------------------------------------

export interface FileServerDriver {
	exists(fullPath: string): Promise<boolean>;
	serve(fullPath: string, contentType: string): Promise<Response>;
}

// ---------------------------------------------------------------------------
// createFileServer
// ---------------------------------------------------------------------------

export interface FileServerOptions {
	uploadDir:    string;
	servePrefix?: string;  // default: '/file'
	driver:       FileServerDriver;
}

/**
 * Returns a handler function: `(pathname) => Promise<Response | null>`.
 * Returns `null` for paths outside the serve prefix — pass through to the framework.
 */
export function createFileServer(options: FileServerOptions): (pathname: string) => Promise<Response | null> {
	const { uploadDir, driver } = options;
	const servePrefix = options.servePrefix ?? '/file';
	const root = path.resolve(uploadDir);

	return async function serveFile(pathname: string): Promise<Response | null> {
		if (!pathname.startsWith(servePrefix + '/')) return null;

		const rest  = pathname.slice(servePrefix.length + 1); // "{slug}/{filename}"
		const slash = rest.indexOf('/');
		if (slash === -1) return null;

		const slug     = rest.slice(0, slash);
		const filename = rest.slice(slash + 1);
		const groupId  = slug.replace(/-[a-z0-9]+$/, '');
		const shard    = groupId.slice(0, 2);
		const fullPath = path.join(root, shard, groupId, filename);

		if (!(await driver.exists(fullPath))) {
			return new Response('File not found', { status: 404 });
		}

		const contentType = mime.getType(filename) ?? 'application/octet-stream';
		return driver.serve(fullPath, contentType);
	};
}
