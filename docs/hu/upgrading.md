# Frissítés

Ez a fejezet verzióról verzióra, a legújabbal kezdve sorolja fel azokat a változásokat, amelyek frissítéskor teendővel járnak. Minden változásnál leírja, mi lett más, és mit kell tenned. A teendő nélküli változások csak a changelogban szerepelnek.

## 0.3.3 → 0.4.0

A 0.4.0 nem visszafelé kompatibilis kiadás. Megváltoznak a kategóriadefiníciók, a group id-k, az URL-ek és a szerveropciók, a 0.3.x által tárolt attachment adatokat pedig a 0.4.0 nem tudja olvasni.

> **Meglévő adatok:** Migráció nincs. Olyan projektet, amelyben már vannak csatolt fájlok, csak akkor frissíts, ha újra fel tudod tölteni őket, vagy magad mozgatod át a fájlokat és írod át a JSON-t (lásd: [A group id tartalmazza a kategóriakódot és a tulajdonost](#a-group-id-tartalmazza-a-kategóriakódot-és-a-tulajdonost)).

### A kategóriák kóddal rendelkező objektumok

A kategória eddig egy middleware tömb volt. Mostantól objektum, kötelező, kétkarakteres `code`-dal (`[A-Z0-9]`), amely egy `defineAttachments` hívás összes kategóriája között egyedi. A `defineAttachments` indításkor hibát dob tömb formájú kategória, hiányzó vagy hibás kód, illetve duplikált kód esetén.

```ts
// 0.3.x
avatar: [count(1), mime('image/*'), toWebP(80)],

// 0.4.0
avatar: { code: 'AV', middlewares: [count(1), mime('image/*'), toWebP(80)] },
```

**Teendő:** alakíts át minden kategóriát `{ code, middlewares }` formára, és válassz mindegyiknek egyedi kódot. Olyan kódokat válassz, amelyeket megtartasz: a kód része minden group id-nak, URL-nek és proxyszabálynak.

### A group id tartalmazza a kategóriakódot és a tulajdonost

A group id eddig egy véletlen base36 string volt (`k3x9q`). Mostantól `{random}-{CODE}-{entityId36}`, például `k3x9q-AV-39x9` (152829 base36-ban), és egyben a tárolási mappa is.

| | 0.3.x | 0.4.0 |
|---|---|---|
| Group id | `k3x9q` | `k3x9q-AV-39x9` |
| Fájl URL | `/file/k3x9q-3/photo.jpg` | `/file/k3x9q-AV-39x9-3r2jo3l/photo.jpg` |
| Helyi útvonal | `k3/k3x9q/photo.jpg` | `k3/k3x9q-AV-39x9/photo.jpg` |
| S3 kulcs | `files/k3x9q/photo.jpg` | `files/k3x9q-AV-39x9/photo.jpg` |

A tárolt 0.3.x adatok nem támogatottak: régi tárolón az `add` és a `replace` `AttachmentValidationError`-t dob (`stored group id "…" does not belong to …`), a szerverek pedig `404`-et adnak a régi URL-ekre.

**Teendő:** indulj üres attachment adatokkal, vagy migráld őket magad: minden kategória-tárolóhoz állítsd elő az új group id-t, mozgasd a fájlokat az új mappába, és írd az új id-t az `attachments.{category}.i` mezőbe.

### A csatoláshoz numerikus vagy UUID id-jú, mentett entitás kell

Az entitás id-ja része a group id-nak, ezért léteznie kell az első fájl hozzáadásakor, és illeszkednie kell az entitás `idType`-jához: `'int'` (alapértelmezett) vagy `'uuid'`. Más id-k, például slugok vagy alfanumerikus kódok, nem támogatottak. Mentetlen entitáshoz való hozzáadáskor hibát dob: `Entity id "undefined" is not a non-negative integer. Attachments need a saved entity with an id of type "int".`

**Teendő:** fájlok hozzáadása előtt mentsd az entitást. UUID kulcsú entitásokon állítsd be az `idType: 'uuid'` opciót. Ha az `idField` nem numerikus mezőre mutatott, állítsd a numerikus vagy UUID elsődleges kulcsra.

### A `nextGroupId` csak a véletlen részt adja vissza

Az egyedi `nextGroupId` eddig a teljes group id-t állította elő. Mostantól csak a véletlen részt, amelynek kisbetűs base36-nak (`[a-z0-9]+`) kell lennie; a kódot és az entitás id-t a könyvtár fűzi hozzá. Minden más esetben hibát dob.

**Teendő:** kisbetűs base36 stringet adj vissza, vagy távolítsd el az opciót, és használd az alapértelmezettet.

### A `createFileServer` az attachment definíciókat kapja meg

A `createFileServer` eddig egy driverrel olvasta a fájlokat az `uploadDir`-ből. Mostantól a `defineAttachments` eredményét kapja meg, az URL-ben lévő kód alapján megkeresi a kategóriát, és annak a provideréből streamel. Az `uploadDir`, `provider` és `driver` opciók, valamint az `autoDriver`, `bunDriver` és `nodeDriver` exportok megszűntek.

```ts
// 0.3.x
const fileServer = createFileServer({ uploadDir: './var/uploads', driver: autoDriver });

// 0.4.0
const fileServer = createFileServer({ attachments });
```

**Teendő:** add át az `attachments`-t (és a `servePrefix`-et, ha megváltoztattad), és töröld a driver importokat.

### A `createImageServer` az attachment definíciókat kapja meg

A `sourceProvider` opció megszűnt: az eredeti képeket az egyes kategóriák providere olvassa. Az `attachments` kötelező.

```ts
// 0.3.x
createImageServer({ variants, sourceProvider, thumbProvider, focusSecret });

// 0.4.0
createImageServer({ attachments, variants, thumbProvider, focusSecret });
```

Az image server szigorúbb is lett. A mode szegmensnek pontosan `{e|a|c|b}.{w}x{h}` vagy `{focus}.{w}x{h}.{hash}` formájúnak kell lennie, a verziónak pedig `[a-z0-9]+`-nak; minden más `404`. A törölt eredetik thumbnailjeit már nem szolgálja ki.

**Teendő:** cseréld a `sourceProvider`-t `attachments`-re. Thumbnail URL-eket csak a kliens segédfüggvényekkel (`makeAttachmentHandler`, `buildVariantUrl`, `buildImageUrl`) építs, ne kézzel.

### Reverse proxy szabályok

A 0.3.x proxymintái (`^/file/([a-z0-9]+)-[a-z0-9]+/…`) nem illeszkednek az új URL-ekre, így a frissítés után minden kérés az alkalmazáshoz kerül. Ez továbbra is működik, de a proxy már nem szolgálja ki közvetlenül a fájlokat. Hogy a proxy mely fájlokat szolgálhatja ki, azt mostantól kategóriakódonként kell eldönteni.

**Teendő:** írd át a proxyszabályokat a publikus kódok engedélylistájával, például `-(?:AV|GA|CV)-`, és minden mást küldj az alkalmazásnak. A listát a `publicCodes(attachments)` segítségével építsd fel. Soha ne vegyél fel olyan kódot, amelynek a kategóriáján van `authorize`. Lásd: [Fájlkiszolgálás](serving.md) és [Hozzáférés-szabályozás](access-control.md).

### Az elemverziók már nem egyszerű számlálók

A verzió eddig a base36 számláló volt (`3`). Mostantól a számláló és utána hat véletlen base36 karakter (`3r2jo3l`), így egy jövőbeli verzió nem található ki és nem cache-elhető előre.

**Teendő:** semmi, hacsak a kódod nem elemzi vagy hasonlítja össze a verziókat. Kezeld a verziót átlátszatlan stringként.

### Fájlnevek: URL-kódolás és az alapértelmezett sanitizer

A fájlnevek a generált URL-ekben percent-kódoltak, a szerverek pedig dekódolják őket. Az alapértelmezett sanitizer mostantól külön tisztítja a fájlnév törzsét és a kiterjesztést, és soha nem ad vissza üres nevet: a `фото.jpg`-ből `file.jpg` lesz (eddig `jpg`), a `.htaccess`-ből `file.htaccess` (eddig `htaccess`), az `a.-b.jpg`-ből `a.b.jpg`. A sanitizer eredményének mindig egyetlen biztonságos útvonalszegmensnek kell lennie (nincs benne `/`, `\`, `.`, `..` vagy vezérlőkarakter), `sanitize: false` vagy egyedi sanitizer esetén is; különben az `add` és a `rename` `AttachmentValidationError`-t dob (`Invalid filename "…"`).

**Teendő:** a könyvtár által visszaadott `url`-t használd, ne fájlnevekből építs URL-t. Ha `sanitize: false`-t vagy saját sanitizert használsz, gondoskodj róla, hogy soha ne állítson elő útvonal-elválasztót vagy pont szegmenst.

### A `reorder()` minden fájlt megkövetel

A `reorder(filenames)` eddig csak a kapott neveket tartotta meg, és engedte a duplikátumokat, így csendben fájlok vesztek el. Mostantól `AttachmentValidationError`-t dob, hacsak nem kapja meg az összes jelenlegi fájlnevet pontosan egyszer.

**Teendő:** mindig a teljes listát add át, pl. a `list().map((a) => a.filename)` átrendezett eredményét.

### A `replace()` megtartja a kiterjesztést, a rollbackje pedig visszaállítja az eredetit

A `replace()` a meglévő fájlnévre ír, ezért a feldolgozott fájlnak meg kell tartania annak kiterjesztését. Mostantól hibát dob, ha ez nem teljesül, például ha a `toWebP()` `.webp`-vé alakítja a feltöltést az `a.jpg` cseréjekor (eddig a WebP bájtok `a.jpg` néven tárolódtak). A `rollback()` mostantól visszateszi az eredeti fájlt; eddig azt a fájlt törölte, amelyre az adatbázis még hivatkozott. A `replace()` a visszatéréséig a memóriában tartja az eredeti bájtokat.

**Teendő:** egy fájl típusának megváltoztatásához `delete()`-tel töröld, és `add()`-dal add hozzá az újat. Ha megkerülted a régi rollbacket (például sikertelen mentés utáni újrafeltöltéssel), távolítsd el ezt a kerülőutat.

### A `purge()` best effort módon működik

A `purge()` eddig megállt az első fájlnál, amelyet nem tudott törölni. Mostantól minden fájlt megpróbál törölni, a nem törölhető fájlok tárolóit megtartja az `entity.attachments`-ben, és egy `errors` tömbbel rendelkező `Error`-t dob. Siker esetén továbbra is kiüríti az attachmenteket, és `attachment:purge` eseményt küld.

**Teendő:** a `purge()` után akkor is mentsd az `entity.attachments`-t, ha hibát dobott, hogy a még meglévő fájlok listázva maradjanak.

### A `delete()` akkor is sikeres, ha a fájl már hiányzik

A `delete()` eddig hibát dobott, ha a fizikai fájl már nem volt meg (lokális provider). Mostantól ilyenkor is eltávolítja a rekordot.

**Teendő:** távolítsd el azt a hibakezelést, amely erre a kivételre épített.

### Az `imgstat()` és a `getMp3Duration()` új meta objektumot ad vissza

Mindkét middleware eddig a kapott `meta` objektumba írt. Mostantól új objektumot adnak vissza, a tiédet érintetlenül hagyják. Az `imgstat()` EXIF forgatású fotóknál a megjelenített szélességet és magasságot tárolja, a `toWebP()` pedig mostantól alkalmazza a forgatást, és megtartja az animációkat.

**Teendő:** a metaadatokat a visszaadott attachmentből (`attachment.meta`) olvasd, ne az átadott objektumból. Az egyedi middleware-ek is új `meta`-t adjanak vissza.

### Hozzáférés-szabályozás és biztonsági fejlécek

Egy kategória megadhat `authorize`-t; ekkor a fájljai és thumbnailjei minden kérésnél ellenőrzésre kerülnek, és `Cache-Control: private, no-store` fejléccel mennek ki. Minden kiszolgált fájl `X-Content-Type-Options: nosniff` fejlécet kap, a HTML, XHTML, SVG, XML és JavaScript fájlokat pedig a szerver letöltésre kényszeríti (`Content-Disposition: attachment` és sandboxoló CSP), ahelyett hogy inline megjelenítené.

**Teendő:** ha az alkalmazásod a feltöltött HTML vagy SVG fájlokat közvetlenül a `/file` URL-ekről jelenítette meg, az SVG-ket `<img>`-vel ágyazd be (ez továbbra is működik), vagy szolgáld ki az ilyen fájlokat más módon. Ugyanezeket a fejléceket add hozzá azokhoz a proxy location-ökhöz, amelyek közvetlenül szolgálnak ki fájlokat (lásd: [Fájlkiszolgálás](serving.md)).

### Az S3 `exists()` jelzi a hibákat

Az `exists()` eddig minden hibára `false`-t adott, így a hitelesítési vagy hálózati problémák hiányzó fájlnak tűntek. Mostantól csak „not found” esetén ad `false`-t, minden mást továbbdob.

**Teendő:** adj `s3:ListBucket` jogot az S3 hitelesítő adatoknak a bucketre. Enélkül az S3 hiányzó kulcsokra `404` helyett `403`-at ad, ami mostantól hibaként jelenik meg.

### A peer függőségek opcionálisak, a `zod` megszűnt

A `sharp` és a `music-metadata` mostantól opcionális peer függőségek, így az npm már nem telepíti őket automatikusan. A `zod` már nem peer függőség; a csomag sosem használta.

**Teendő:** telepítsd a `sharp`-ot, ha képes middleware-t vagy az image servert használod, és a `music-metadata`-t, ha a `getMp3Duration()`-t használod. Ha a kódod használja a `zod`-ot, vedd fel a saját függőségeid közé.

### Prisma: használd az extensiont

A `createPrismaMiddleware` (a `prisma.$use`-hoz) elavult: a `$use` a Prisma 4.16-ban elavulttá vált, az újabb Prisma verziókból pedig eltávolították.

```ts
// 0.3.x
prisma.$use(createPrismaMiddleware(eventManager));

// 0.4.0
const prisma = new PrismaClient().$extends(createPrismaExtension(eventManager));
```

**Teendő:** válts a `createPrismaExtension`-re. Egyrekordos `delete` után `entity:deleted` eseményt küld; `deleteMany` esetén töltsd be a rekordokat, és magad purge-old a csatolt fájljaikat.
