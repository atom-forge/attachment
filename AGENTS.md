# Agent Instructions

## Changelog

Always record every change in `CHANGELOG.md` as part of the same task, including code, documentation, configuration, and agent-instruction changes. A task is not complete until its changelog entry is updated.

- Add entries under `## [Unreleased]` using the appropriate Keep a Changelog category: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, or `Security`.
- Write concise entries in English describing what changed and its impact. Related changes may share one entry; avoid duplicate entries.
- Preserve existing entries and released version sections. Do not bump the version or create a release section unless explicitly asked to prepare or publish a release.
- Start an entry with `**Breaking:**` when the change may require action from users, and document it in the book's upgrading chapter (see *Upgrading chapter* below).

## Documentation

The book in `book/` (entry: `book/book.md`, BookMD format, published at https://books.atom-forge.eu) is the source of truth for the documentation. Its structure:

1. Intro — `book/book.md`: overview, audience, and reading guide.
2. Usage chapters — `getting-started.md`, `handler-api.md`, `middleware.md`, `image.md`, `serving.md`, `storage.md`, `access-control.md`.
3. Upgrading — `book/upgrading.md`: migration notes between versions (see below).
4. AI Notes — `book/ai-notes.md`: copyable instructions for coding agents working in projects that use the package.

When adding, removing, or renaming a chapter, update both the `children` list and the reading guide in `book/book.md`.

Changes always flow in one direction:

1. `book/` — write or change the documentation here first.
2. `docs/en/` — the English docs derived from the book. Update it to reflect the book change. Its structure depends on size: a small documentation fits on a single page (`docs/en/index.md`); a larger one is split into chapter files that mirror the book's chapters, with `docs/en/index.md` as the entry page linking to them. The intro, the usage chapters, and Upgrading are carried over; AI Notes stays in the book only, because `README-AI.md` fills that role in the package.
3. `docs/hu/` — the Hungarian translation of `docs/en/`. Mirror its structure file by file and keep it in sync with the English docs, section by section.

Both `docs/en/` and `docs/hu/` are shipped in the npm package. Never change `docs/en` or `docs/hu` without the corresponding book change.

### Upgrading chapter

`book/upgrading.md` is the migration guide. Every change that may require action from users must be documented there in the same task: changed or stricter behavior, removed or renamed API, changed types, changed error messages, and new runtime or package requirements.

- Add it to the section of the upcoming release (`## From <previous> to <next>`); create that section at the top of the chapter, below the introduction, if it does not exist yet. If the next version has not been decided, use `Unreleased` as `<next>` (for example `## From 0.3.19 to Unreleased`) and rename the section when the release is prepared — do not pick a version number yourself.
- Give each change its own subsection: what changed, before/after behavior (a table or example where it helps), and a **What to do:** paragraph.
- Changes that need no action stay out of this chapter; the changelog covers them.
- Start the change's `CHANGELOG.md` entry with **Breaking:**, and carry the update over to `docs/en` and `docs/hu` like any other book change.

### README-AI.md

`README-AI.md` in the repository root is the AI usage guide shipped in the npm package; coding agents in consuming projects read it first. Maintain it together with the book's AI Notes chapter (`book/ai-notes.md`), which tells those projects to start from it:

- When a change affects the essential usage rules, the minimal working example, common extensions, or the documentation map, update `README-AI.md` in the same task.
- Keep `README-AI.md` and `book/ai-notes.md` consistent: file paths, reading order, and rules referenced by one must match the other.
