# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [0.5.0] - 2026-11-07

### Added
- **Atomic mode** for concurrent writes (opt-in): with an `atomic(ctx, mutate)` function on `defineAttachments` (or on one entity), the package saves every change itself in one short atomic step, so concurrent requests — in one process or across instances — never overwrite each other. Uploads run outside the lock; files are only created where nothing exists and only overwritten if unchanged (concurrent same-name uploads get separate names, a deleted file never comes back, a replace of a deleted file fails and leaves nothing); `count()` and `sumSize()` hold under concurrent uploads; crash leftovers are swept as orphans after `orphanAge` (default one day). The JSON format, file names and folders are unchanged. In atomic mode `add`/`replace` return the attachment without `rollback`, and `updateMeta`/`reorder` are asynchronous; the types follow the option. New chapter *Concurrent Writes* with Prisma examples (row lock, compare-and-set).
- Optional storage provider methods `create`, `copy`, `list`, `etag` and `replaceIf` (needed only in atomic mode, checked at startup), implemented by the local provider and the S3 provider (S3 conditional writes: `If-None-Match`, `If-Match`; `list` needs `s3:ListBucket`).
- Optional synchronous `check(file, files)` part on upload middleware, re-run on the fresh list in atomic mode; `count()` and `sumSize()` provide it.
- `test` script (`bun test`) with tests for atomic mode.
- `TODO.md` follow-ups for atomic mode (real database and S3 checks, a sweep for never-changed entities); `AGENTS/devrules.md` describes the test setup and the new source files.
- `TODO.md` for planned work and a `notes/` folder for ideas, plans, and specs, with rules in `AGENTS.md`: neither is an instruction, finished items leave `TODO.md`, and neither is shipped.

### Changed
- Agent instructions follow the AtomForge structure: `AGENTS.md` holds a short project description, a pointer to `README-AI.md`, the documentation model, and when to read which rule file. `AGENTS/devrules.md` holds this package's own development rules, source layout, and commands; `AGENTS/changelog.md` and `AGENTS/documentation.md` are shared and identical in every AtomForge package (`documentation.md` covers the book-first and reference-first documentation models, BookMD authoring with a link to the canonical BookMD LLM reference, the upgrading chapter, and `README-AI.md` versus AI Notes).
- `README.md` has a uniform *Documentation* section linking to the published book, the English and Hungarian docs, and `README-AI.md`.

---

## [0.4.0] - 2026-11-05

> **Breaking release.** Category definitions, group ids, URLs and the file/image server options change; data stored by earlier versions (plain random group ids) is not supported and no migration is provided.

### Added
- Documentation rules in `AGENTS.md`: the `book/` BookMD book is the source of truth (intro, usage chapters, upgrading, AI Notes); changes flow one way to `docs/en/` (a single page or chapter files mirroring the book, depending on size; AI Notes stays book-only) and then to its Hungarian translation in `docs/hu/`; every change that may require user action is documented in `book/upgrading.md` (with `Unreleased` as the target version until it is decided) and marked **Breaking:** in the changelog; `README-AI.md` is kept in sync with the AI Notes chapter.
- **Access control per category.** A category may declare an `authorize({ request, entityType, entityId, category, filename })` hook: every file and thumbnail request of that category runs it (403 when denied) and is served with `Cache-Control: private, no-store`. Whether files are public is otherwise decided only by the reverse proxy, which serves an allow-list of public codes directly and sends everything else to the application.
- `publicCodes(attachments)` returns the codes of categories without `authorize`, for building the proxy allow-list pattern.
- Per-category `provider` (e.g. a non-public S3 prefix for access-controlled categories); `purge()` deletes each category's files through its own provider.
- `idType` entity option (`'int'` default, or `'uuid'`) controlling how the entity id is encoded into group ids; `encodeEntityId`, `decodeEntityId`, `parseGroupId` and the `CategoryConfig`, `AuthorizeFn`, `AuthorizeContext`, `EntityIdType`, `ParsedGroupId` types are exported.
- `createFocusHash(focusSecret)`: the focus-hash function the image server checks, for `imgstat(focus, createFocusHash(secret))`, so manual-focus thumbnail URLs can be produced.
- `createImageServer({ eventManager })` emits the documented `thumbnail:generated` event.
- `createPrismaExtension(eventManager)` for `prisma.$extends(...)`, firing `entity:deleted` after a single-record `delete`.
- `book/` folder: the English documentation as a BookMD collection (a `book.md` entry file, seven usage chapters including *Access Control*, *Upgrading* and *AI Notes*), with callouts and Mermaid diagrams, a book introduction, chapter leads and short explanations before each diagram.
- *Upgrading* chapter (`book/upgrading.md`, mirrored in `docs/en` and `docs/hu`) with the 0.3.3 → 0.4.0 migration notes: every change that needs action, with before/after examples and what to do.

### Changed
- **Breaking:** every category is an object with a mandatory, unique two-character `code` (`[A-Z0-9]`): `{ code, middlewares?, authorize?, provider? }`; the middleware-array form is no longer accepted.
- **Breaking:** every group id is a composite key `{random}-{CODE}-{entityId base36}` and is also the storage folder, so a URL identifies the category and the owner, and a tampered entity id points to a missing path (404). `nextGroupId` now returns only the lowercase base36 random part. Attachments can only be added to a saved entity with an id of the configured `idType`.
- **Breaking:** `createFileServer({ attachments, servePrefix? })` resolves each URL's category from the `defineAttachments` result and streams from the category's provider; the `uploadDir`, `provider` and `driver` options and the `autoDriver`, `bunDriver` and `nodeDriver` exports are removed.
- **Breaking:** `createImageServer({ attachments, ... })` reads originals from the category's provider; the `sourceProvider` option is removed. Categories with `authorize` get thumbnails after authorization (`private, no-store`).
- **Breaking:** Item versions carry a random suffix after the base36 counter, so a future version URL cannot be requested in advance to pin stale content in the thumbnail cache or a CDN.
- **Breaking:** `sharp` and `music-metadata` are optional peer dependencies (`peerDependenciesMeta`), so npm no longer installs them automatically.
- **Breaking:** `purge()` is best effort: it tries every file, keeps the stores of files that could not be deleted in `entity.attachments` and throws an error listing them.
- The client handler and `buildVariantUrl` use a stored focus point (`meta.img.c`) when its hash (`meta.img.ch`) is present.
- Documentation updated throughout for the new model: object categories, composite group ids, proxy allow-lists of public codes, the new server options and the *Access Control* chapter.
- Book chapters are no longer numbered (`book/getting-started.md`, …), the access-control chapter is `access-control.md` in the book and in `docs/en`/`docs/hu`, and `docs/en`/`docs/hu` mirror every book chapter, including the new *Upgrading* and *AI Notes* pages; the book intro and `docs/*/index.md` describe the audience and the reading order.
- `AGENTS.md`: documentation rules — the book is the source of truth (book → `docs/en` → `docs/hu`), the book's structure (intro, usage chapters, *Upgrading*, *AI Notes*), the upgrading chapter workflow with **Breaking:** changelog marks, and keeping `README-AI.md` consistent with the AI Notes chapter.
- `README-AI.md` links the documentation index and the *Upgrading* page and points to the documentation workflow; the AI Notes block tells projects to read the upgrading page when upgrading and to record their category codes and access policy.

### Deprecated
- **Breaking:** `createPrismaMiddleware` (`prisma.$use`): `$use` is deprecated in Prisma 4.16 and removed in newer Prisma versions; use `createPrismaExtension`.

### Removed
- **Breaking:** `zod` peer and dev dependency, and the documented zod "schema validation middleware", which never existed: nothing in the package used zod, but npm 7+ installed it for every user.
- **Breaking:** `autoDriver`, `bunDriver`, `nodeDriver` and the `FileServerDriver` type (the file server streams through each category's provider), and the base62 helpers of the earlier unreleased private-category draft.

### Fixed
- A failed thumbnail generation (e.g. a non-image file requested through `/img`) no longer crashes the process with an unhandled promise rejection.
- **Breaking:** `replace()` rollback restores the original file instead of deleting the file the database still references; a failed save during `replace` also restores it.
- Concurrent `add`/`replace`/`rename`/`delete`/`purge` calls on the same entity object are serialized, and each mutation re-reads the store before writing, so parallel uploads (and `updateMeta`/`reorder` calls made meanwhile) are no longer lost.
- **Breaking:** `reorder()` throws `AttachmentValidationError` unless it receives every current filename exactly once, instead of silently dropping or duplicating files.
- **Breaking:** Image server: the mode segment is parsed strictly (`{e|a|c|b}.{w}x{h}` or `{focus}.{w}x{h}.{hash}`) and the version must be `[a-z0-9]+`, validated before the cache lookup, so URL variations can no longer create unlimited thumbnails or collide in the flat cache key; thumbnails of deleted originals are no longer served from the cache.
- **Breaking:** Default filename sanitizer: cleans the stem and the extension separately (no more `фото.jpg` → `jpg` or `.htaccess` → `htaccess`), falls back to `file` instead of an empty name, and the dead dot-dash rule now works (`a.-b.jpg` → `a.b.jpg`).
- **Breaking:** Filenames are percent-encoded in generated file and thumbnail URLs and decoded by the servers, so names with spaces, `#`, `?` or non-ASCII characters can be served.
- **Breaking:** `toWebP()` applies the EXIF orientation (phone photos were saved sideways) and keeps animations; `imgstat()` reports the displayed width/height for rotated images.
- **Breaking:** `replace()` throws `AttachmentValidationError` when the processed file's extension differs from the stored name (e.g. `toWebP()` while replacing `a.jpg`), instead of storing WebP bytes as `.jpg`.
- **Breaking:** `imgstat()` and `getMp3Duration()` return a new meta object instead of mutating the caller's, so one meta object reused for several uploads no longer leaks data between them.
- **Breaking:** `delete()` succeeds when the physical file is already missing (the local provider ignores ENOENT), so such records can be removed.
- **Breaking:** S3 provider: `stream()` reads on demand and cancels the S3 body when the client disconnects; `exists()` returns `false` only for "not found" and rethrows credential/network errors; `rename()` to the same key is a no-op and the copy source is URL-encoded.
- Client `find()` glob: `?` is matched literally instead of acting as a regex quantifier.
- `package.json` `exports` list `types` before `import`.
- Serving documentation describes the real file/image server API (`match(request)` / `handle(request)` on Web `Request`/`Response`) with constructor options and updated SvelteKit, Hono, Express, Next.js and Nuxt examples; the handler documentation no longer shows `await` on the synchronous `updateMeta`, and refers to the real `generateImage` export.
- Changelog: the 0.2.1 entry no longer refers to the removed `docs/llm/` folder, and the 0.3.0 breaking note uses a standard category.

### Security
- **Breaking:** Fixed a path traversal in the file and image servers: a URL such as `/file/..-1/.env` could read files outside the upload directory. Group ids and filenames are validated as single safe path segments in both servers, the local provider refuses paths outside its root, and `add`/`rename` reject unsafe filenames (also with `sanitize: false` or a custom sanitizer).
- **Breaking:** The file server sends `X-Content-Type-Options: nosniff` with every file and forces HTML/XHTML/SVG/XML/JavaScript files to download with a sandboxing CSP, so uploaded active content cannot run on the application's origin; the serving docs show the matching proxy headers.

---

## [0.3.3] - 2026-10-07

---

## [0.3.2] - 2026-08-28

### Added
- Optional `prefix` configuration for the S3/MinIO provider, allowing multiple logical storage providers to share one bucket under separate object-key namespaces.

---

## [0.3.1] - 2026-08-27

---

## [0.3.0] - 2026-05-26

### Added
- **`@atom-forge/attachment/client` entry point** — browser-safe sub-package exposing `makeAttachmentHandler`, `buildImageUrl`, `buildVariantUrl`, and the related types (`ImgVariants`, `ItemView`, `CategoryView`, `AttachmentHandlerFor`, `AttachmentHandlerOptions`)

### Changed
- `makeAttachmentHandler` and its types moved from the main package to `@atom-forge/attachment/client`
- `buildImageUrl` and `buildVariantUrl` moved from the main package to `@atom-forge/attachment/client`

### Removed
- **Breaking:** `makeAttachmentHandler`, `buildImageUrl`, `buildVariantUrl` are no longer exported from `@atom-forge/attachment` — import them from `@atom-forge/attachment/client` instead

---

## [0.2.1] - 2026-05-17

### Added
- **S3/MinIO provider** (`createS3Provider`) — full `StorageProvider` implementation backed by `@aws-sdk/client-s3`; saves always set `Cache-Control: immutable`; rename is CopyObject + DeleteObject with `storage:rename-cleanup-failed` event on partial failure
- **Event system** — `EventEmitter` interface + `AttachmentEvent` union type; `defineAttachments` fires lifecycle events (`attachment:add`, `attachment:replace`, `attachment:delete`, `attachment:rename`, `attachment:meta-updated`, `attachment:purge`) after every mutation
- **Prisma middleware** (`createPrismaMiddleware`) — fires `entity:deleted` on every Prisma `delete` for automatic attachment purge wiring
- `StorageProvider` extended with `read(path): Promise<Buffer>` and `stream(path): ReadableStream` methods
- `nextGroupId` is now optional — defaults to `crypto.randomUUID()` converted to base36; custom callback still supported for DB-backed or deterministic IDs

### Changed
- Documentation restructured: README is now an index; full docs split into `docs/en/` and `docs/hu/` (Hungarian) across 6 topic files each

---

## [0.1.2] - 2026-03-28
- Initial release.
