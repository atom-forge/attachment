# Handler API

## Creating a handler

```ts
const h = attachments.user(entity);
// entity must include the `attachments` field from the database row
```

Files can only be added to a **saved** entity: its id field (`idField`) must exist and match the entity's `idType` (`'int'` or `'uuid'`), otherwise `add` throws with a clear message.

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
- Sanitizes filename (strips diacritics, special chars; the stem and the extension are cleaned separately, and an empty stem becomes `file`, e.g. `фото.jpg` → `file.jpg`) — configurable or disableable via `sanitize` option. Whatever the sanitizer returns must be a single safe path segment (no `/`, `\`, `.`/`..`, control characters), otherwise `AttachmentValidationError` is thrown
- Resolves name collisions: `photo.png` → `photo(1).png` → `photo(2).png` …
- Bumps version counter; assigns new `version` to the item (the base36 counter plus a random suffix, so future version URLs cannot be guessed)
- On first add for a category, generates a composite `groupId`: `{random}-{CODE}-{entityId36}`, e.g. `k3x9q-AV-39x9` (random base36 part, the category code, the entity id in base36). It is also the storage folder; the file URL looks like `/file/k3x9q-AV-39x9-1r2jo3l/photo.jpg`. On a legacy (random-only) group ID, `add` and `replace` throw `AttachmentValidationError`

### `replace(filename, file, meta)`

```ts
const { attachment, rollback } = await h.avatar.replace('photo.jpg', file, {});
```

- Runs the middleware pipeline
- Overwrites the physical file in-place; bumps version → new URL (cache-busted)
- The processed file must keep the stored file's extension (e.g. `toWebP()` turning the upload into `.webp` while replacing `a.jpg` throws `AttachmentValidationError`); delete and add instead
- Keeps the original bytes in memory until it returns, so `rollback()` can put the original file back
- Throws `AttachmentValidationError` if `filename` not found

### `updateMeta(filename, meta)`

```ts
const updated = h.avatar.updateMeta('photo.jpg', { caption: 'Hello' });
```

Synchronous, no file I/O. Bumps version → new URL. Throws if not found.

### `rename(oldName, newName)`

```ts
await h.avatar.rename('photo.jpg', 'profile.jpg');
```

Sanitizes `newName`. Throws if the sanitized name already exists in the category.

### `delete(filename)`

```ts
await h.avatar.delete('photo.jpg');
```

Deletes the physical file and removes the record. Succeeds even if the physical file is already missing. Does **not** bump the version counter.

### `reorder(filenames)`

```ts
h.gallery.reorder(['b.png', 'a.png', 'c.png']);
```

Reorders the JSON array. Synchronous, no file I/O. No version bump. `filenames` must list every current file exactly once; otherwise it throws `AttachmentValidationError` (it never drops or duplicates files).

---

## `purge()` — entity level

```ts
await h.purge();
```

Deletes every file across all categories (each through its category's provider). Requires a provider to be configured. Persist with `prisma.update` afterwards.

It is best effort: it tries every file. On success it sets `entity.attachments = {}` and emits `attachment:purge`. If some files cannot be deleted, their stores are kept in `entity.attachments` and it throws an `Error` whose `errors` array holds the individual failures — persist the remaining `attachments` in that case too, so the files that were deleted are dropped from the record.

---

## Rollback pattern

`add` and `replace` return a `rollback` function to call if the subsequent DB write fails. For `add` it deletes the new file; for `replace` it restores the original file. It does not restore the mutated `attachments` JSON — discard or reload the entity afterwards:

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
| `nextGroupId`  | `(entityType, entityId, category) => Promise<string>`  | UUID → base36        | Custom generator for the random part of the group ID; must return lowercase base36 (`[a-z0-9]+`), the code and entity id are appended by the library |
| `sanitize`     | `false \| true \| (name) => string`                    | `true` (built-in)    | Filename sanitization                            |
| `findUnique`   | `(existing, name) => string`                           | `base(n)ext`         | Collision resolution for `add()`                 |
| `eventManager` | `EventEmitter`                                         | —                    | Event bus for attachment lifecycle events        |

---

## Entity options

`defineAttachments.entity(categories, options?)`

| Option    | Type              | Default | Description                                                          |
|-----------|-------------------|---------|----------------------------------------------------------------------|
| `idField` | `string`          | `'id'`  | Primary key field on the entity                                      |
| `idType`  | `'int' \| 'uuid'` | `'int'` | How the id is encoded (base36) into the group ID; string/slug ids are not supported |

## `CategoryConfig`

Every category is an object:

| Field         | Type                | Required | Description                                                                              |
|---------------|---------------------|----------|------------------------------------------------------------------------------------------|
| `code`        | `string`            | yes      | Exactly two characters `[A-Z0-9]`, unique across all categories of one `defineAttachments` call |
| `middlewares` | `UploadMiddleware[]`| no       | Upload middleware pipeline                                                               |
| `authorize`   | `AuthorizeFn`       | no       | Checks every file and thumbnail request (`false` → 403); served with `Cache-Control: private, no-store` |
| `provider`    | `StorageProvider`   | no       | Per-category storage; defaults to the `defineAttachments` provider                       |

Codes are validated at startup: a missing, malformed or duplicate code, or an array-form category, throws. For `authorize` and `provider` see [Access Control](access-control.md).
