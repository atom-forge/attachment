# Serving Files — LLM Reference

## Handler interface
```ts
(pathname: string) => Promise<Response | null>
// null = path doesn't match prefix → pass to framework
```

## URL schemas
```
/file/{groupId}-{version}/{filename}
/img/{groupId}-{version}/{modeSeg}/{filename}.webp
```

## Framework wiring
```ts
// SvelteKit hooks.server.ts
export const handle: Handle = ({ event, resolve }) =>
  fileServer(event.url.pathname) ?? imageServer(event.url.pathname) ?? resolve(event);

// Hono
app.use('/file/*', (c, next) => fileServer(new URL(c.req.url).pathname) ?? next());

// Express — needs Web Response adapter (res.status/setHeader/end)

// Next.js middleware.ts
export async function middleware(req: NextRequest) {
  return fileServer(req.nextUrl.pathname) ?? imageServer(req.nextUrl.pathname) ?? NextResponse.next();
}
export const config = { matcher: ['/file/:path*', '/img/:path*'] };

// Nuxt server/middleware/attachments.ts
export default defineEventHandler(async (event) => {
  const r = await fileServer(event.path) ?? await imageServer(event.path);
  if (!r) return;
  setResponseStatus(event, r.status);
  for (const [k, v] of r.headers) setResponseHeader(event, k, v);
  return send(event, Buffer.from(await r.arrayBuffer()));
});
```

## Proxy path derivation
```
/file/abc123-3/photo.jpg
  local  → /var/uploads/ab/abc123/photo.jpg  (shard = first 2 chars)
  S3     → abc123/photo.jpg  (no shard)

/img/abc123-3/e.400x400/photo.jpg.webp
  flat key → abc123-3.e.400x400.photo.jpg.webp
```

## Nginx snippets
```nginx
# local /file
location ~ "^/file/(?<shard>[a-z0-9]{2})(?<rest>[a-z0-9]*)-[a-z0-9]+/(?<f>.+)$" {
    alias /var/uploads/$shard/$shard$rest/$f;
    add_header Cache-Control "public, max-age=31536000, immutable";
}

# local /img — serve flat key or generate
location ~ "^/img/([^/]+)/([^/]+)/(.+)$" {
    root /var/thumb;
    try_files /$1.$2.$3 @generate;
}
location @generate { proxy_pass http://localhost:3000; }

# S3 /file
location ~ "^/file/([a-z0-9]+)-[a-z0-9]+/(.+)$" {
    rewrite ^ /$1/$2 break;
    proxy_pass https://my-bucket.s3.region.amazonaws.com;
}

# S3/MinIO /img
location ~ "^/img/([^/]+)/([^/]+)/(.+)$" {
    rewrite ^ /my-thumbs/$1.$2.$3 break;
    proxy_pass http://minio:9000;
    proxy_intercept_errors on;
    error_page 404 = @generate;
}
location @generate { proxy_pass http://localhost:3000$request_uri; }
```

## Thumbnail cleanup
```sh
# local — cron
find /var/thumb -type f -atime +30 -delete

# S3/MinIO — lifecycle rule (run once)
aws s3api put-bucket-lifecycle-configuration --bucket my-thumbs \
  --lifecycle-configuration '{"Rules":[{"ID":"expire","Status":"Enabled","Filter":{},"Expiration":{"Days":30}}]}'
mc ilm add --expiry-days 30 myminio/my-thumbs
```

## Env vars
```
UPLOAD_DIR    ./var/uploads    root for uploaded files
SERVE_PREFIX  /file            raw file URL prefix
THUMB_DIR     ./var/thumb      thumbnail cache dir
THUMB_PREFIX  /img             thumbnail URL prefix
FOCUS_SECRET  (required)       HMAC secret for manual focus hash
```