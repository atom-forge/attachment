# AI jegyzetek

Egy kódoló ágens akkor dolgozik a legjobban, ha előbb elolvassa a csomag dokumentációját, és ismeri a projekted már meghozott döntéseit. Másold az alábbi blokkot a projekted utasításfájljába (például `AGENTS.md`), és cserélj ki minden `<...>` mezőt egy olyan tényre, amelyet az alkalmazásodban ellenőriztél.

## Cél

A fájlkezelés működéséhez a csomag dokumentációját használd, a tárolási, tulajdonosi,
kiszolgálási és perzisztálási döntésekhez pedig egy külön kitöltött projekttérképet.

## Másolható utasítások

A blokk szándékosan angol maradt, mert a projektek ágensutasítás-fájljai általában angolul íródnak.

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
When upgrading the package, read `docs/en/upgrading.md` in the package for the
changes that need action between the installed and the new version.

This project's attachment setup:

- Service / configuration location: <CONFIGURATION_LOCATION>
- Owning entity and metadata contract: <OWNERSHIP_AND_METADATA>
- Category definitions and upload rules: <CATEGORY_LOCATION_AND_POLICY>
- Category codes and access control (`authorize`, proxy public-code list): <CODES_AND_ACCESS_POLICY>
- Storage provider and configuration: <PROVIDER_AND_CONFIG_LOCATION>
- Image variant definitions: <VARIANT_LOCATION_OR_NOT_USED>
- Serving routes and URL conventions: <SERVING_LOCATION_AND_URLS>
- Browser-safe URL helpers: <CLIENT_HELPERS_OR_NOT_USED>
- Persistence boundary: <PERSISTENCE_OWNER>
- Concurrent writes (atomic mode and its `atomic` function, or default mode): <ATOMIC_MODE_OR_DEFAULT>
- Failure compensation and cleanup: <FAILURE_POLICY>
- Replacement / deletion ownership: <LIFECYCLE_POLICY>

Use this project's verified setup; do not assume a storage backend, ORM, bucket,
URL prefix, local helper, or automatic cleanup that has not been configured.
Keep storage credentials and server-only processing dependencies out of browser
code.

File storage and database updates may have separate failure boundaries. Preserve
existing metadata and define what happens when either operation fails. Use the
package's rollback facility only where the installed version documents it;
do not invent a compensation API. In atomic mode the operations save
themselves: never write the attachments column or save a whole loaded row over
it. Verify replacement, deletion, and retry
behavior before relying on them.
```

## Használat

A projektmezőket a tényleges konfiguráció és hívási helyek alapján töltsd ki. A nem
használt képességeket is jelöld kifejezetten. Ez a jegyzet szándékosan nem ad kitalált
bucketneveket, sémákat, wrappereket, feltöltőkódot vagy feltételezett tárolási garanciákat.
