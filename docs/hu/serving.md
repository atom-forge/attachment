# Fájlkiszolgálás

A `createFileServer` és `createImageServer` ugyanazt az interfészt adja vissza:

```ts
(pathname: string) => Promise<Response | null>
```

A `Response` a [Web Standard API](https://developer.mozilla.org/en-US/docs/Web/API/Response) — natívan elérhető Node 20+, Bun, Deno és edge runtime környezetekben. `null` azt jelenti, hogy a kérés nem illeszkedik a konfigurált prefixre — add át a frameworknek.

## URL sémák

```
Nyers fájl: GET /{servePrefix}/{groupId}-{version}/{filename}
Thumbnail:  GET /{thumbPrefix}/{groupId}-{version}/{mode-szegmens}/{filename}.webp
```

Alapértelmezett prefixek: `/file` és `/img`.

---

## Framework integrációk

### SvelteKit

```ts
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { createFileServer, createImageServer } from '@atom-forge/attachment';

const fileServer  = createFileServer({ provider, servePrefix: '/file' });
const imageServer = createImageServer({ variants, sourceProvider, thumbProvider, focusSecret });

export const handle: Handle = async ({ event, resolve }) =>
  (await fileServer(event.url.pathname))
  ?? (await imageServer(event.url.pathname))
  ?? resolve(event);
```

### Hono

```ts
import { Hono } from 'hono';

const app = new Hono();

app.use('/file/*', async (c, next) =>
  (await fileServer(new URL(c.req.url).pathname)) ?? next()
);
app.use('/img/*', async (c, next) =>
  (await imageServer(new URL(c.req.url).pathname)) ?? next()
);
```

### Express

Az Express nem támogatja natívan a Web `Response`-t — kis adapter szükséges:

```ts
import express from 'express';

async function sendWebResponse(response: Response, res: express.Response) {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

app.use('/file', async (req, res, next) => {
  const r = await fileServer(req.path);
  if (!r) return next();
  await sendWebResponse(r, res);
});
```

> Az Express `app.use('/file', ...)`-ként mountolva csak az útvonalat (prefix nélkül) adja át.

### Next.js (App Router)

**A opció — `middleware.ts`:**

```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  return (await fileServer(pathname)) ?? (await imageServer(pathname)) ?? NextResponse.next();
}

export const config = { matcher: ['/file/:path*', '/img/:path*'] };
```

**B opció — route handlerek** (`app/file/[...slug]/route.ts`):

```ts
export async function GET(request: Request) {
  const pathname = new URL(request.url).pathname;
  return (await fileServer(pathname)) ?? new Response('Not found', { status: 404 });
}
```

### Nuxt 3 / Nitro

```ts
// server/middleware/attachments.ts
export default defineEventHandler(async (event) => {
  const r = (await fileServer(event.path)) ?? (await imageServer(event.path));
  if (!r) return;

  setResponseStatus(event, r.status);
  for (const [key, value] of r.headers) setResponseHeader(event, key, value);
  return send(event, Buffer.from(await r.arrayBuffer()));
  // Vagy: return sendWebResponse(event, r)  — Nitro 2.6+
});
```

---

## Proxy konfiguráció

A szerviz elé állított reverse proxy közvetlenül kiszolgálhatja a nyers fájlokat és a cachelt thumbnail-eket — az alkalmazás szerver csak a thumbnail cache miss kéréseket kapja meg.

### Útvonal levezetés

**`/file` → lokális fájlrendszer:**
```
/file/abc123-3/photo.jpg
      └──────┘  groupId = abc123, shard = ab (első 2 karakter)
→ /var/uploads/ab/abc123/photo.jpg
```

**`/file` → S3/MinIO** (shard elhagyva — object storage-nak nincs szüksége directory shardingra):
```
/file/abc123-3/photo.jpg  →  abc123/photo.jpg
```

**`/img` → lapos cache kulcs:**
```
/img/abc123-3/e.400x400/photo.jpg.webp
→  abc123-3.e.400x400.photo.jpg.webp   (perjelek → pontok)
```

---

### Lokális provider — `/file`

#### Nginx
```nginx
location ~ "^/file/(?<shard>[a-z0-9]{2})(?<gidrest>[a-z0-9]*)-[a-z0-9]+/(?<filename>.+)$" {
    alias /var/uploads/$shard/$shard$gidrest/$filename;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

#### Apache
```apache
AliasMatch "^/file/([a-z0-9]{2})([a-z0-9]*)-[a-z0-9]+/(.+)$" "/var/uploads/$1/$1$2/$3"
<Directory "/var/uploads">
    Options -Indexes
    Require all granted
    Header always set Cache-Control "public, max-age=31536000, immutable"
</Directory>
```

#### Caddy
```caddyfile
@rawfile path_regexp rawfile "^/file/([a-z0-9]{2})([a-z0-9]*)-[a-z0-9]+/(.+)$"
handle @rawfile {
    root * /var/uploads
    rewrite * /{http.regexp.rawfile.1}/{http.regexp.rawfile.1}{http.regexp.rawfile.2}/{http.regexp.rawfile.3}
    file_server
    header Cache-Control "public, max-age=31536000, immutable"
}
```

---

### Lokális provider — `/img`

Cache miss esetén az app szerver generálja a thumbnail-t, lemezre írja, majd visszaadja.

#### Nginx
```nginx
location ~ "^/img/([^/]+)/([^/]+)/(.+)$" {
    root /var/thumb;
    try_files /$1.$2.$3 @generate;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
location @generate {
    proxy_pass http://localhost:3000;
}
```

#### Apache
```apache
RewriteEngine On
RewriteRule "^/img/([^/]+)/([^/]+)/(.+)$" - [E=FLATKEY:$1.$2.$3,C]
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
    path_regexp thumb "^/img/([^/]+)/([^/]+)/(.+)$"
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

### S3 / MinIO — `/file`

#### Nginx
```nginx
# AWS S3
location ~ "^/file/([a-z0-9]+)-[a-z0-9]+/(.+)$" {
    rewrite "^/file/([a-z0-9]+)-[a-z0-9]+/(.+)$" /$1/$2 break;
    proxy_pass https://my-bucket.s3.eu-central-1.amazonaws.com;
    proxy_ssl_server_name on;
    proxy_set_header Host my-bucket.s3.eu-central-1.amazonaws.com;
}

# MinIO
location ~ "^/file/([a-z0-9]+)-[a-z0-9]+/(.+)$" {
    rewrite "^/file/([a-z0-9]+)-[a-z0-9]+/(.+)$" /my-bucket/$1/$2 break;
    proxy_pass http://minio:9000;
}
```

#### Apache
```apache
RewriteEngine On
# AWS S3
RewriteRule "^/file/([a-z0-9]+)-[a-z0-9]+/(.+)$" \
    "https://my-bucket.s3.eu-central-1.amazonaws.com/$1/$2" [P,L]
# MinIO
RewriteRule "^/file/([a-z0-9]+)-[a-z0-9]+/(.+)$" \
    "http://minio:9000/my-bucket/$1/$2" [P,L]
```

#### Caddy
```caddyfile
@rawfile path_regexp rawfile "^/file/([a-z0-9]+)-[a-z0-9]+/(.+)$"
handle @rawfile {
    rewrite * /{http.regexp.rawfile.1}/{http.regexp.rawfile.2}
    reverse_proxy https://my-bucket.s3.eu-central-1.amazonaws.com {
        header_up Host my-bucket.s3.eu-central-1.amazonaws.com
    }
}
```

---

### S3 / MinIO — `/img`

#### Nginx
```nginx
location ~ "^/img/([^/]+)/([^/]+)/(.+)$" {
    rewrite "^/img/([^/]+)/([^/]+)/(.+)$" /my-thumbs/$1.$2.$3 break;
    proxy_pass http://minio:9000;
    proxy_intercept_errors on;
    error_page 404 = @generate;
}
location @generate {
    proxy_pass http://localhost:3000$request_uri;
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
@thumb path_regexp thumb "^/img/([^/]+)/([^/]+)/(.+)$"
route @thumb {
    rewrite * /my-thumbs/{http.regexp.thumb.1}.{http.regexp.thumb.2}.{http.regexp.thumb.3}
    reverse_proxy http://minio:9000 {
        @miss status 404
        handle_response @miss {
            rewrite * {http.request.orig_uri.path}
            reverse_proxy http://localhost:3000
        }
    }
}
```

---

## Thumbnail cache takarítás

Ha egy fájlt felülírnak, a verziója változik és a régi thumbnail-ek árváksá válnak.

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

| Változó        | Alapértelmezett | Leírás                                             |
|----------------|-----------------|----------------------------------------------------|
| `UPLOAD_DIR`   | `./var/uploads` | Feltöltött fájlok gyökérkönyvtára                  |
| `SERVE_PREFIX` | `/file`         | URL prefix a nyers fájlok kiszolgálásához          |
| `THUMB_DIR`    | `./var/thumb`   | Lapos cache könyvtár a generált thumbnail-eknek    |
| `THUMB_PREFIX` | `/img`          | URL prefix a thumbnail kiszolgáláshoz              |
| `FOCUS_SECRET` | *(kötelező)*    | HMAC titok a kézi fókusz hash validálásához        |
