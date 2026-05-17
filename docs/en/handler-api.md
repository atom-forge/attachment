# Handler API

## Creating a handler

```ts
const h = attachments.user(entity);
// entity must include the `attachments` field from the database row
```

Each key on `h` is a `CategoryHandler` for the corresponding category:

```ts
h.avatar   // CategoryHandler for 'avatar'
h.gallery  // CategoryHandler for 'gallery'
```

---

## Read

```ts
h.avatar.list()            // AttachmentData[] — all files in category
h.avatar.get('photo.jpg')  // AttachmentData | undefined
```

---

## Write

All write methods **mutate `entity.attachments` in-place**. Persist with `prisma.update` after every write.

### `add(file, meta)`

```ts
const { attachment, rollback } = await h.avatar.add(file, {});
```

- Runs the middleware pipeline
- Sanitizes filename (strips diacritics, special chars) — configurable or disableable via `sanitize` option
- Resolves name collisions: `photo.png` → `photo(1).png` → `photo(2).png` …
- Bumps version counter; assigns new `version` to the item
- On first add for a category, generates a `groupId` (UUID → base36)

### `replace(filename, file, meta)`

```ts
const { attachment, rollback } = await h.avatar.replace('photo.jpg', file, {});
```

- Runs the middleware pipeline
- Overwrites the physical file in-place; bumps version → new URL (cache-busted)
- Throws `AttachmentValidationError` if `filename` not found

### `updateMeta(filename, meta)`

```ts
const updated = await h.avatar.updateMeta('photo.jpg', { caption: 'Hello' });
```

No file I/O. Bumps version → new URL. Throws if not found.

### `rename(oldName, newName)`

```ts
await h.avatar.rename('photo.jpg', 'profile.jpg');
```

Sanitizes `newName`. Throws if the sanitized name already exists in the category.

### `delete(filename)`

```ts
await h.avatar.delete('photo.jpg');
```

Deletes the physical file and removes the record. Does **not** bump the version counter.

### `reorder(filenames)`

```ts
h.gallery.reorder(['b.png', 'a.png', 'c.png']);
```

Reorders the JSON array. No file I/O. No version bump.

---

## `purge()` — entity level

```ts
await h.purge();
```

Deletes every file across all categories. Sets `entity.attachments = {}`. Requires a provider to be configured. Persist with `prisma.update` afterwards.

---

## Rollback pattern

`add` and `replace` return a `rollback` function that deletes the physical file if the subsequent DB write fails:

```ts
const { attachment, rollback } = await h.avatar.add(file, meta);
try {
  await prisma.course.update({
    where: { id },
    data:  { attachments: record.attachments as object },
  });
} catch (err) {
  await rollback();
  throw err;
}
```

---

## `DefineAttachmentsOptions`

| Option         | Type                                                   | Default              | Description                                      |
|----------------|--------------------------------------------------------|----------------------|--------------------------------------------------|
| `provider`     | `StorageProvider`                                      | —                    | Storage backend (local or S3)                    |
| `servePrefix`  | `string`                                               | `'/file'`            | URL prefix for generated file URLs               |
| `nextGroupId`  | `(entityType, entityId, category) => Promise<string>`  | UUID → base36        | Custom group ID generator                        |
| `sanitize`     | `false \| true \| (name) => string`                    | `true` (built-in)    | Filename sanitization                            |
| `findUnique`   | `(existing, name) => string`                           | `base(n)ext`         | Collision resolution for `add()`                 |
| `eventManager` | `EventEmitter`                                         | —                    | Event bus for attachment lifecycle events        |