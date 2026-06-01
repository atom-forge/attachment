# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-06-01

### Changed
- Automated npm publishing via GitHub Actions (Trusted Publishing / OIDC) — no token required

---

## [0.3.0] - 2026-05-26

### Added
- **`@atom-forge/attachment/client` entry point** — browser-safe sub-package exposing `makeAttachmentHandler`, `buildImageUrl`, `buildVariantUrl`, and the related types (`ImgVariants`, `ItemView`, `CategoryView`, `AttachmentHandlerFor`, `AttachmentHandlerOptions`)

### Changed
- `makeAttachmentHandler` and its types moved from the main package to `@atom-forge/attachment/client`
- `buildImageUrl` and `buildVariantUrl` moved from the main package to `@atom-forge/attachment/client`

### Breaking
- `makeAttachmentHandler`, `buildImageUrl`, `buildVariantUrl` are no longer exported from `@atom-forge/attachment` — import them from `@atom-forge/attachment/client` instead

---

## [0.2.1] - 2026-05-17

### Added
- **S3/MinIO provider** (`createS3Provider`) — full `StorageProvider` implementation backed by `@aws-sdk/client-s3`; saves always set `Cache-Control: immutable`; rename is CopyObject + DeleteObject with `storage:rename-cleanup-failed` event on partial failure
- **Event system** — `EventEmitter` interface + `AttachmentEvent` union type; `defineAttachments` fires lifecycle events (`attachment:add`, `attachment:replace`, `attachment:delete`, `attachment:rename`, `attachment:meta-updated`, `attachment:purge`) after every mutation
- **Prisma middleware** (`createPrismaMiddleware`) — fires `entity:deleted` on every Prisma `delete` for automatic attachment purge wiring
- `StorageProvider` extended with `read(path): Promise<Buffer>` and `stream(path): ReadableStream` methods
- `nextGroupId` is now optional — defaults to `crypto.randomUUID()` converted to base36; custom callback still supported for DB-backed or deterministic IDs

### Changed
- Documentation restructured: README is now an index; full docs split into `docs/en/`, `docs/hu/` (Hungarian), and `docs/llm/` (compact LLM reference) across 6 topic files each

---

## [0.1.2] - 2026-03-28
- Initial release.
