# Documentation rules

Shared by every AtomForge package; keep this file identical in all of them (see the root `AGENTS.md`).

## Documentation model

Every package documents itself with a book, English and Hungarian docs, and `README-AI.md`. The root `AGENTS.md` names the package's documentation model; when it names none, the package is **book-first**.

- **Book-first** (the default) — for packages whose whole documentation reads well as one book. The book is the source of truth, and the docs are derived from it.
- **Reference-first** — for libraries with many independent items (for example a component library) that each need their own reference page. The reference in `docs/en/` is the source of truth; the book is a learning path that embeds the reference instead of copying it.

Both models share everything else in this file: the book's chapters, the Hungarian translation, `README-AI.md`, the upgrading chapter, and AI Notes.

## Book structure

1. Intro — the book's front page: overview, audience, and reading guide.
2. Usage chapters — one file per topic with unnumbered, descriptive file names, ordered in `children` as a reader needs them: getting started first, then the package's concepts and features, then reference material and common pitfalls where the package has them.
3. Upgrading — `book/upgrading.md`: migration notes between versions (see below).
4. AI Notes — `book/ai-notes.md`: copyable instructions for coding agents working in projects that use the package. A package may add further AI Notes pages for specific setups (`book/ai-notes-<topic>.md`), listed in `children` after the main one.

The front page is `book/book.md` in a book-first package and `book.md` in the repository root in a reference-first package (see below). When adding, removing, or renaming a chapter, update both the `children` list and the reading guide on the front page.

## Book-first flow

Changes always flow in one direction:

1. `book/` — write or change the documentation here first.
2. `docs/en/` — the English docs derived from the book. Update it to reflect the book change. Its structure depends on size: a small documentation fits on a single page (`docs/en/index.md`); a larger one is split into chapter files that mirror the book's chapters, with `docs/en/index.md` as the entry page linking to them. The intro, the usage chapters, and Upgrading are carried over; AI Notes stays in the book only.
3. `docs/hu/` — the Hungarian translation of `docs/en/`. Mirror its structure file by file and keep it in sync with the English docs, section by section.
4. `README-AI.md` — the compact, single-file LLM reference derived from `docs/en/` (see *README-AI.md and AI Notes* below). Update it whenever a change to `docs/en/` affects its content.

## Reference-first flow

1. `docs/en/` — the reference and the guides, written first. Each item has its own page; the package's `AGENTS/devrules.md` describes the layout and the page template. A change to an item's behavior or API updates its page in the same task.
2. `docs/hu/` — the Hungarian translation of `docs/en/`, mirrored file by file.
3. The book — mental models, choosing between items, recipes, and pitfalls. It embeds the relevant sections of `docs/en/` with `![[...]]` instead of duplicating them, and states that the reference wins where the two disagree. Because embedded files must lie inside the book, the book's root is the repository root: the front page is `book.md` there, the chapters are in `book/`. A generated reference chapter is regenerated with the package's script, never edited by hand.
4. `README-AI.md` — a navigation guide rather than a full reference: the essential rules and usage contracts, task-based reading routes into `docs/en/`, and how to find the documentation in the installed package.

## Shipping

`docs/en/`, `docs/hu/`, and `README-AI.md` are shipped in the npm package; the book is published at https://books.atom-forge.eu. Never change the docs or `README-AI.md` in a way that contradicts the source of truth of the package's model. `README.md` links to the published book, the docs, and `README-AI.md`. Documentation for developing the package itself belongs in `AGENTS.md` and `AGENTS/`, not in the shipped docs.

## Writing the book

Before writing or editing the book, read the BookMD authoring reference for LLMs: https://atom-forge.github.io/content-assets/0e90e1b186385521/llm.md. Where that reference and these rules disagree on BookMD syntax, the reference wins. Package books follow these conventions:

- The front page sets `title`, `subtitle` (the npm package name), `language: en`, a stable `id` (`atom-forge-<package>`), `author: AtomForge`, and the ordered `children` list, and its body contains the intro and the reading guide.
- Chapter pages start with `type: chapter` frontmatter and a single `#` heading.
- Quote every wikilink or Markdown link in frontmatter lists (`- "[[getting-started.md]]"`).
- Resolve paths relative to the file that contains them, not relative to the book root.
- Keep the book self-contained: every referenced file lives inside the book's root (`book/`, or the repository root in a reference-first package), and the book must be understandable without links outside it.
- Use callouts, tables, and Mermaid diagrams where they make a point clearer; keep code examples complete enough to run and consistent with the current API.

## Upgrading chapter

`book/upgrading.md` is the migration guide. Every change that may require action from users must be documented there in the same task: changed or stricter behavior, removed or renamed API, changed types, changed error messages, and new runtime or package requirements.

- Add it to the section of the upcoming release (`## From <previous> to <next>`); create that section at the top of the chapter, below the introduction, if it does not exist yet. If the next version has not been decided, use `Unreleased` as `<next>` (for example `## From 0.3.19 to Unreleased`) and rename the section when the release is prepared — do not pick a version number yourself.
- Give each change its own subsection: what changed, before/after behavior (a table or example where it helps), and a **What to do:** paragraph.
- Changes that need no action stay out of this chapter; the changelog covers them.
- Start the change's `CHANGELOG.md` entry with **Breaking:**, and carry the update over to the other documents of the package's flow.

## README-AI.md and AI Notes

These are two different documents with different readers; neither is a copy of the other.

- `README-AI.md` (repository root, shipped in the npm package) is the package's AI development guide: a single, rule-first English file and the last step of the documentation flow, derived from `docs/en/`. In a book-first package it is a compact reference: the essential rules and constraints, the public API with signatures, a minimal complete example, common extensions, the pitfalls, and a map of the documentation — without the explanations and diagrams of the book. In a reference-first package it is a navigation guide (see *Reference-first flow*). Either way it states that `docs/en/` is authoritative where the two disagree.
- `book/ai-notes.md` (AI Notes) is a copyable block of instructions that a project using the package puts into its own agent instruction file, with placeholders for that project's own decisions. Update it when the package's usage changes in a way those instructions must reflect.
- If AI Notes refers to `README-AI.md` or other files of the package, keep those references valid.
