This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3002](http://localhost:3002) with your browser to see the result.

> The dev server runs on **3002** (set via `next dev -p 3002` in `package.json`).
> Port 3000 is used by another local service and 3001 by the production portal.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Responsive design

The portal is **mobile-first responsive** — the same routes and components adapt
by breakpoint, with no separate mobile codebase. Tailwind's `md` (768px) is the
divide: base styles target phones, `md:` and up target desktop.

What changes below 768px:

- **Section switch** (`components/corpus/SectionSwitch.tsx`) — full-width
  segmented control with stacked label + caption; inline pills on desktop.
- **Landing grids** (`/notebooklm`, `/library`) — single column with `px-5`
  edge padding (`px-5 sm:px-8 lg:px-14`).
- **Tag strip** (My Research) — horizontal-scroll on mobile, wraps on desktop.
- **Safe areas** — the root layout exports `viewport.viewportFit = "cover"` so
  `env(safe-area-inset-*)` resolves on notched phones.

Mobile-only utilities (e.g. `no-scrollbar`) live at the bottom of
`src/app/globals.css`. The same responsive treatment is mirrored in the
view-only `portal/public/` app. Detail pages (`/notebooklm/[id]`,
`/library/[id]`) still use the desktop split-pane layout on mobile — a tabbed
mobile layout for those is planned but not yet implemented.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
