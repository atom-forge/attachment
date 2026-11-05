# Upgrading

This chapter lists the changes that need action when you upgrade, version by version, newest first. Each change says what is different and what you have to do. Changes that need no action are only in the changelog.

## From 0.3.3 to 0.4.0

0.4.0 is a breaking release. Category definitions, group ids, URLs and the server options change, and attachment data stored by 0.3.x cannot be read by 0.4.0.

> **Existing data:** There is no migration. Upgrade a project that already has attachments only if you can re-upload them or move the files and rewrite the JSON yourself (see [Group ids include the category code and the owner](#group-ids-include-the-category-code-and-the-owner)).

### Categories are objects with a code

A category was a middleware array. It is now an object with a mandatory two-character `code` (`[A-Z0-9]`), unique across all categories of one `defineAttachments` call. `defineAttachments` throws at startup for an array, a missing or malformed code, or a duplicate code.

```ts
// 0.3.x
avatar: [count(1), mime('image/*'), toWebP(80)],

// 0.4.0
avatar: { code: 'AV', middlewares: [count(1), mime('image/*'), toWebP(80)] },
```

**What to do:** convert every category to `{ code, middlewares }` and pick a unique code for each. Choose codes you will keep: the code is part of every group id, URL and proxy rule.

### Group ids include the category code and the owner

A group id was a random base36 string (`k3x9q`). It is now `{random}-{CODE}-{entityId36}`, for example `k3x9q-AV-39x9` (152829 in base36), and it is also the storage folder.

| | 0.3.x | 0.4.0 |
|---|---|---|
| Group id | `k3x9q` | `k3x9q-AV-39x9` |
| File URL | `/file/k3x9q-3/photo.jpg` | `/file/k3x9q-AV-39x9-3r2jo3l/photo.jpg` |
| Local path | `k3/k3x9q/photo.jpg` | `k3/k3x9q-AV-39x9/photo.jpg` |
| S3 key | `files/k3x9q/photo.jpg` | `files/k3x9q-AV-39x9/photo.jpg` |

Stored 0.3.x data is not supported: `add` and `replace` throw `AttachmentValidationError` (`stored group id "…" does not belong to …`) on an old store, and the servers answer 404 for old URLs.

**What to do:** start with empty attachment data, or migrate it yourself: for every category store, build the new group id, move the files into the new folder, and write the new id into `attachments.{category}.i`.

### Attachments need a saved entity with a numeric or UUID id

The entity id is part of the group id, so it must exist when the first file is added, and it must match the entity's `idType`: `'int'` (default) or `'uuid'`. Other ids, such as slugs or alphanumeric codes, are not supported. Adding to an unsaved entity throws: `Entity id "undefined" is not a non-negative integer. Attachments need a saved entity with an id of type "int".`

**What to do:** save the entity before adding files. Set `idType: 'uuid'` on entities with UUID keys. If `idField` pointed to a non-numeric field, point it to the numeric or UUID primary key instead.

### `nextGroupId` returns only the random part

A custom `nextGroupId` produced the whole group id. It now produces only the random part, which must be lowercase base36 (`[a-z0-9]+`); the library appends the code and the entity id. Anything else throws.

**What to do:** return a lowercase base36 string, or remove the option to use the default.

### `createFileServer` takes the attachment definitions

`createFileServer` read files from `uploadDir` with a driver. It now takes the `defineAttachments` result, finds the category from the code in the URL, and streams from that category's provider. The `uploadDir`, `provider` and `driver` options and the `autoDriver`, `bunDriver` and `nodeDriver` exports are removed.

```ts
// 0.3.x
const fileServer = createFileServer({ uploadDir: './var/uploads', driver: autoDriver });

// 0.4.0
const fileServer = createFileServer({ attachments });
```

**What to do:** pass `attachments` (and `servePrefix` if you changed it), and remove the driver imports.

### `createImageServer` takes the attachment definitions

The `sourceProvider` option is removed: originals are read from each category's provider. `attachments` is required.

```ts
// 0.3.x
createImageServer({ variants, sourceProvider, thumbProvider, focusSecret });

// 0.4.0
createImageServer({ attachments, variants, thumbProvider, focusSecret });
```

The image server is also stricter. The mode segment must be exactly `{e|a|c|b}.{w}x{h}` or `{focus}.{w}x{h}.{hash}`, and the version must be `[a-z0-9]+`; anything else is 404. Thumbnails of deleted originals are no longer served.

**What to do:** replace `sourceProvider` with `attachments`. Build thumbnail URLs only with the client helpers (`makeAttachmentHandler`, `buildVariantUrl`, `buildImageUrl`), not by hand.

### Reverse proxy rules

The 0.3.x proxy patterns (`^/file/([a-z0-9]+)-[a-z0-9]+/…`) do not match the new URLs, so after the upgrade every request goes to the application. It still works, but the proxy no longer serves files directly. Which files the proxy may serve is now decided per category code.

**What to do:** rewrite the proxy rules with an allow-list of public codes, for example `-(?:AV|GA|CV)-`, and send everything else to the application. Build the list with `publicCodes(attachments)`. Never list a code whose category has `authorize`. See [Serving Files](serving.md) and [Access Control](access-control.md).

### Item versions are no longer plain counters

A version was the base36 counter (`3`). It is now the counter followed by six random base36 characters (`3r2jo3l`), so a future version cannot be guessed and cached in advance.

**What to do:** nothing, unless your code parses or compares versions. Treat the version as an opaque string.

### Filenames: URL encoding and the default sanitizer

Filenames are percent-encoded in generated URLs and decoded by the servers. The default sanitizer now cleans the stem and the extension separately and never returns an empty name: `фото.jpg` becomes `file.jpg` (was `jpg`), `.htaccess` becomes `file.htaccess` (was `htaccess`), `a.-b.jpg` becomes `a.b.jpg`. Any sanitizer result must be a single safe path segment (no `/`, `\`, `.`, `..` or control characters), also with `sanitize: false` or a custom sanitizer; otherwise `add` and `rename` throw `AttachmentValidationError` (`Invalid filename "…"`).

**What to do:** use the `url` the library returns instead of building URLs from filenames. If you use `sanitize: false` or your own sanitizer, make sure it never produces path separators or dot segments.

### `reorder()` needs every file

`reorder(filenames)` kept only the names it was given and allowed duplicates, which silently dropped files. It now throws `AttachmentValidationError` unless it receives every current filename exactly once.

**What to do:** always pass the complete list, e.g. the reordered result of `list().map((a) => a.filename)`.

### `replace()` keeps the extension, and its rollback restores the original

`replace()` writes into the existing filename, so the processed file must keep that file's extension. It now throws when it does not, for example when `toWebP()` turns the upload into `.webp` while replacing `a.jpg` (before, WebP bytes were stored as `a.jpg`). Its `rollback()` now puts the original file back; before, it deleted the file the database still referenced. `replace()` keeps the original bytes in memory until it returns.

**What to do:** to change a file's type, `delete()` it and `add()` the new one. If you worked around the old rollback (for example by re-uploading after a failed save), remove that workaround.

### `purge()` is best effort

`purge()` stopped at the first file it could not delete. It now tries every file, keeps the stores of the files it could not delete in `entity.attachments`, and throws an `Error` with an `errors` array. On success it still clears the attachments and emits `attachment:purge`.

**What to do:** persist `entity.attachments` after `purge()` even when it throws, so the files that are still there stay listed.

### `delete()` succeeds when the file is already missing

`delete()` threw when the physical file was gone (local provider). It now removes the record anyway.

**What to do:** remove error handling that relied on that exception.

### `imgstat()` and `getMp3Duration()` return a new meta object

Both middlewares wrote into the `meta` object they received. They now return a new object and leave yours untouched. `imgstat()` also stores the displayed width and height for photos with EXIF rotation, and `toWebP()` now applies the rotation and keeps animations.

**What to do:** read the metadata from the returned attachment (`attachment.meta`), not from the object you passed in. Custom middleware should also return a new `meta`.

### Access control and security headers

A category can declare `authorize`; its files and thumbnails are then checked on every request and served with `Cache-Control: private, no-store`. Every served file gets `X-Content-Type-Options: nosniff`, and HTML, XHTML, SVG, XML and JavaScript files are forced to download (`Content-Disposition: attachment` with a sandboxing CSP) instead of being shown inline.

**What to do:** if your application displayed uploaded HTML or SVG files directly from `/file` URLs, embed SVGs with `<img>` (which still works) or serve such files another way. Add the same headers to proxy locations that serve files directly (see [Serving Files](serving.md)).

### S3 `exists()` reports errors

`exists()` returned `false` for every error, so credential or network problems looked like missing files. It now returns `false` only for "not found" and rethrows everything else.

**What to do:** give the S3 credentials `s3:ListBucket` on the bucket. Without it, S3 answers 403 instead of 404 for missing keys, which now surfaces as an error.

### Peer dependencies are optional, `zod` is removed

`sharp` and `music-metadata` are now optional peer dependencies, so npm no longer installs them automatically. `zod` is no longer a peer dependency; the package never used it.

**What to do:** install `sharp` if you use image middleware or the image server, and `music-metadata` if you use `getMp3Duration()`. Add `zod` to your own dependencies if your code uses it.

### Prisma: use the extension

`createPrismaMiddleware` (for `prisma.$use`) is deprecated: `$use` is deprecated in Prisma 4.16 and removed in newer Prisma versions.

```ts
// 0.3.x
prisma.$use(createPrismaMiddleware(eventManager));

// 0.4.0
const prisma = new PrismaClient().$extends(createPrismaExtension(eventManager));
```

**What to do:** switch to `createPrismaExtension`. It fires `entity:deleted` after a single-record `delete`; for `deleteMany`, load the records and purge their attachments yourself.
