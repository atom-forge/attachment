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

export interface FileServerHandler {
	match(request: Request): boolean;
	handle(request: Request): Promise<Response>;
}

export function createFileServer(options: FileServerOptions): FileServerHandler {
	const { uploadDir, driver } = options;
	const servePrefix = options.servePrefix ?? '/file';
	const root = path.resolve(uploadDir);

	function getPathname(request: Request): string {
		return new URL(request.url).pathname;
	}

	return {
		match(request: Request): boolean {
			return getPathname(request).startsWith(servePrefix + '/');
		},

		async handle(request: Request): Promise<Response> {
			const pathname = getPathname(request);
			const rest     = pathname.slice(servePrefix.length + 1); // "{slug}/{filename}"
			const slash    = rest.indexOf('/');
			if (slash === -1) return new Response('Not Found', { status: 404 });

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
		},
	};
}
