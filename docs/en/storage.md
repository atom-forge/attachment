# Storage

## JSON column structure

The `attachments` column holds a `Record<category, CategoryStore>`:

```ts
interface CategoryStore {
  i: string;          // groupId: composite key {random}-{CODE}-{entityId36}, created on first add
  v: number;          // version sequence counter (monotonically increasing)
  f: AttachmentItem[];
}

interface AttachmentItem {
  n: string;   // filename
  v: string;   // version at time of add/replace (base36 counter + random suffix)
  s: number;   // size in bytes
  t: number;   // uploadedAt (Unix epoch)
  x: unknown;  // caller-supplied meta
}
```

**Example stored value** (category `avatar` with code `AV`, user id `152829`):
```json
{
  "avatar": {
    "i": "k3x9q-AV-39x9",
    "v": 3,
    "f": [{ "n": "photo.jpg", "v": "3r2jo3l", "s": 42000, "t": 1743076800, "x": {} }]
  }
}
```

### Group id

The group id of a category store is a composite key, and it is also the storage folder:

```
{random}-{CODE}-{entityId36}      e.g. k3x9q-AV-39x9   (39x9 = 152829 in base36)
```

| Part         | Meaning |
|--------------|---------|
| `random`     | Lowercase base36, unguessable (protects against enumeration). Its first two characters are the local shard. By default derived from a random UUID; a custom `nextGroupId` produces only this part and must return `[a-z0-9]+`. |
| `CODE`       | The category's two-character `code`. From it the servers find the entity type, the category, its provider and its `authorize` hook. |
| `entityId36` | The owning entity's id in base36 (`idType: 'int'`, the default), or the 128-bit UUID value in base36 (`idType: 'uuid'`, ~25 characters). |

Because the composite key is the folder, editing the entity id in a URL points to a path that does not exist (404), so `authorize` cannot be tricked into checking a different owner.

Group ids from older versions (plain random ids) are not supported: `add`/`replace` throw `AttachmentValidationError` on them, and the servers answer 404. No migration is provided.

### Item version

An item's `v` is the store's counter in base36 followed by 6 random base36 characters (e.g. `3r2jo3l`). The random suffix means future version URLs cannot be guessed and pre-cached.

---

## Public `AttachmentData<TMeta>` type

All read methods return this shape:

```ts
interface AttachmentData<TMeta = unknown> {
  filename:   string;
  version:    string;   // base36 counter + random suffix
  groupId:    string;   // composite: {random}-{CODE}-{entityId36}
  size:       number;
  uploadedAt: number;   // Unix epoch
  meta:       TMeta;
  url:        string;   // computed: /{servePrefix}/{groupId}-{version}/{filename}
}
```

`url` is never stored — computed on every read. The filename is percent-encoded in the URL (`encodeURIComponent`).

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

  // needed only in atomic mode (see Concurrent Writes)
  create?(path: string, file: File):                     Promise<boolean>;   // false: already exists
  copy?(from: string, to: string):                       Promise<boolean>;   // false: target exists
  list?(folder: string):                                 Promise<{ name: string; modified: number }[]>;
  etag?(path: string):                                   Promise<string | null>;
  replaceIf?(path: string, file: File, etag: string):    Promise<boolean>;   // false: changed or deleted
}
```

`path` is always the logical path `{shard}/{groupId}/{filename}` (see below). The file server streams originals with `stream()`, the image server reads them with `read()`, so every provider must implement both.

Contract notes for the built-in providers:

- `delete` — the local provider ignores a file that is already missing, so deleting an attachment whose file is gone still succeeds.
- `exists` — the S3 provider returns `false` only for "not found" and rethrows every other error (credentials, network). Without the `s3:ListBucket` permission S3 answers 403 for missing keys, which then surfaces as an error instead of `false`.
- `stream` — the S3 provider is pull-based: it reads from S3 only as fast as the client consumes, and cancels the S3 body when the client goes away.
- `rename` — the S3 provider treats renaming to the same key as a no-op.
- The atomic-mode methods never overwrite or create a file unconditionally; both built-in providers implement them. A custom provider needs them only if you enable atomic mode (`defineAttachments` checks this at startup). See [Concurrent Writes](concurrency.md).

---

## Physical file layout

### Local provider

Files live at:

```
{shard}/{groupId}/{filename}
```

where `shard = groupId.slice(0, 2)` — the first two characters of the random part.

Example: `k3/k3x9q-AV-39x9/photo.jpg`

On `replace`, the file is **overwritten in place** — same physical path, but the version in JSON changes → new URL (cache-busted).

### S3 / MinIO

No shard — object storage has no filesystem limitations. The shard is stripped from the logical path:

```
{prefix}/{groupId}/{filename}
```

Example: `files/k3x9q-AV-39x9/photo.jpg` (or `k3x9q-AV-39x9/photo.jpg` without a prefix)

The optional provider prefix namespaces all object keys. This lets original files and
generated image variants share one bucket while remaining independently manageable.
Thumbnails are cached under a flat key `{groupId}-{version}.{mode-seg}.{filename}.webp`:

```
files/k3x9q-AV-39x9/photo.jpg
images/k3x9q-AV-39x9-3r2jo3l.e.400x400.photo.jpg.webp
```

Saves always set `Cache-Control: public, max-age=31536000, immutable` on the object. The app's file server decides the response header itself (`private, no-store` for categories with `authorize`).

---

## Local provider

```ts
import { createLocalProvider } from '@atom-forge/attachment';

const provider = createLocalProvider('./var/uploads');
```

No extra dependencies — uses Node.js built-ins (`fs/promises`). Paths that would resolve outside the upload directory are rejected.

---

## S3 / MinIO provider

```ts
import { createS3Provider } from '@atom-forge/attachment';

const provider = createS3Provider({
  bucket:          'assets',
  prefix:          'files/',             // optional object-key namespace
  region:          'eu-central-1',
  endpoint:        'http://minio:9000',  // required for MinIO; omit for AWS S3
  forcePathStyle:  true,                 // required for MinIO
  accessKeyId:     '...',
  secretAccessKey: '...',
});
```

| Option            | Required       | Description                                         |
|-------------------|----------------|-----------------------------------------------------|
| `bucket`          | yes            | S3 bucket name                                      |
| `prefix`          | no             | Object-key namespace; leading/trailing slashes are normalized |
| `region`          | no             | AWS region (falls back to the AWS SDK's default resolution) |
| `endpoint`        | no (MinIO)     | Custom endpoint URL; needed for MinIO               |
| `forcePathStyle`  | no (MinIO)     | Use `http://host/bucket/key` instead of virtual-hosted style; needed for MinIO |
| `accessKeyId`     | no             | Access key; used only together with `secretAccessKey` |
| `secretAccessKey` | no             | Secret key; without explicit keys the AWS SDK's default credential chain is used |

`rename` is implemented as `CopyObject` + `DeleteObject` (not atomic). If the delete step fails, a `storage:rename-cleanup-failed` event is fired.

### One bucket for originals and image cache

Point the attachment provider and the image server's `thumbProvider` at the same bucket with
different prefixes:

```ts
const provider      = createS3Provider({ bucket: 'assets', prefix: 'files/',  /* ... */ });
const thumbProvider = createS3Provider({ bucket: 'assets', prefix: 'images/', /* ... */ });

const attachments = defineAttachments({ /* ... */ }, { provider });
const imageServer = createImageServer({ attachments, thumbProvider, /* ... */ });
```

Lifecycle expiration can then target only `images/`, leaving `files/` untouched.

Dependency: `@aws-sdk/client-s3`

---

## Per-category provider

Any category can declare its own `provider`; categories without one use the `defineAttachments` provider. The file and image servers find the right provider from the category code in the group id.

```ts
const attachments = defineAttachments({
  course: defineAttachments.entity({
    cover:     { code: 'CV', middlewares: [mime('image/*')] },
    contracts: {
      code: 'PD',
      authorize: async ({ request, entityId }) => canSee(request, entityId),
      provider:  createS3Provider({ bucket: 'assets', prefix: 'private/' }),
    },
  }),
}, { provider: createS3Provider({ bucket: 'assets', prefix: 'files/' }) });
```

If a bucket or prefix is anonymously readable (for example because the proxy serves public files straight from it), categories with `authorize` must use a separate, non-public provider like above; otherwise their files can be downloaded directly from the bucket. See [Access control](access-control.md).

---

## Event system

Attach an event manager to receive lifecycle events. The `EventEmitter` interface has a single method, `trigger(event)`; the event manager is also passed to the providers (`setEventManager`) of `defineAttachments` and of every category:

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
| `attachment:purge`       | all files of the entity deleted (only on full success) | entityType, entityId          |

`purge()` is best effort: it tries to delete every file, keeps the stores of files that could not be deleted in `entity.attachments`, and then throws an `Error` with an `errors` array. Only when every file was deleted does it clear the field to `{}` and fire `attachment:purge`.

### Events fired by the S3 provider

| Event                          | When                                      | Payload                    |
|--------------------------------|-------------------------------------------|----------------------------|
| `storage:rename-cleanup-failed`| CopyObject ok, DeleteObject failed        | oldPath, newPath, error    |

### Events fired by the image server

Only when `createImageServer` receives an `eventManager`:

| Event                  | When                                          | Payload                     |
|------------------------|-----------------------------------------------|-----------------------------|
| `thumbnail:generated`  | a new thumbnail was generated and cached      | groupId, filename, modeSeg  |

### Prisma extension

Fire `entity:deleted` (`{ model, entity }`) after every successful single-record Prisma `delete`:

```ts
import { createPrismaExtension } from '@atom-forge/attachment';

const prisma = new PrismaClient().$extends(createPrismaExtension(eventManager));
```

`deleteMany` is not covered: Prisma returns only a count, not the deleted records. Load the records and purge their attachments yourself before a `deleteMany`.

`createPrismaMiddleware(eventManager)` (for `prisma.$use`) still exists but is deprecated: `$use` is deprecated since Prisma 4.16 and removed in newer versions.

Handle the event to purge attachments when the entity is deleted. The library's `EventEmitter` only has `trigger`, so dispatching to handlers is up to your own event manager, for example:

```ts
import type { AttachmentEvent, EventEmitter } from '@atom-forge/attachment';

class AppEvents implements EventEmitter {
  private handlers: Array<(event: AttachmentEvent) => void | Promise<void>> = [];
  subscribe(handler: (event: AttachmentEvent) => void | Promise<void>) { this.handlers.push(handler); }
  trigger(event: AttachmentEvent) {
    for (const handler of this.handlers) {
      Promise.resolve(handler(event)).catch((error) => console.error(error));
    }
  }
}

const eventManager = new AppEvents();
const prisma = new PrismaClient().$extends(createPrismaExtension(eventManager));

eventManager.subscribe(async (event) => {
  if (event.type !== 'entity:deleted') return;
  const factory = attachments[event.model.toLowerCase() as keyof typeof attachments];
  if (!factory) return;
  // The row is already gone: build the handler from the deleted record and delete its files.
  // Do not write the attachments field back — there is no row to update.
  await factory(event.entity as any).purge();
});
```

If `purge()` throws, its `errors` array lists the files that could not be deleted; log them or retry later, since the record that referenced them no longer exists.
