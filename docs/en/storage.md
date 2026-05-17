# Storage

## JSON column structure

The `attachments` column holds a `Record<category, CategoryStore>`:

```ts
interface CategoryStore {
  i: string;          // groupId (base36, auto-generated UUID→base36 on first add)
  v: number;          // version sequence counter (monotonically increasing)
  f: AttachmentItem[];
}

interface AttachmentItem {
  n: string;   // filename
  v: string;   // version at time of add/replace (base36)
  s: number;   // size in bytes
  t: number;   // uploadedAt (Unix epoch)
  x: unknown;  // caller-supplied meta
}
```

**Example stored value:**
```json
{
  "avatar": {
    "i": "abc123",
    "v": 3,
    "f": [{ "n": "photo.jpg", "v": "3", "s": 42000, "t": 1743076800, "x": {} }]
  }
}
```

---

## Public `AttachmentData<TMeta>` type

All read methods return this shape:

```ts
interface AttachmentData<TMeta = unknown> {
  filename:   string;
  version:    string;   // base36
  groupId:    string;   // base36
  size:       number;
  uploadedAt: number;   // Unix epoch
  meta:       TMeta;
  url:        string;   // computed: /{servePrefix}/{groupId}-{version}/{filename}
}
```

`url` is never stored — computed on every read.

---

## `StorageProvider` interface

```ts
interface StorageProvider {
  save(path: string, file: File):               Promise<void>;
  read(path: string):                           Promise<Buffer>;
  stream(path: string):                         ReadableStream<Uint8Array>;
  delete(path: string):                         Promise<void>;
  exists(path: string):                         Promise<boolean>;
  rename(oldPath: string, newPath: string):     Promise<void>;
  setEventManager?(em: EventEmitter):           void;
}
```

---

## Physical file layout

### Local provider

Files live at:

```
{shard}/{groupId}/{filename}
```

where `shard = groupId.slice(0, 2)`.

Example: `ab/abc123/photo.jpg`

On `replace`, the file is **overwritten in place** — same physical path, but the version number in JSON changes → new URL (cache-busted).

### S3 / MinIO

No shard — object storage has no filesystem limitations:

```
{groupId}/{filename}
```

Example: `abc123/photo.jpg`

Saves always set `Cache-Control: public, max-age=31536000, immutable`.

---

## Local provider

```ts
import { createLocalProvider } from '@atom-forge/attachment';

const provider = createLocalProvider('./var/uploads');
```

No extra dependencies — uses Node.js built-ins (`fs/promises`).

---

## S3 / MinIO provider

```ts
import { createS3Provider } from '@atom-forge/attachment';

const provider = createS3Provider({
  bucket:          'assets',
  region:          'eu-central-1',
  endpoint:        'http://minio:9000',  // required for MinIO; omit for AWS S3
  forcePathStyle:  true,                 // required for MinIO
  accessKeyId:     '...',
  secretAccessKey: '...',
});
```

| Option          | Required       | Description                                         |
|-----------------|----------------|-----------------------------------------------------|
| `bucket`        | yes            | S3 bucket name                                      |
| `region`        | yes            | AWS region                                          |
| `endpoint`      | MinIO only     | Custom endpoint URL                                 |
| `forcePathStyle`| MinIO only     | Use `http://host/bucket/key` instead of virtual-hosted style |
| `accessKeyId`   | yes            | Access key                                          |
| `secretAccessKey` | yes          | Secret key                                          |

`rename` is implemented as `CopyObject` + `DeleteObject` (not atomic). If the delete step fails, a `storage:rename-cleanup-failed` event is fired.

Dependency: `@aws-sdk/client-s3`

---

## Event system

Attach an event manager to receive lifecycle events:

```ts
import { type EventEmitter } from '@atom-forge/attachment';

const myEventManager: EventEmitter = {
  trigger(event) { /* log, queue job, etc. */ }
};

defineAttachments({...}, {
  provider,
  eventManager: myEventManager,
});
```

### Events fired by `defineAttachments`

| Event                    | When                            | Payload                                              |
|--------------------------|---------------------------------|------------------------------------------------------|
| `attachment:add`         | file uploaded, store updated    | entityType, entityId, category, groupId, attachment  |
| `attachment:replace`     | file overwritten, store updated | …, oldAttachment, attachment                         |
| `attachment:delete`      | file deleted, store updated     | entityType, entityId, category, groupId, filename    |
| `attachment:rename`      | file renamed                    | …, oldName, newName                                  |
| `attachment:meta-updated`| only meta changed               | entityType, entityId, category, groupId, attachment  |
| `attachment:purge`       | all files deleted               | entityType, entityId                                 |

### Events fired by S3 provider

| Event                          | When                                      |
|--------------------------------|-------------------------------------------|
| `storage:rename-cleanup-failed`| CopyObject ok, DeleteObject failed        |

### Prisma middleware

Wire up automatic `entity:deleted` events on Prisma deletes:

```ts
import { createPrismaMiddleware } from '@atom-forge/attachment';

prisma.$use(createPrismaMiddleware(eventManager));
```

Handle the event to purge attachments when the entity is deleted:

```ts
eventManager.on('entity:deleted', async ({ model, entity }) => {
  const handler = attachments[model.toLowerCase()]?.(entity);
  await handler?.purge();
  await prisma[model.toLowerCase()].update({
    where: { id: entity.id },
    data:  { attachments: entity.attachments as object },
  });
});
```
