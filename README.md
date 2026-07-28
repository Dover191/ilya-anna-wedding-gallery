# Ilya & Anna Wedding Gallery

Mobile-first wedding gallery for guests. People open the site from a QR code, upload photos/videos, browse the shared gallery, open media in a full-screen viewer, and download files.

## Local Setup

```bash
npm install
npm run dev
```

Create `.env.local` from `.env.example` when testing real S3 uploads.

## Timeweb Environment Variables

```text
S3_ENDPOINT=https://s3.twcstorage.ru
S3_REGION=ru-1
S3_BUCKET=ilya-anna-wedding
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_PREFIX=guest-media/2026-09-06
S3_PUBLIC_BASE_URL=https://s3.twcstorage.ru/ilya-anna-wedding
MAX_UPLOAD_MB=300
```

Do not put `S3_SECRET_KEY` into browser code or a public repository.

## Bucket CORS

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "POST", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

After connecting a real domain, replace `*` in `AllowedOrigins` with that domain.
