import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand,
	HeadObjectCommand,
	CopyObjectCommand,
	ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { StorageProvider, StoredFile } from '../types.js';
import type { EventEmitter } from '../events/types.js';

export interface S3ProviderConfig {
	bucket:           string;
	prefix?:          string;
	region?:          string;
	endpoint?:        string;
	forcePathStyle?:  boolean;
	accessKeyId?:     string;
	secretAccessKey?: string;
}

export function createS3Provider(config: S3ProviderConfig): StorageProvider {
	const client = new S3Client({
		region:         config.region,
		endpoint:       config.endpoint,
		forcePathStyle: config.forcePathStyle,
		credentials:    config.accessKeyId && config.secretAccessKey
			? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
			: undefined,
	});

	let eventManager: EventEmitter | undefined;
	const prefix = config.prefix?.replace(/^\/+|\/+$/g, '');

	function body(file: File) {
		return file.arrayBuffer().then((b) => new Uint8Array(b));
	}

	function copySource(key: string): string {
		return `${config.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
	}

	// strips shard prefix: "ab/abcd1234/photo.jpg" → "abcd1234/photo.jpg"
	function toKey(logicalPath: string): string {
		const slash = logicalPath.indexOf('/');
		const key = slash !== -1 ? logicalPath.slice(slash + 1) : logicalPath;
		return prefix ? `${prefix}/${key}` : key;
	}

	return {
		setEventManager(em) {
			eventManager = em;
		},

		async save(logicalPath, file) {
			await client.send(new PutObjectCommand({
				Bucket:       config.bucket,
				Key:          toKey(logicalPath),
				Body:         new Uint8Array(await file.arrayBuffer()),
				ContentType:  file.type || 'application/octet-stream',
				CacheControl: 'public, max-age=31536000, immutable',
			}));
		},

		async read(logicalPath) {
			const response = await client.send(new GetObjectCommand({
				Bucket: config.bucket,
				Key:    toKey(logicalPath),
			}));
			const bytes = await response.Body!.transformToByteArray();
			return Buffer.from(bytes);
		},

		stream(logicalPath) {
			// Pull-based: reads from S3 only as fast as the client consumes,
			// and cancels the S3 body when the client goes away.
			let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
			return new ReadableStream<Uint8Array>({
				async pull(controller) {
					if (!reader) {
						const response = await client.send(new GetObjectCommand({
							Bucket: config.bucket,
							Key:    toKey(logicalPath),
						}));
						reader = (response.Body!.transformToWebStream() as ReadableStream<Uint8Array>).getReader();
					}
					const { done, value } = await reader.read();
					if (done) controller.close();
					else controller.enqueue(value);
				},
				async cancel(reason) {
					await reader?.cancel(reason);
				},
			});
		},

		async delete(logicalPath) {
			await client.send(new DeleteObjectCommand({
				Bucket: config.bucket,
				Key:    toKey(logicalPath),
			}));
		},

		async exists(logicalPath) {
			try {
				await client.send(new HeadObjectCommand({
					Bucket: config.bucket,
					Key:    toKey(logicalPath),
				}));
				return true;
			} catch (err) {
				// Only "not found" means false; credential/network errors must not look like a missing file.
				if (isNotFound(err)) return false;
				throw err;
			}
		},

		async rename(oldLogicalPath, newLogicalPath) {
			const oldKey = toKey(oldLogicalPath);
			const newKey = toKey(newLogicalPath);
			if (oldKey === newKey) return;  // S3 refuses to copy an object onto itself

			await client.send(new CopyObjectCommand({
				Bucket:     config.bucket,
				CopySource: copySource(oldKey),
				Key:        newKey,
			}));

			try {
				await client.send(new DeleteObjectCommand({
					Bucket: config.bucket,
					Key:    oldKey,
				}));
			} catch (error) {
				eventManager?.trigger({
					type:    'storage:rename-cleanup-failed',
					oldPath: oldLogicalPath,
					newPath: newLogicalPath,
					error,
				});
			}
		},

		// --- atomic mode ---

		async create(logicalPath, file) {
			try {
				await client.send(new PutObjectCommand({
					Bucket:       config.bucket,
					Key:          toKey(logicalPath),
					Body:         await body(file),
					ContentType:  file.type || 'application/octet-stream',
					CacheControl: 'public, max-age=31536000, immutable',
					IfNoneMatch:  '*',
				}));
				return true;
			} catch (err) {
				if (isConditionFailed(err)) return false;
				throw err;
			}
		},

		async copy(fromLogicalPath, toLogicalPath) {
			try {
				await client.send(new CopyObjectCommand({
					Bucket:      config.bucket,
					CopySource:  copySource(toKey(fromLogicalPath)),
					Key:         toKey(toLogicalPath),
					IfNoneMatch: '*',
				}));
				return true;
			} catch (err) {
				if (isConditionFailed(err)) return false;
				throw err;
			}
		},

		async list(logicalFolder) {
			const folderKey = toKey(logicalFolder) + '/';
			const files: StoredFile[] = [];
			let token: string | undefined;
			do {
				const page = await client.send(new ListObjectsV2Command({
					Bucket:            config.bucket,
					Prefix:            folderKey,
					Delimiter:         '/',
					ContinuationToken: token,
				}));
				for (const obj of page.Contents ?? []) {
					if (!obj.Key) continue;
					files.push({ name: obj.Key.slice(folderKey.length), modified: obj.LastModified?.getTime() ?? 0 });
				}
				token = page.IsTruncated ? page.NextContinuationToken : undefined;
			} while (token);
			return files;
		},

		async etag(logicalPath) {
			try {
				const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: toKey(logicalPath) }));
				return head.ETag ?? null;
			} catch (err) {
				if (isNotFound(err)) return null;
				throw err;
			}
		},

		async replaceIf(logicalPath, file, etag) {
			try {
				await client.send(new PutObjectCommand({
					Bucket:       config.bucket,
					Key:          toKey(logicalPath),
					Body:         await body(file),
					ContentType:  file.type || 'application/octet-stream',
					CacheControl: 'public, max-age=31536000, immutable',
					IfMatch:      etag,
				}));
				return true;
			} catch (err) {
				if (isConditionFailed(err) || isNotFound(err)) return false;
				throw err;
			}
		},
	};
}

type S3Error = { name?: string; $metadata?: { httpStatusCode?: number } };

function isNotFound(err: unknown): boolean {
	const e = err as S3Error;
	return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

// 412: the condition (If-None-Match / If-Match) failed; 409: a concurrent conditional write won.
function isConditionFailed(err: unknown): boolean {
	const status = (err as S3Error).$metadata?.httpStatusCode;
	return status === 412 || status === 409;
}

export type S3StorageProvider = ReturnType<typeof createS3Provider>;
