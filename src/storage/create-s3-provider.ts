import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand,
	HeadObjectCommand,
	CopyObjectCommand,
} from '@aws-sdk/client-s3';
import type { StorageProvider } from '../types.js';
import type { EventEmitter } from '../events/types.js';

export interface S3ProviderConfig {
	bucket:           string;
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

	// strips shard prefix: "ab/abcd1234/photo.jpg" → "abcd1234/photo.jpg"
	function toKey(logicalPath: string): string {
		const slash = logicalPath.indexOf('/');
		return slash !== -1 ? logicalPath.slice(slash + 1) : logicalPath;
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
			return new ReadableStream<Uint8Array>({
				async start(controller) {
					const response = await client.send(new GetObjectCommand({
						Bucket: config.bucket,
						Key:    toKey(logicalPath),
					}));
					const reader = response.Body!.transformToWebStream().getReader();
					try {
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							controller.enqueue(value);
						}
						controller.close();
					} catch (err) {
						controller.error(err);
					}
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
			} catch {
				return false;
			}
		},

		async rename(oldLogicalPath, newLogicalPath) {
			const oldKey = toKey(oldLogicalPath);
			const newKey = toKey(newLogicalPath);

			await client.send(new CopyObjectCommand({
				Bucket:     config.bucket,
				CopySource: `${config.bucket}/${oldKey}`,
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
	};
}

export type S3StorageProvider = ReturnType<typeof createS3Provider>;
