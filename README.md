# Karellen Portfolio

A personal digital space where the story behind what I’m building comes together.

This is a bilingual portfolio and living personal site focused on software engineering, robotics, leadership, NENXORAS, projects, and long-form storytelling.

## Technology

- TypeScript
- React
- Next.js / Vinext
- Cloudflare Workers
- Cloudflare D1 for structured content
- Cloudflare R2 for image uploads
- Drizzle ORM for database migrations

## Open the project in IntelliJ IDEA

1. Install Node.js 22 or newer.
2. Open the repository folder in IntelliJ IDEA.
3. Open IntelliJ's terminal.
4. Install the dependencies:

```bash
npm install
```

5. Start the local development server:

```bash
npm run dev
```

6. Open the local address shown in the terminal.

## Main folders

- `app/page.tsx` — main portfolio page and bilingual content
- `app/globals.css` — public visual system and responsive design
- `app/mi-historia/` — long-form personal story
- `app/studio/` — private visual content editor
- `db/schema.ts` — content database structure
- `drizzle/` — database migrations
- `worker/index.ts` — server endpoints, content storage, and image uploads

## Useful commands

```bash
npm run dev
npm run lint
npm run db:generate
```

## Content studio

The private `/studio` route is designed to create and update projects, posts, story chapters, travel entries, recommendations, NENXORAS updates, drafts, bilingual content, and cover images without editing the source code.

## Rights

No license has been granted. All rights are reserved by the repository owner.
