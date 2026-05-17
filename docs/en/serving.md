# Serving Files

Both `createFileServer` and `createImageServer` return the same interface:

```ts
(pathname: string) => Promise<Response | null>
```

`Response` is the [Web Standard API](https://developer.mozilla.org/en-US/docs/Web/API/Response) — available natively in Node 20+, Bun, Deno, and edge runtimes. `null` means the request does not match the configured prefix — pass it on to your framework.

## URL schemas

```
Raw file:  GET /{servePrefix}/{groupId}-{version}/{filename}
Thumbnail: GET /{thumbPrefix}/{groupId}-{version}/{mode-segment}/{filename}.webp
```

Default prefixes: `/file` and `/img`.

---

## Framework integrations

### SvelteKit

```ts
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { createFileServer } from '@atom-forge/attachment';
import { createImageServer } from '@atom-forge/attachment';

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

Express does not support Web `Response` natively — use a small adapter:

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

> Express passes only the path (without prefix) when mounted with `app.use('/file', ...)`.

### Next.js (App Router)

**Option A — `middleware.ts`:**

```ts
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  return (await fileServer(pathname)) ?? (await imageServer(pathname)) ?? NextResponse.next();
}

export const config = { matcher: ['/file/:path*', '/img/:path*'] };
```

**Option B — route handlers** (`app/file/[...slug]/route.ts`):

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
  // Or: return sendWebResponse(event, r)  — Nitro 2.6+
});
```

---

## Proxy configuration

A reverse proxy in front of the app server lets you serve raw files and cached thumbnails directly — the app server only receives thumbnail cache-miss requests.

### Path derivation

**`/file` → local filesystem:**
```
/file/abc123-3/photo.jpg
      └──────┘  groupId = abc123, shard = ab (first 2 chars)
→ /var/uploads/ab/abc123/photo.jpg
```

**`/file` → S3/MinIO** (shard stripped — object storage needs no directory sharding):
```
/file/abc123-3/photo.jpg  →  abc123/photo.jpg
```

**`/img` → flat cache key:**
```
/img/abc123-3/e.400x400/photo.jpg.webp
→  abc123-3.e.400x400.photo.jpg.webp   (slashes → dots)
```

---

### Local provider — `/file`

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

### Local provider — `/img`

Cache misses are proxied to the app server, which generates and writes the thumbnail, then returns it.

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
# AWS S3
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

Apache does not cleanly support "try upstream A, fall back to upstream B on 404". Route all thumbnail requests through the app instead:

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

## Thumbnail cache cleanup

When a file is replaced, its version changes and old thumbnails become orphaned.

### Local provider

```sh
# Delete thumbnails not accessed in 30 days
find /var/thumb -type f -atime +30 -delete
```

Add to crontab:
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

## Environment variables

| Variable       | Default         | Description                                   |
|----------------|-----------------|-----------------------------------------------|
| `UPLOAD_DIR`   | `./var/uploads` | Root directory for uploaded files             |
| `SERVE_PREFIX` | `/file`         | URL prefix for raw file serving               |
| `THUMB_DIR`    | `./var/thumb`   | Flat cache directory for generated thumbnails |
| `THUMB_PREFIX` | `/img`          | URL prefix for thumbnail serving              |
| `FOCUS_SECRET` | *(required)*    | HMAC secret for manual-focus hash validation  |
