# Changelog rules

Shared by every AtomForge package; keep this file identical in all of them (see the root `AGENTS.md`).

Always record every change in `CHANGELOG.md` as part of the same task, including code, documentation, configuration, and agent-instruction changes. A task is not complete until its changelog entry is updated.

- Add entries under `## [Unreleased]` using the appropriate Keep a Changelog category: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, or `Security`.
- Write concise entries in English describing what changed and its impact. Related changes may share one entry; avoid duplicate entries.
- Preserve existing entries and released version sections. Do not bump the version or create a release section unless explicitly asked to prepare or publish a release.
- Start an entry with `**Breaking:**` when the change may require action from users, and document it in the book's upgrading chapter (see *Upgrading chapter* in `AGENTS/documentation.md`).
