# Vercel Deployment

## Required Environment Variables

Set these in Vercel Project Settings > Environment Variables.

```text
DATABASE_URL=your_neon_connection_string
KSAIN_LOGIN_KEY=cae214-7e0e84-5c6a4a-4e695b-c39082
ADMIN_USERNAME=safadmin
ADMIN_PASSWORD=admin12345
BLOB_READ_WRITE_TOKEN=your_vercel_blob_read_write_token
```

`BLOB_READ_WRITE_TOKEN` is required for production image uploads on Vercel.
Without it, local development stores uploaded files under `public/uploads`.

## Vercel Settings

```text
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

The API is served by `api/index.cjs`, which reuses the Express app in `server/index.cjs`.

## Local Development

Create `.env.local` from `.env.example`, then run:

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5180
```

## Admin Account

```text
ID: safadmin
PW: admin12345
```
