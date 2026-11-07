# Egyidejű írások

Alapesetben a handler a memóriában módosítja az entitást, és az `attachments` oszlopot az alkalmazásod menti. Ez egyszerű, de ha két kérés egyszerre módosítja ugyanazt az entitást, mindkettő a saját példányát menti, és a későbbi mentés nyer: a másik kérés által feltöltött fájl eltűnik a listából. Ez a fejezet az opcionális **atomi módot** mutatja be, amelyben a csomag minden változást maga ment el egy általad megadott függvényen keresztül, így az egyidejű kérések — egy folyamaton belül vagy több példány között is — soha nem írják felül egymást.

## Mikor van rá szükség

Akkor használd az atomi módot, ha ugyanannak az entitásnak a fájljai egyszerre több kérésből is változhatnak: több feltöltés ugyanabba a galériába, két felhasználó ugyanazt a rekordot szerkeszti, egy háttérfeladat fut a felhasználói műveletek mellett, vagy több alkalmazáspéldány fut. Ha egy entitást mindig csak egy kérés módosít egyszerre, az alapmód elég.

Az atomi mód opcionális. Nélküle semmi nem változik, és a tárolt adat mindkét módban ugyanaz, így bármikor átválthatsz migráció nélkül.

## Az atomi mód bekapcsolása

Adj meg egy `atomic` függvényt a `defineAttachments`-nek:

```ts
const attachments = defineAttachments({
  user:   defineAttachments.entity({ avatar: { code: 'AV', middlewares: [count(1)] } }),
  course: defineAttachments.entity({ gallery: { code: 'GA' } }),
}, {
  provider: createLocalProvider('./var/uploads'),
  atomic:   atomicUpdate,   // lásd lent
});
```

Egy függvény szolgál ki minden entitást: megkapja az entitás típusát és azonosítóját. Ha csak egy entitásnál szeretnéd az atomi módot, vagy annál más függvénnyel, add meg az `atomic`-ot az entitás opciói között:

```ts
user: defineAttachments.entity({ avatar: { code: 'AV' } }, { atomic: atomicUpdate }),
```

### Az `atomic` függvény

```ts
type AtomicFn = (
  ctx: { entityType: string; entityId: string; entity: Record<string, unknown> },
  mutate: (current: unknown) => unknown,
) => Promise<unknown>;
```

Be kell olvasnia az entitás `attachments` oszlopának aktuális értékét, meg kell hívnia vele a `mutate`-et, ki kell írnia az eredményt, és vissza kell adnia a kiírt értéket — úgy, hogy közben semmi más ne írjon abba az oszlopba. Hogy ezt hogyan biztosítod, rajtad és az adatbázisodon múlik; a két szokásos megoldás a sorzár tranzakcióban és az összehasonlítás-és-csere (compare-and-set) újrapróbálással.

- A `mutate` tiszta és szinkron függvény. Többször is meghívható (újrapróbáláskor).
- Ha a `mutate` hibát dob (a fájl nem található, a korlát betelt, a név foglalt), ne írj semmit, és engedd tovább a hibát.
- A zár vagy az újrapróbálás csak erre a rövid lépésre vonatkozik. A feltöltés és a middleware-ek ezen kívül futnak, így egy lassú feltöltés soha nem tartja fel az entitás többi változását.

> **Az oszlopot csak a csomag írja.** Atomi módban soha ne írd az `attachments` oszlopot magad, és soha ne ments vissza rá egy teljes, korábban betöltött sort (például `update({ data: { ...user } })`): ezzel felülírnád a többi kérés közben elvégzett változásait.

### Prisma: sorzár tranzakcióban

A sor csak a lista módosításának idejére zárolódik. PostgreSQL-lel és MySQL-lel működik; az `entityType` neveinek egyezniük kell a Prisma modellekkel.

```ts
import { Prisma, PrismaClient } from '@prisma/client';
import type { AtomicFn } from '@atom-forge/attachment';

const prisma = new PrismaClient();
const tables: Record<string, string> = { user: 'User', course: 'Course' };   // Prisma modell → tábla

const atomicUpdate: AtomicFn = ({ entityType, entityId }, mutate) =>
  prisma.$transaction(async (tx) => {
    const id = Number(entityId);
    const [row] = await tx.$queryRaw<{ attachments: unknown }[]>`
      SELECT attachments FROM ${Prisma.raw(`"${tables[entityType]}"`)} WHERE id = ${id} FOR UPDATE`;
    const next = mutate(row.attachments);
    await (tx as any)[entityType].update({ where: { id }, data: { attachments: next } });
    return next;
  });
```

MySQL-nél a tábla nevét idézőjel helyett backtickkel kell idézni.

### Prisma: összehasonlítás és csere

Nyers SQL nélkül: az írás csak akkor sikerül, ha az oszlopban még a beolvasott érték van; különben újra beolvas és újrapróbálja. Minden írás a teljes JSON értéket hasonlítja össze, ezért hosszú listáknál drágább. Ellenőrizd, hogy a Prisma verziód támogatja-e a JSON szűrőket az adatbázisodnál.

```ts
const atomicUpdate: AtomicFn = async ({ entityType, entityId }, mutate) => {
  const model = (prisma as any)[entityType];
  const id = Number(entityId);
  for (;;) {
    const row  = await model.findUniqueOrThrow({ where: { id }, select: { attachments: true } });
    const next = mutate(row.attachments);
    const { count } = await model.updateMany({
      where: { id, attachments: { equals: row.attachments ?? Prisma.DbNull } },
      data:  { attachments: next },
    });
    if (count) return next;
  }
};
```

## Mi változik a kódodban

A műveletek maguk mentenek, így az alapmód mentés-és-visszaállítás lépése eltűnik:

```ts
// alapmód
const { attachment, rollback } = await h.avatar.add(file, {});
try {
  await prisma.user.update({ where: { id }, data: { attachments: user.attachments as object } });
} catch (err) {
  await rollback();
  throw err;
}

// atomi mód
const attachment = await h.avatar.add(file, {});
```

| Művelet | Alapmód | Atomi mód |
|---|---|---|
| `add`, `replace` | `{ attachment, rollback }`, te mented | `AttachmentData`, elmentve |
| `updateMeta` | szinkron, te mented | `Promise<AttachmentData>`, elmentve |
| `reorder` | szinkron, te mented | `Promise<void>`, elmentve |
| `rename`, `delete` | te mented | elmentve |
| `list`, `get` | változatlan | változatlan |
| `purge` | te mented | te mented (az entitás törlése után fut) |

A visszatérési típusok követik az opciót: a TypeScript tudja, melyik módban van egy entitás. Minden változás után az `entity.attachments` a mentett értéket tartalmazza, így az olvasáshoz nem kell plusz lekérdezés.

## Hogyan működik

Minden művelet először elvégzi a lassú tárolóműveletet, utána egyetlen rövid atomi lépésben módosítja a listát. Az ütközéseket maga a tároló akadályozza meg: új fájl csak ott jön létre, ahol még nincs semmi, és egy fájlt csak akkor ír felül, ha a beolvasása óta nem változott.

| Művelet | Sorrend |
|---|---|
| `add` | a fájl létrehozása szabad néven → atomi: korlátok ellenőrzése, bejegyzés hozzáadása |
| `replace` | felülírás csak akkor, ha a beolvasás óta nem változott → atomi: a bejegyzés frissítése; ha közben törölték → az új fájl törlése, hiba |
| `rename` | másolás az új névre (csak ha szabad) → atomi: a bejegyzés átnevezése → a régi fájl törlése |
| `delete` | atomi: a bejegyzés kivétele → a fájl törlése |
| `updateMeta`, `reorder` | csak atomi lépés, a friss listán |

Egy kategória első feltöltésekor egy rövid atomi lépés hozza létre a csoportot, így az egyidejű első feltöltések egyetlen csoportba kerülnek.

### Korlátok

A többi fájltól függő korlátok — `count()` és `sumSize()` — kétszer futnak: egyszer a feltöltés előtt, a kérés által betöltött listán, és még egyszer az atomi lépésben, a friss listán. Így az egyidejű feltöltések sem léphetik túl őket. Az ilyen korlátot tartalmazó egyedi middleware-nek ugyanezt a `check` részt kell biztosítania (lásd [Upload Middleware](middleware.md)).

### Árva fájlok

A tároló és az adatbázis két külön rendszer, ezért ha a két lépés között összeomlik a folyamat, maradhat egy fájl, amely nincs a listában. Az ilyen árva fájl soha nem látszik a felhasználóknak, és nem foglal le véglegesen egy nevet: egy kategóriában minden feltöltés, csere, átnevezés vagy törlés után a csomag kilistázza a csoport mappáját, és törli azokat a fájlokat, amelyek nincsenek a listában és régebbiek az `orphanAge`-nél (alapértelmezés: egy nap). A korhatár a még folyamatban lévő feltöltéseket védi, ezért tartsd jóval a leghosszabb feltöltésed fölött. A `purge()` a csoportmappákban mindent töröl, az árva fájlokat is.

| Helyzet | Eredmény |
|---|---|
| A feltöltés sikertelen | nincs bejegyzés; a fájl törlődik |
| A feltöltés elutasítva (korlát, ütközés) | nincs bejegyzés; a fájl törlődik |
| A folyamat a feltöltés után, a mentés előtt összeomlik | egy árva fájl, amelyet a kategória egy későbbi feltöltése, cseréje, átnevezése vagy törlése eltávolít |
| Az adatbázis az írás után hibázik | a fájl megmarad, a bejegyzés már el lehet mentve; a takarítás csak akkor törli a fájlt, ha tényleg nincs a listában |

## Tárolási követelmények

Az atomi módhoz öt további provider-metódus kell; a lokális és az S3 provider tartalmazza őket, és a `defineAttachments` induláskor hibát dob, ha egy providerből valamelyik hiányzik.

| Metódus | Cél | Lokális | S3 |
|---|---|---|---|
| `create(path, file)` | mentés csak akkor, ha ott még nincs semmi | ideiglenes fájl + `link()` | `PutObject` `If-None-Match: *`-gal |
| `copy(from, to)` | másolás csak akkor, ha a cél szabad | `copyFile` `COPYFILE_EXCL`-lel | `CopyObject` `If-None-Match: *`-gal |
| `list(folder)` | egy csoportmappa fájljai a korukkal | `readdir` + `stat` | `ListObjectsV2` |
| `etag(path)` | az aktuális tartalom azonosítója | inode, mtime és méret | `ETag` |
| `replaceIf(path, file, etag)` | felülírás csak akkor, ha az azonosító még egyezik | ideiglenes fájl + `rename()` | `PutObject` `If-Match`-csel |

S3-nál a hitelesítési adatoknak az olvasás, írás és törlés mellett `s3:ListBucket` jogosultság is kell. Az S3-kompatibilis szolgáltatásoknak támogatniuk kell a feltételes írást (`If-None-Match`, `If-Match`); az atomi mód bekapcsolása előtt ellenőrizd a sajátodat.

## Ismert korlátok

- **Több gép között megosztott lokális tároló** (például NFS-en): a „felülírás csak akkor, ha nem változott” ellenőrzés és a felülírás két lépés. Egy folyamaton belül pontos; különböző gépeken futó folyamatok között mikroszekundumos ablak marad.
- **Összeomlás `replace` közben**, a fájl felülírása és a lista mentése között: a fájlban már az új tartalom van, a lista viszont még a régi méretet és metaadatot mutatja, a fájl következő változásáig. A régi tartalom nem állítható vissza, mert a fájl neve nem változik.
- **Soha többé nem módosított entitások árva fájljai** az entitás purge-öléséig megmaradnak.
- Az az egyedi middleware, amelynek korlátja a többi fájltól függ, de nincs `check` része, csak a kérés által betöltött listát látja.
