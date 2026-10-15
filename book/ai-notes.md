# AI Notes

A coding agent works best when it reads the documentation of the package first and knows the decisions your project has already made. Copy the fenced block below into the instruction file of your project (for example `AGENTS.md`) and replace every `<...>` field with a fact you have verified in your application.

## Purpose

Use the package documentation for file-management behavior and a separately
filled project map for storage, ownership, serving, and persistence decisions.

## Copyable instructions

```markdown
## AtomForge Attachment

Before implementing uploads, replacement, deletion, image variants, or file
serving with `@atom-forge/attachment`, start with
`node_modules/@atom-forge/attachment/README-AI.md` at the package root, then follow
its pointers to the task-relevant documentation. Follow dependency symlinks to
the library repository when present. Use documentation matching the installed
version; Markdown filesystem paths are not package import subpaths.

Read the task-relevant entity/category, pipeline, provider, persistence,
rollback/cleanup, and client/serving guidance. Verify the actual documented API
before selecting an operation or assuming automatic lifecycle behavior.

This project's attachment setup:

- Service / configuration location: <CONFIGURATION_LOCATION>
- Owning entity and metadata contract: <OWNERSHIP_AND_METADATA>
- Category definitions and upload rules: <CATEGORY_LOCATION_AND_POLICY>
- Storage provider and configuration: <PROVIDER_AND_CONFIG_LOCATION>
- Image variant definitions: <VARIANT_LOCATION_OR_NOT_USED>
- Serving routes and URL conventions: <SERVING_LOCATION_AND_URLS>
- Browser-safe URL helpers: <CLIENT_HELPERS_OR_NOT_USED>
- Persistence boundary: <PERSISTENCE_OWNER>
- Failure compensation and cleanup: <FAILURE_POLICY>
- Replacement / deletion ownership: <LIFECYCLE_POLICY>

Use this project's verified setup; do not assume a storage backend, ORM, bucket,
URL prefix, local helper, or automatic cleanup that has not been configured.
Keep storage credentials and server-only processing dependencies out of browser
code.

File storage and database updates may have separate failure boundaries. Preserve
existing metadata and define what happens when either operation fails. Use the
package's rollback facility only where the installed version documents it;
do not invent a compensation API. Verify replacement, deletion, and retry
behavior before relying on them.
```

## Usage

Fill the project fields using actual configuration and call sites. Record
unused capabilities explicitly. This note intentionally supplies no fake
bucket names, schemas, wrappers, upload code, or presumed storage guarantees.
