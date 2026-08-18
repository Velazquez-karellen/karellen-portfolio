# Kare Platform backend

Backend-first foundation for Kare Studio and Karellen's public portfolio. The root intentionally redirects to `/api/health`; visual pages will be rebuilt after the data and publishing workflows are complete.

## Architecture

- Cloudflare Worker API
- D1 (SQLite) for content, locales, translations, projects, settings, jobs, and audit history
- R2 for original image files
- Cloudflare Images binding for validation, dimensions, and responsive variants
- OpenAI Responses API for private, server-side automatic translation
- Drizzle migrations in `drizzle/`

There is one administrator. Public visitors have read-only access and no accounts, comments, or public write endpoints.

## Local setup

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run db:local:apply
npm run dev
```

Create an ignored `.env.local` file:

```dotenv
ADMIN_EMAIL=your-email@example.com
OPENAI_API_KEY=your-private-key
OPENAI_TRANSLATION_MODEL=gpt-4o-mini
```

Never commit `.env.local` or expose the OpenAI key to browser code. The model only runs inside the Worker; translated text is stored in D1 and served like normal content.

## API

Public read endpoints:

- `GET /api/health`
- `GET /api/locales`
- `GET /api/content?locale=es&type=photo-note&page=1&limit=20`
- `GET /api/projects?locale=es`
- `GET /api/technologies`
- `GET /api/settings` (only keys beginning with `public.`)
- `GET /media/{storage-key}?width=1200&format=webp`

Private endpoints require the authenticated email header and, outside localhost, an exact match with `ADMIN_EMAIL`:

- `POST|PUT|DELETE /api/locales`
- `GET /api/content?studio=1`, `POST|PUT|DELETE /api/content`
- `POST /api/translations`, `GET /api/translations?contentId=...`
- `POST /api/uploads`, `GET|PUT|DELETE /api/assets`
- `GET /api/projects?studio=1`, `PUT /api/projects`
- `POST|PUT|DELETE /api/technologies`
- `GET /api/settings?studio=1`, `PUT|DELETE /api/settings`
- `GET /api/audit`

`POST` and `PUT /api/content` automatically translate the original into enabled locales whose `autoTranslate` flag is active. Human-reviewed translations are preserved and never overwritten automatically.

## Verification

```bash
npm run lint
npm test
```

## Rights

No license has been granted. All rights are reserved by the repository owner.
