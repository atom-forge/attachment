# Handler API — LLM Reference

## Create
```ts
const h = attachments.entityType(dbEntity);
```

## Read
```ts
h.cat.list()            // AttachmentData[]
h.cat.get(filename)     // AttachmentData | undefined
```

## Write — all mutate entity.attachments; persist with prisma.update
```ts
// add — runs middleware, sanitizes name, resolves collisions, bumps version
const { attachment, rollback } = await h.cat.add(file, meta);

// replace — overwrites file in-place, bumps version → new URL
const { attachment, rollback } = await h.cat.replace(filename, file, meta);

// updateMeta — no file I/O, bumps version
const updated = await h.cat.updateMeta(filename, meta);

// rename — sanitizes newName, throws on collision
await h.cat.rename(oldName, newName);

// delete — removes file + record, no version bump
await h.cat.delete(filename);

// reorder — JSON only, no file I/O
h.cat.reorder([filename1, filename2]);
```

## Purge (entity level)
```ts
await h.purge(); // deletes all files across all categories; sets entity.attachments = {}
```

## Rollback
```ts
const { rollback } = await h.cat.add(file, meta);
try { await prisma.update(...) } catch { await rollback(); throw; }
```

## AttachmentData shape
```ts
{ filename, version, groupId, size, uploadedAt, meta, url }
// url = /{servePrefix}/{groupId}-{version}/{filename}  — computed, never stored
```

## DefineAttachmentsOptions
| Option         | Type                                          | Default       |
|----------------|-----------------------------------------------|---------------|
| `provider`     | `StorageProvider`                             | —             |
| `servePrefix`  | `string`                                      | `'/file'`     |
| `nextGroupId`  | `(entityType, entityId, cat) => Promise<string>` | UUID→base36 |
| `sanitize`     | `false \| true \| fn`                         | `true`        |
| `findUnique`   | `(existing, name) => string`                  | `base(n)ext`  |
| `eventManager` | `EventEmitter`                                | —             |