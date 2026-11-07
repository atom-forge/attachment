# Development rules

Development rules of this package. Unlike `AGENTS/changelog.md` and `AGENTS/documentation.md`, this file is not shared with other AtomForge packages.

## General

- Keep changes focused and consistent with the existing code style. Edit the sources, never generated output.
- Preserve the public API and its behavior unless a breaking change is explicitly requested. A change that may require action from users is breaking: follow `AGENTS/changelog.md` and the *Upgrading chapter* rules in `AGENTS/documentation.md`.
- A change to the public API or its behavior is also a documentation change: update the documentation in the same task, following `AGENTS/documentation.md`.
- Before finishing, run the checks listed below and report what passed or failed.
- Only commit, push, or publish when asked.

## Project

- Source in `src/`: `define-attachments.ts`, `client.ts` / `client-handler.ts`, `storage/` (local and S3 providers), `image/` (image server and URLs), `file-server/`, `prisma/` (Prisma middleware), `middlewares/`. Atomic mode: `atomic-handler.ts`; helpers shared by both handlers: `handler-utils.ts`. `dist/` is built with `tsc`.
- Tests live in `test/` and run with `bun run test` (`bun test`); `bun run build` (which runs `tsc`) is the typecheck. Add tests when changing behavior. `sharp` hangs under Bun: test image features with Node against `dist/`.
- Release: `bun run pub <patch|minor|major>` · Verify: `bun run pub-check`
