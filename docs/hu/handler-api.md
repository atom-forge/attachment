# Handler API

## Handler létrehozása

```ts
const h = attachments.user(entity);
// az entity-nek tartalmaznia kell az `attachments` mezőt az adatbázis sorból
```

Fájlt csak **mentett** entitáshoz lehet hozzáadni: az azonosító mezőnek (`idField`) léteznie kell és illeszkednie kell az entitás `idType`-jához (`'int'` vagy `'uuid'`), különben az `add` egyértelmű hibaüzenettel dob.

Az `h` minden kulcsa egy `CategoryHandler` a megfelelő kategóriához:

```ts
h.avatar   // CategoryHandler az 'avatar' kategóriához
h.gallery  // CategoryHandler a 'gallery' kategóriához
```

---

## Olvasás

```ts
h.avatar.list()            // AttachmentData[] — összes fájl a kategóriában
h.avatar.get('photo.jpg')  // AttachmentData | undefined
```

---

## Írás

Minden írási metódus **helyben módosítja az `entity.attachments`-t**. Minden írás után `prisma.update`-tel kell menteni.

Ez az oldal az alapmódot írja le. Atomi módban az írási metódusok maguk mentenek, az `add` és a `replace` `rollback` nélkül adja vissza a csatolmányt, az `updateMeta` és a `reorder` pedig aszinkron — lásd [Egyidejű írások](concurrency.md).

### `add(file, meta)`

```ts
const { attachment, rollback } = await h.avatar.add(file, {});
```

- Lefuttatja a middleware pipeline-t
- Sanitizálja a fájlnevet (diakritikák, speciális karakterek eltávolítása; a törzset és a kiterjesztést külön tisztítja, az üres törzsből `file` lesz, pl. `фото.jpg` → `file.jpg`) — `sanitize` opcióval konfigurálható vagy kikapcsolható. A sanitizer eredményének egyetlen biztonságos útvonalszegmensnek kell lennie (nincs benne `/`, `\`, nem `.`/`..`, nincs vezérlőkarakter), különben `AttachmentValidationError`-t dob
- Névütközést felold: `photo.png` → `photo(1).png` → `photo(2).png` …
- Növeli a verziószámlálót; új `version`-t rendel az elemhez (base36 számláló plusz véletlen utótag, így a jövőbeli verziók URL-je nem kitalálható)
- Első hozzáadásnál generál egy összetett `groupId`-t: `{random}-{CODE}-{entityId36}`, pl. `k3x9q-AV-39x9` (véletlen base36 rész, a kategória kódja, az entitás azonosítója base36-ban). Ez egyben a tárolási mappa is, a fájl URL-je pedig pl. `/file/k3x9q-AV-39x9-1r2jo3l/photo.jpg`. Régi (csak véletlen részből álló) group ID-ra az `add` és a `replace` `AttachmentValidationError`-t dob

### `replace(filename, file, meta)`

```ts
const { attachment, rollback } = await h.avatar.replace('photo.jpg', file, {});
```

- Lefuttatja a middleware pipeline-t
- Helyben felülírja a fizikai fájlt; növeli a verziót → új URL (cache-bustolva)
- A feldolgozott fájlnak meg kell tartania a tárolt fájl kiterjesztését (pl. ha a `toWebP()` `.webp`-vé alakítja a feltöltést, az `a.jpg` cseréje `AttachmentValidationError`-t dob); ilyenkor törölj és adj hozzá újat
- Az eredeti fájl tartalmát a visszatérésig memóriában tartja, így a `rollback()` vissza tudja állítani
- `AttachmentValidationError`-t dob, ha a `filename` nem található

### `updateMeta(filename, meta)`

```ts
const updated = h.avatar.updateMeta('photo.jpg', { caption: 'Hello' });
```

Szinkron, nincs fájl I/O. Növeli a verziót → új URL. Hibát dob, ha nem található.

### `rename(oldName, newName)`

```ts
await h.avatar.rename('photo.jpg', 'profile.jpg');
```

Sanitizálja az `newName`-t. Hibát dob, ha a sanitizált név már létezik a kategóriában.

### `delete(filename)`

```ts
await h.avatar.delete('photo.jpg');
```

Törli a fizikai fájlt és eltávolítja a rekordot. Akkor is sikeres, ha a fizikai fájl már nem létezik. **Nem** növeli a verziószámlálót.

### `reorder(filenames)`

```ts
h.gallery.reorder(['b.png', 'a.png', 'c.png']);
```

Átrendezi a JSON tömböt. Szinkron, nincs fájl I/O. Nincs verzió növelés. A `filenames` tömbnek minden jelenlegi fájlt pontosan egyszer kell tartalmaznia, különben `AttachmentValidationError`-t dob (fájlt soha nem hagy el és nem duplikál).

---

## `purge()` — entitás szintű törlés

```ts
await h.purge();
```

Minden fájlt töröl az összes kategóriából (mindegyiknél a kategória saját providerét használja). Provider szükséges. Utána `prisma.update`-tel kell menteni.

Best effort működés: minden fájlt megpróbál törölni. Ha mind sikerül, beállítja `entity.attachments = {}`-t és kiváltja az `attachment:purge` eseményt. Ha néhány fájl nem törölhető, azok tárolói az `entity.attachments`-ben maradnak, majd `Error`-t dob, amelynek `errors` tömbje tartalmazza az egyes hibákat — ilyenkor is mentsd a megmaradt `attachments`-t, hogy a sikeresen törölt fájlok ne maradjanak benne.

---

## Rollback minta

Az `add` és a `replace` visszaad egy `rollback` függvényt, amit akkor kell hívni, ha az utána következő DB írás sikertelen. Az `add`-nál törli az új fájlt, a `replace`-nél visszaállítja az eredetit. A módosított `attachments` JSON-t nem állítja vissza, ezért utána dobd el vagy töltsd újra az entitást:

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

| Opció          | Típus                                                  | Alapértelmezett  | Leírás                                            |
|----------------|--------------------------------------------------------|------------------|---------------------------------------------------|
| `provider`     | `StorageProvider`                                      | —                | Tárolási backend (local vagy S3)                  |
| `servePrefix`  | `string`                                               | `'/file'`        | URL prefix a generált fájl URL-ekhez              |
| `nextGroupId`  | `(entityType, entityId, category) => Promise<string>`  | UUID → base36    | Egyedi generátor a group ID véletlen részéhez; kisbetűs base36-ot (`[a-z0-9]+`) kell visszaadnia, a kódot és az entitás azonosítóját a könyvtár fűzi hozzá |
| `sanitize`     | `false \| true \| (name) => string`                    | `true` (beépített)| Fájlnév sanitizálás                              |
| `findUnique`   | `(existing, name) => string`                           | `base(n)ext`     | Névütközés feloldás az `add()`-hoz                |
| `eventManager` | `EventEmitter`                                         | —                | Event busz az attachment életciklus eseményekhez  |
| `atomic`       | `AtomicFn`                                             | —                | Bekapcsolja az atomi módot: a csomag minden változást ezen a függvényen keresztül ment (lásd [Egyidejű írások](concurrency.md)) |
| `orphanAge`    | `number` (másodperc)                                   | `86400`          | Atomi mód: az ennél régebbi, listában nem szereplő fájlokat árvaként törli |

---

## Entitás opciók

`defineAttachments.entity(categories, options?)`

| Opció     | Típus             | Alapértelmezett | Leírás                                                                  |
|-----------|-------------------|-----------------|-------------------------------------------------------------------------|
| `idField` | `string`          | `'id'`          | Az entitás elsődleges kulcs mezője                                      |
| `idType`  | `'int' \| 'uuid'` | `'int'`         | Az azonosító group ID-ba kódolása (base36); string/slug nem támogatott  |
| `atomic`  | `AtomicFn`        | —               | Atomi mód csak ennél az entitásnál; felülírja a `defineAttachments` opciót |

## `CategoryConfig`

Minden kategória egy objektum:

| Mező          | Típus               | Kötelező | Leírás                                                                                         |
|---------------|---------------------|----------|------------------------------------------------------------------------------------------------|
| `code`        | `string`            | igen     | Pontosan két karakter `[A-Z0-9]`, egyedi a `defineAttachments` hívás összes kategóriája között |
| `middlewares` | `UploadMiddleware[]`| nem      | Feltöltési middleware pipeline                                                                 |
| `authorize`   | `AuthorizeFn`       | nem      | Minden fájl- és thumbnail-kérést ellenőriz (`false` → 403), `Cache-Control: private, no-store` |
| `provider`    | `StorageProvider`   | nem      | Kategóriánkénti tárhely; alapértelmezés a `defineAttachments` providere                        |

A kódokat indításkor ellenőrzi: hiányzó, hibás vagy duplikált kód, illetve tömb formájú kategória esetén hibát dob. Az `authorize` és a `provider` részleteit lásd: [Hozzáférés-szabályozás](access-control.md).
