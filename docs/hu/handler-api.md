# Handler API

## Handler létrehozása

```ts
const h = attachments.user(entity);
// az entity-nek tartalmaznia kell az `attachments` mezőt az adatbázis sorból
```

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

### `add(file, meta)`

```ts
const { attachment, rollback } = await h.avatar.add(file, {});
```

- Lefuttatja a middleware pipeline-t
- Sanitizálja a fájlnevet (diakritikák, speciális karakterek eltávolítása) — `sanitize` opcióval konfigurálható vagy kikapcsolható
- Névütközést felold: `photo.png` → `photo(1).png` → `photo(2).png` …
- Növeli a verzióscámlálót; új `version`-t rendel az elemhez
- Első hozzáadásnál generál egy `groupId`-t (UUID → base36)

### `replace(filename, file, meta)`

```ts
const { attachment, rollback } = await h.avatar.replace('photo.jpg', file, {});
```

- Lefuttatja a middleware pipeline-t
- Helyben felülírja a fizikai fájlt; növeli a verziót → új URL (cache-bustolva)
- `AttachmentValidationError`-t dob, ha a `filename` nem található

### `updateMeta(filename, meta)`

```ts
const updated = await h.avatar.updateMeta('photo.jpg', { caption: 'Hello' });
```

Nincs fájl I/O. Növeli a verziót → új URL. Hibát dob, ha nem található.

### `rename(oldName, newName)`

```ts
await h.avatar.rename('photo.jpg', 'profile.jpg');
```

Sanitizálja az `newName`-t. Hibát dob, ha a sanitizált név már létezik a kategóriában.

### `delete(filename)`

```ts
await h.avatar.delete('photo.jpg');
```

Törli a fizikai fájlt és eltávolítja a rekordot. **Nem** növeli a verzióscámlálót.

### `reorder(filenames)`

```ts
h.gallery.reorder(['b.png', 'a.png', 'c.png']);
```

Átrendezi a JSON tömböt. Nincs fájl I/O. Nincs verzió növelés.

---

## `purge()` — entitás szintű törlés

```ts
await h.purge();
```

Minden fájlt töröl az összes kategóriából. Beállítja `entity.attachments = {}`-t. Provider szükséges. Utána `prisma.update`-tel kell menteni.

---

## Rollback minta

Az `add` és `replace` visszaad egy `rollback` függvényt, ami törli a fizikai fájlt, ha a DB írás sikertelen:

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
| `nextGroupId`  | `(entityType, entityId, category) => Promise<string>`  | UUID → base36    | Egyedi group ID generátor                         |
| `sanitize`     | `false \| true \| (name) => string`                    | `true` (beépített)| Fájlnév sanitizálás                              |
| `findUnique`   | `(existing, name) => string`                           | `base(n)ext`     | Névütközés feloldás az `add()`-hoz                |
| `eventManager` | `EventEmitter`                                         | —                | Event busz az attachment életciklus eseményekhez  |