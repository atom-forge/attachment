# Fájlkiszolgálás

A `createFileServer` és a `createImageServer` is egy handlert ad vissza, ugyanezzel a két metódussal:

```ts
interface Handler {
  match(request: Request): boolean;            // a handler prefixével kezdődik az útvonal?
  handle(request: Request): Promise<Response>; // kiszolgálja (a 404 / 403 / 400 válaszokat is)
}
```

Mindkettő a [Web Standard](https://developer.mozilla.org/en-US/docs/Web/API/Request) `Request` és `Response` típusokkal dolgozik, amelyek natívan elérhetők Node 20+, Bun és Deno alatt. Először a `match`-et hívd; ha `false`-t ad, add tovább a kérést a frameworknek. A handlerek a teljes `Request`-et kapják, nem csak az útvonalat, mert az `authorize`-os kategóriáknak szükségük van a fejlécekre (például a cookie-kra).

A file és az image server Node API-kat használ (`node:fs`, `node:crypto`, `sharp`), ezért Node-kompatibilis runtime-ban futtasd őket, ne edge-en.

### `createFileServer` opciók

| Opció | Alapértelmezés | Jelentés |
|---|---|---|
| `attachments` | — | Kötelező. A `defineAttachments` eredménye: az URL-ben lévő kategóriakód alapján választja ki a kategóriát, a providerét és az `authorize` hookját. |
| `servePrefix` | `'/file'` | URL prefix; egyeznie kell a `defineAttachments` és a proxy beállításával. |

Tároló-opció nincs: minden fájlt a saját kategóriájának providere streamel (a kategóriaszintű `provider`, vagy a `defineAttachments` providere).

| Kérés | Válasz |
|---|---|
| Ismeretlen kód, hibás vagy átírt group id, nem biztonságos fájlnév, hiányzó fájl | `404` |
| Az `authorize` `false`-t adott | `403` |
| `authorize` nélküli kategória | `200`, `Cache-Control: public, max-age=31536000, immutable` |
| `authorize`-os kategória, engedélyezve | `200`, `Cache-Control: private, no-store` |

### `createImageServer` opciók

| Opció | Alapértelmezés | Jelentés |
|---|---|---|
| `attachments` | — | Kötelező. A `defineAttachments` eredménye: az eredeti képet a kategória providere olvassa, és az `authorize`-os kategóriáknál lefut az `authorize`. |
| `variants` | — | A közös képvariáns-térkép (ugyanaz, amit a kliens használ). |
| `thumbProvider` | — | Ahol a generált thumbnailek cache-elődnek. |
| `thumbPrefix` | `'/img'` | A thumbnailek URL prefixe. |
| `focusSecret` | — | Titok a manuális fókuszú URL-ek hash-éhez. |
| `eventManager` | — | Opcionális. Új thumbnail generálása és cache-elése után `thumbnail:generated` eseményt kap (`{ groupId, filename, modeSeg }`). |

Az `authorize`-os kategóriák thumbnailjei is kiszolgálhatók: minden kérésnél lefut az `authorize`, a válasz pedig `Cache-Control: private, no-store`.

## URL sémák

```
Nyers fájl: GET /{servePrefix}/{groupId}-{version}/{filename}
Thumbnail:  GET /{thumbPrefix}/{groupId}-{version}/{mode-szegmens}/{filename}.webp

groupId:    {random}-{CODE}-{entityId36}
Példa:      /file/k3x9q-PD-39x9-1r2jo3l/contract.pdf
```

Alapértelmezett prefixek: `/file` és `/img`. A group id egyben a tároló mappája: a `random` kisbetűs base36 (kitalálhatatlan), a `CODE` a kategória kétkarakteres kódja, az `entityId36` a tulajdonos id-ja base36-ban (`39x9` = 152829). A verzió egy base36 számláló és véletlen karakterek. A fájlnevek az URL-ben percent-kódoltak.

> **Hozzáférés-szabályozás:** hogy egy kategória publikus vagy jogosultsághoz kötött, azt kizárólag az `authorize` hookja és a reverse proxy engedélylistája dönti el. Lásd: [Hozzáférés-szabályozás](access-control.md).

---

## Framework integrációk

Minden példa ugyanazt a kis segédfüggvényt használja, ami mindkét handlert kipróbálja:

```ts
// attachments.server.ts
import { createFileServer, createImageServer } from '@atom-forge/attachment';

export const fileServer  = createFileServer({ attachments });
export const imageServer = createImageServer({ attachments, variants, thumbProvider, focusSecret });

export async function serveAttachments(request: Request): Promise<Response | null> {
  if (fileServer.match(request))  return fileServer.handle(request);
  if (imageServer.match(request)) return imageServer.handle(request);
  return null;
}
```

### SvelteKit

```ts
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) =>
  (await serveAttachments(event.request)) ?? resolve(event);
```

### Hono

```ts
import { Hono } from 'hono';

const app = new Hono();

app.use('*', async (c, next) => (await serveAttachments(c.req.raw)) ?? next());
```

### Express

Az Express saját request- és response-objektumokat használ, ezeket egy kis adapter alakítja át:

```ts
import express from 'express';
import { Readable } from 'node:stream';

function toWebRequest(req: express.Request): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }
  return new Request(new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`), { method: req.method, headers });
}

function sendWebResponse(response: Response, res: express.Response) {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (response.body) Readable.fromWeb(response.body as any).pipe(res);
  else res.end();
}

app.use(async (req, res, next) => {
  const r = await serveAttachments(toWebRequest(req));
  if (!r) return next();
  sendWebResponse(r, res);
});
```

> A middleware-t útvonal nélkül mountold: a handlerek maguk ellenőrzik a prefixet, és a `req.originalUrl` így is a teljes URL-t tartalmazza.

### Next.js (App Router)

Route handlereket használj Node runtime-mal (`app/file/[...path]/route.ts`, és ugyanígy `app/img/[...path]/route.ts`):

```ts
export const runtime = 'nodejs';

export async function GET(request: Request) {
  return (await serveAttachments(request)) ?? new Response('Not found', { status: 404 });
}
```

### Nuxt 3 / Nitro

```ts
// server/middleware/attachments.ts
export default defineEventHandler(async (event) => {
  const r = await serveAttachments(toWebRequest(event));
  if (r) return sendWebResponse(event, r);
});
```

---

## Biztonsági fejlécek

A `createFileServer` minden fájlhoz `X-Content-Type-Options: nosniff` fejlécet küld. Azokat a típusokat, amelyeket a böngésző az oldalad originjén futtatna (HTML, XHTML, SVG, XML, JavaScript), ezen felül `Content-Disposition: attachment` és `Content-Security-Policy: default-src 'none'; sandbox` fejléccel küldi, így egy feltöltött oldal vagy SVG nem futtathat szkriptet az oldalad nevében. Ha a proxy közvetlenül szolgálja ki a fájlokat, ott is add hozzá ugyanezeket, például Nginxben:

```nginx
# http {} szinten
map $uri $attachment_disposition {
    "~*\.(html?|xhtml|svg|xml|js)$"  attachment;
    default                           "";
}
map $uri $attachment_csp {
    "~*\.(html?|xhtml|svg|xml|js)$"  "default-src 'none'; sandbox";
    default                           "";
}

# minden location-ben, ami közvetlenül szolgálja ki a /file-t
add_header X-Content-Type-Options  nosniff                  always;
add_header Content-Disposition     $attachment_disposition  always;  # üres érték = a fejléc nem megy ki
add_header Content-Security-Policy $attachment_csp          always;
```

Ahol lehet, a feltöltéseket is korlátozd `ext()`/`mime()` middleware-rel. A `mime()` a kliens által küldött típust ellenőrzi, amit a kliens meghamisíthat.

---

## Proxy konfiguráció

A szerviz elé állított reverse proxy közvetlenül kiszolgálhatja a **publikus** kategóriák nyers fájljait és cachelt thumbnail-jeit. Az alkalmazás szerver így csak a thumbnail cache miss kéréseket és az `authorize`-zal rendelkező kategóriák kéréseit kapja meg.

### Publikus kódok engedélylistája

A proxy a group id-ban lévő kategóriakód alapján dönt. Tarts fenn egy engedélylistát a publikus kategóriák (az `authorize` nélküli kategóriák) kódjaiból, csak ezeket szolgáld ki közvetlenül, minden mást a `/file/` és az `/img/` alatt küldj az alkalmazásnak. A `publicCodes(attachments)` pontosan ezeket a kódokat adja vissza, így a mintát a definícióból építheted fel:

```ts
import { publicCodes } from '@atom-forge/attachment';

console.log(publicCodes(attachments).join('|'));  // AV|GA|CV
```

Az alábbi példák az `AV|GA|CV` listát használják; ezt cseréld a sajátodra.

- **Biztonságos alapeset:** ha egy publikus kód hiányzik a listáról, az nem hiba — a fájljai egyszerűen az alkalmazáson keresztül mennek, ugyanazzal a `Cache-Control`-lal.
- **Soha ne vegyél fel olyan kódot, amelynek van `authorize` hookja.** A proxy az `authorize` hívása nélkül szolgálná ki ezeket a fájlokat. Az `authorize`-os kategóriák thumbnailjei is a `thumbProvider`-be cache-elődnek, így ez az `/img`-re is vonatkozik.
- A korábbi verziók proxyszabályai (`^/file/([a-z0-9]+)-[a-z0-9]+/`) egyáltalán nem illeszkednek a mostani URL-ekre: amíg nem frissíted őket, minden kérés az alkalmazáson megy át (biztonságos, csak lassabb).

A teljes modellt lásd: [Hozzáférés-szabályozás](access-control.md).

### Útvonal levezetés

**`/file` → lokális fájlrendszer:**
```
/file/k3x9q-AV-39x9-1r2jo3l/photo.jpg
      └─────┬─────┘ └──┬──┘
         groupId    version (az utolsó kötőjel után)
groupId = k3x9q-AV-39x9 ({random}-{CODE}-{entityId36}), shard = k3 (első 2 karakter)
→ /var/uploads/k3/k3x9q-AV-39x9/photo.jpg
```

**`/file` → S3/MinIO** (shard elhagyva — object storage-nak nincs szüksége directory shardingra):
```
/file/k3x9q-AV-39x9-1r2jo3l/photo.jpg  →  k3x9q-AV-39x9/photo.jpg
```

**`/img` → lapos cache kulcs:**
```
/img/k3x9q-AV-39x9-1r2jo3l/e.400x400/photo.jpg.webp
→  k3x9q-AV-39x9-1r2jo3l.e.400x400.photo.jpg.webp   (perjelek → pontok)
```

Az alábbi minták publikuskód-része a `-(?:AV|GA|CV)-`: a kód a random rész és a kódolt entitás id között áll.

---

### Lokális provider — `/file`

#### Nginx
```nginx
# Publikus kódok: közvetlenül
location ~ "^/file/(?<shard>[a-z0-9]{2})(?<rest>[a-z0-9]*-(?:AV|GA|CV)-[a-z0-9]+)-[a-z0-9]+/(?<filename>.+)$" {
    alias /var/uploads/$shard/$shard$rest/$filename;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
# Minden más /file/ alatt → alkalmazás
location /file/ {
    proxy_pass http://localhost:3000;
}
```

#### Apache
```apache
RewriteEngine On
# Publikus kódok: közvetlenül
RewriteRule "^/file/([a-z0-9]{2})([a-z0-9]*-(?:AV|GA|CV)-[a-z0-9]+)-[a-z0-9]+/(.+)$" "/var/uploads/$1/$1$2/$3" [L]
# Minden más /file/ alatt → alkalmazás
RewriteRule "^/file/" "http://localhost:3000%{REQUEST_URI}" [P,L]

<Directory "/var/uploads">
    Options -Indexes
    Require all granted
    Header always set Cache-Control "public, max-age=31536000, immutable"
</Directory>
```

#### Caddy
```caddyfile
@rawfile path_regexp rawfile "^/file/([a-z0-9]{2})([a-z0-9]*-(?:AV|GA|CV)-[a-z0-9]+)-[a-z0-9]+/(.+)$"
handle @rawfile {
    root * /var/uploads
    rewrite * /{http.regexp.rawfile.1}/{http.regexp.rawfile.1}{http.regexp.rawfile.2}/{http.regexp.rawfile.3}
    file_server
    header Cache-Control "public, max-age=31536000, immutable"
}
handle /file/* { reverse_proxy localhost:3000 }
```

---

### Lokális provider — `/img`

A publikus kódok cachelt thumbnailjei a lemezről mennek. Cache miss esetén és minden más kódnál a kérés az app szerverhez kerül, amely szükség esetén lefuttatja az `authorize`-t, generálja a thumbnail-t, lemezre írja, majd visszaadja.

#### Nginx
```nginx
location ~ "^/img/([a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+-[a-z0-9]+)/([^/]+)/(.+)$" {
    root /var/thumb;
    try_files /$1.$2.$3 @generate;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
location @generate {
    proxy_pass http://localhost:3000;
}
# Minden más /img/ alatt → alkalmazás
location /img/ {
    proxy_pass http://localhost:3000;
}
```

#### Apache
```apache
RewriteEngine On
RewriteRule "^/img/([a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+-[a-z0-9]+)/([^/]+)/(.+)$" - [E=FLATKEY:$1.$2.$3,C]
RewriteCond "/var/thumb/%{ENV:FLATKEY}" -f
RewriteRule "^/img/([^/]+)/([^/]+)/(.+)$" "/thumbcache/$1.$2.$3" [PT,L]
RewriteRule "^/img/" "http://localhost:3000%{REQUEST_URI}" [P,L]

Alias "/thumbcache" "/var/thumb"
<Directory "/var/thumb">
    Options -Indexes
    Require all granted
    Header always set Cache-Control "public, max-age=31536000, immutable"
</Directory>
```

#### Caddy
```caddyfile
@thumbOnDisk {
    path_regexp thumb "^/img/([a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+-[a-z0-9]+)/([^/]+)/(.+)$"
    file { root /var/thumb; try_files /{http.regexp.thumb.1}.{http.regexp.thumb.2}.{http.regexp.thumb.3} }
}
handle @thumbOnDisk {
    root * /var/thumb
    rewrite * /{http.regexp.thumb.1}.{http.regexp.thumb.2}.{http.regexp.thumb.3}
    file_server
    header Cache-Control "public, max-age=31536000, immutable"
}
handle /img/* { reverse_proxy localhost:3000 }
```

---

### S3 / MinIO — `/file` `files/` prefixszel

Az alábbi példák azt feltételezik, hogy a `defineAttachments` providere `prefix: 'files/'`
beállítást használja. Prefix nélkül hagyd el a `files/` részt a célútvonalból. A bucketből való
közvetlen kiszolgáláshoz ennek a prefixnek anonim módon olvashatónak kell lennie, ezért az
`authorize`-os kategóriáknak külön, nem publikus `provider` kell (lásd: [Hozzáférés-szabályozás](access-control.md)).

#### Nginx
```nginx
# AWS S3
location ~ "^/file/[a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+-[a-z0-9]+/" {
    rewrite "^/file/([a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+)-[a-z0-9]+/(.+)$" /files/$1/$2 break;
    proxy_pass https://my-bucket.s3.eu-central-1.amazonaws.com;
    proxy_ssl_server_name on;
    proxy_set_header Host my-bucket.s3.eu-central-1.amazonaws.com;
}

# MinIO
location ~ "^/file/[a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+-[a-z0-9]+/" {
    rewrite "^/file/([a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+)-[a-z0-9]+/(.+)$" /my-bucket/files/$1/$2 break;
    proxy_pass http://minio:9000;
}

# Minden más /file/ alatt → alkalmazás
location /file/ {
    proxy_pass http://localhost:3000;
}
```

#### Apache
```apache
RewriteEngine On
# AWS S3
RewriteRule "^/file/([a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+)-[a-z0-9]+/(.+)$" \
    "https://my-bucket.s3.eu-central-1.amazonaws.com/files/$1/$2" [P,L]
# MinIO
RewriteRule "^/file/([a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+)-[a-z0-9]+/(.+)$" \
    "http://minio:9000/my-bucket/files/$1/$2" [P,L]
# Minden más /file/ alatt → alkalmazás
RewriteRule "^/file/" "http://localhost:3000%{REQUEST_URI}" [P,L]
```

#### Caddy
```caddyfile
@rawfile path_regexp rawfile "^/file/([a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+)-[a-z0-9]+/(.+)$"
# AWS S3
handle @rawfile {
    rewrite * /files/{http.regexp.rawfile.1}/{http.regexp.rawfile.2}
    reverse_proxy https://my-bucket.s3.eu-central-1.amazonaws.com {
        header_up Host my-bucket.s3.eu-central-1.amazonaws.com
    }
}
handle /file/* { reverse_proxy localhost:3000 }
```

---

### S3 / MinIO — `/img` `images/` prefixszel

Az alábbi példa azt feltételezi, hogy a `thumbProvider` `prefix: 'images/'`
beállítást használja. Külön thumbnail bucket esetén a `my-bucket/images` helyére
a thumbnail bucket neve kerül. A thumbnail cache az `authorize`-os kategóriák
thumbnailjeit is tartalmazza, ezért ha vannak ilyenek, ne tedd egészében anonim módon olvashatóvá.

#### Nginx
```nginx
location ~ "^/img/[a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+-[a-z0-9]+/" {
    rewrite "^/img/([a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+-[a-z0-9]+)/([^/]+)/(.+)$" /my-bucket/images/$1.$2.$3 break;
    proxy_pass http://minio:9000;
    proxy_intercept_errors on;
    error_page 404 = @generate;
}
location @generate {
    proxy_pass http://localhost:3000$request_uri;
}
# Minden más /img/ alatt → alkalmazás
location /img/ {
    proxy_pass http://localhost:3000;
}
```

#### Apache

Az Apache nem támogatja tisztán az "A upstream, fallback B-re 404-nél" logikát. Irányítsd az összes thumbnail kérést az app szerveren át:

```apache
ProxyPass        "/img/" "http://localhost:3000/img/"
ProxyPassReverse "/img/" "http://localhost:3000/img/"
```

#### Caddy
```caddyfile
@thumb path_regexp thumb "^/img/([a-z0-9]+-(?:AV|GA|CV)-[a-z0-9]+-[a-z0-9]+)/([^/]+)/(.+)$"
handle @thumb {
    rewrite * /my-thumbs/{http.regexp.thumb.1}.{http.regexp.thumb.2}.{http.regexp.thumb.3}
    reverse_proxy http://minio:9000 {
        @miss status 404
        handle_response @miss {
            rewrite * {http.request.orig_uri.path}
            reverse_proxy http://localhost:3000
        }
    }
}
handle /img/* { reverse_proxy localhost:3000 }
```

---

## Thumbnail cache takarítás

Ha egy fájlt felülírnak, a verziója változik és a régi thumbnail-ek árváká válnak. Ha egy fájlt törölnek, az image server többé nem szolgálja ki a thumbnailjeit (ellenőrzi, hogy az eredeti még létezik), de az a proxy, amely közvetlenül a cache-ből szolgál ki, addig adja őket, amíg ez a takarítás el nem távolítja.

### Lokális provider

```sh
# 30 napja nem hozzáfértek thumbnail-ek törlése
find /var/thumb -type f -atime +30 -delete
```

Crontab-ba:
```cron
0 3 * * * find /var/thumb -type f -atime +30 -delete
```

### S3 / MinIO — lifecycle rule

```sh
# AWS S3
aws s3api put-bucket-lifecycle-configuration \
  --bucket my-thumbs \
  --lifecycle-configuration '{
    "Rules": [{ "ID": "expire-thumbs", "Status": "Enabled", "Filter": {}, "Expiration": { "Days": 30 } }]
  }'

# MinIO
mc ilm add --expiry-days 30 myminio/my-thumbs
```

---

## Környezeti változók

A könyvtár maga nem olvas környezeti változót. A dokumentáció példái az alábbi neveket használják; az értéküket neked kell átadnod a providereknek és a szervereknek.

| Változó        | Alapértelmezett | Leírás                                             |
|----------------|-----------------|----------------------------------------------------|
| `UPLOAD_DIR`   | `./var/uploads` | Feltöltött fájlok gyökérkönyvtára                  |
| `SERVE_PREFIX` | `/file`         | URL prefix a nyers fájlok kiszolgálásához          |
| `THUMB_DIR`    | `./var/thumb`   | Lapos cache könyvtár a generált thumbnail-eknek    |
| `THUMB_PREFIX` | `/img`          | URL prefix a thumbnail kiszolgáláshoz              |
| `FOCUS_SECRET` | *(kötelező)*    | HMAC titok a kézi fókusz hash validálásához        |
