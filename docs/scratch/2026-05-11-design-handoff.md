# Research Corpus — Design Handoff

This package ports the warm-paper / archival design from this project into your Next.js + Tailwind v4 + shadcn repo at `mikezhang09-code/research-corpus`.

Stack assumptions (verified against your `package.json`):
- Next.js 16, React 19
- Tailwind v4 (`@tailwindcss/postcss`)
- shadcn (style: `base-nova`, alias `@/components/ui`)
- Base UI, lucide-react

Your existing route shape maps 1:1 to the design:

| Route | Becomes |
|---|---|
| `src/app/notebooklm/page.tsx` | **NotebookLM** tab — corpus cards |
| `src/app/notebooklm/[id]/page.tsx` | Notebook detail — 3-pane (Sources / Chat / Studio) |
| `src/app/library/page.tsx` | **My Research** tab — folio cards (5 variants) |
| `src/app/library/[id]/page.tsx` | Folio detail — Library / Canvas (Reader · Synopsis · Marginalia) / Studio |

## Folder structure to create

```
portal/frontend/src/
├── app/
│   ├── (corpus)/                       NEW — route group for shared shell
│   │   ├── layout.tsx                  NEW — masthead + section pills
│   │   ├── notebooklm/                 MOVE existing here
│   │   └── library/                    MOVE existing here
│   ├── globals.css                     REPLACE
│   └── layout.tsx                      PATCH (font + body class)
└── components/
    └── corpus/                         NEW
        ├── CorpusCard.tsx
        ├── FolioCard.tsx
        ├── SectionSwitch.tsx
        ├── Masthead.tsx
        ├── SourceThumb.tsx
        └── Glyph.tsx
```

The route group `(corpus)` does not change URLs — `/notebooklm` and `/library` stay where they are.

---

## Step 1 — Fonts

Add to `src/app/layout.tsx`:

```tsx
import { Cormorant_Garamond, Source_Serif_4, Inter_Tight, JetBrains_Mono } from "next/font/google";

const serifDisplay = Cormorant_Garamond({
  subsets: ["latin"], weight: ["400","500","600","700"], style: ["normal","italic"],
  variable: "--font-serif-display",
});
const serif = Source_Serif_4({
  subsets: ["latin"], weight: ["400","500","600"], style: ["normal","italic"],
  variable: "--font-serif",
});
const sans = Inter_Tight({
  subsets: ["latin"], weight: ["400","500","600","700"],
  variable: "--font-sans",
});
const mono = JetBrains_Mono({
  subsets: ["latin"], weight: ["400","500","600"],
  variable: "--font-mono",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serifDisplay.variable} ${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="bg-paper text-ink font-serif antialiased">
        {children}
      </body>
    </html>
  );
}
```

---

## Step 2 — Tokens (`globals.css`)

Drop in `handoff/globals.css` as your new `src/app/globals.css`. It defines all paper/ink/accent colors, type scale, spacing, and the subtle grain texture as Tailwind v4 `@theme` tokens — so you get utilities like `bg-paper`, `text-ink-fade`, `border-rule`, `font-serif-display`, `text-terracotta`.

Token map (all available as Tailwind utilities):

| CSS var | Tailwind | Use |
|---|---|---|
| `--paper` | `bg-paper` | App background |
| `--paper-deep` | `bg-paper-deep` | Hovered surfaces |
| `--vellum` | `bg-vellum` | Cards, framed content |
| `--ink` | `text-ink` / `border-ink` | Primary text + hard rules |
| `--ink-soft` | `text-ink-soft` | Body |
| `--ink-fade` | `text-ink-fade` | Meta |
| `--ink-mute` | `text-ink-mute` | Captions |
| `--rule` | `border-rule` | Dividers |
| `--terracotta` | `text-terracotta` / `bg-terracotta` | Primary accent |
| `--sage`, `--lavender`, `--ochre` | … | Secondary accents (per-folio) |

---

## Step 3 — Shared shell

`src/app/(corpus)/layout.tsx`: see `handoff/app/(corpus)/layout.tsx`. Renders:

- Masthead bar with logo + volume number + utility pills (History / Settings / PRO / avatar)
- **Section switch** (NotebookLM | My Research) — a `<Link>`-based segmented control that highlights the active route segment
- `<main>` slot for the children pages

---

## Step 4 — Page restyle

Keep your existing data-fetching, server actions, and Supabase calls. Only the JSX changes.

### 4a. `notebooklm/page.tsx`

Replace your current notebook grid item with `<CorpusCard>`:

```tsx
import { CorpusCard } from "@/components/corpus/CorpusCard";

// inside your map:
<CorpusCard
  number={i + 1}
  domain={nb.domain ?? "Untitled"}
  title={nb.title}
  titleEn={nb.title_en}
  date={nb.updated_at}
  sources={nb.source_count}
  swatch={pickSwatch(nb)}           // see helper in CorpusCard.tsx
  glyph={pickGlyph(nb)}
  onClick={() => router.push(`/notebooklm/${nb.id}`)}
/>
```

Wrap in `<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 px-14">`.

Above the grid, add a `<SectionHead eyebrow="Section I" title="My Corpus" count={list.length} />` (component included).

### 4b. `notebooklm/[id]/page.tsx`

You already have a 3-pane split. Only **chrome** changes:
- Replace top-bar with `<DetailHeader>` (included)
- Each pane: `bg-paper border-r border-rule`, headers in `font-serif-display italic`
- Source rows: paper-card icon (28×36, beveled corner) + serif title + mono meta — see `<SourceTile>` snippet in `FolioCard.tsx`

### 4c. `library/page.tsx`

Replace card items with `<FolioCard>`. It accepts `cover: "stitch" | "manila" | "index" | "pinned" | "photo"` and renders the matching variant. If your data model doesn't store a cover style, derive it deterministically from the folio id:

```ts
const COVERS = ["stitch","manila","index","pinned","photo"] as const;
function pickCover(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COVERS[Math.abs(h) % COVERS.length];
}
```

Each FolioCard takes:

```ts
{
  folio: string;          // "MR-002-蜻蜓"
  title: string;
  titleEn?: string;
  status: "active" | "draft" | "archived";
  cover: "stitch" | "manila" | "index" | "pinned" | "photo";
  sources: { kind: SourceKind; name: string }[];
  excerpt: string;
  tags: string[];
  updated: string;
  accent?: string;        // hex; falls back to --terracotta
}
```

The card auto-builds the source-thumbnail strip from `sources` (showing up to 5 distinct kinds + `+N`).

### 4d. `library/[id]/page.tsx`

Refactor into a 3-pane shell:

```
[ Library | Canvas (tabs: Reader · Synopsis · Marginalia) | Studio ]
```

- **Library pane**: your existing files panel, styled with `<SourceTile>` rows grouped by kind
- **Canvas tabs**: simple state `<"reader"|"synopsis"|"marginalia">`
  - *Reader* — the paper preview frames (PDF, MD, image, audio, URL). I include CSS recipes in `handoff/preview-recipes.md`. Render real content via your viewers; the recipes only set the *frame*.
  - *Synopsis* — your existing markdown editor inside `.ff-pdf-frame` styling; "Draft from sources" button calls your existing chat endpoint with a templated prompt
  - *Marginalia* — sections (`highlights | questions | connections | todo | custom`) editable inline. New table needed: `folio_marginalia(folio_id, section_id, kind, title, items jsonb, position)`.
- **Studio pane**: your existing generate panel, reskinned

---

## Step 5 — Source-kind icons

Use lucide for the floating button icons, but the *thumbnail* glyphs are tiny paper-cards with 2-letter labels. See `<SourceThumb>` — it generates them procedurally:

```tsx
<SourceThumb kind="pdf" />     // {bg: amber-tinted, footer: red, glyph: "PDF"}
<SourceThumb kind="image" />   // {bg: olive-gradient, glyph: "IMG"}
```

Maps:

```ts
const KIND = {
  pdf:   { short: "PDF", long: "PDF" },
  md:    { short: "MD",  long: "Notes" },
  image: { short: "IMG", long: "Images" },
  audio: { short: "WAV", long: "Audio" },
  html:  { short: "HTM", long: "HTML" },
  pptx:  { short: "PPT", long: "Slides" },
  url:   { short: "URL", long: "Links" },
};
```

Your `notebook/source-icons.ts` keeps its existing role for *real* file icons in lists; `<SourceThumb>` is just for card covers.

---

## Step 6 — Theme switching (optional)

The design supports `data-theme="cream | sepia | ink | dark"` on `<html>`. The token CSS includes the four variants. If you want a theme switcher, mount your existing settings UI to set a cookie + apply via the layout — or punt and hard-code `cream` for v1.

---

## Step 7 — What I deliberately did NOT touch

- Your Supabase schema (only one optional new table: `folio_marginalia`)
- Your FastAPI endpoints
- Your auth flow
- The shadcn primitives (`button`, `card`, `dialog`, etc.) — they pick up the new tokens for free; you only need to add card *variants* if you want the paper-stitch / manila etc. effects, which `FolioCard` handles directly.

---

## Migration order I'd suggest

1. Drop in `globals.css` and font config → everything should still work but look different
2. Add `(corpus)/layout.tsx` and `SectionSwitch` → navigation chrome lands
3. Restyle `notebooklm/page.tsx` with `CorpusCard` → notebook landing done
4. Restyle `library/page.tsx` with `FolioCard` → free-form landing done
5. Restyle detail pages — incremental, can ship pane-by-pane

Each step is shippable on its own. The detail pages are the longest tail.

---

## Files in this handoff

- `globals.css` — drop into `src/app/globals.css`
- `app/(corpus)/layout.tsx` — new shared shell
- `components/corpus/CorpusCard.tsx`
- `components/corpus/FolioCard.tsx` (with all 5 cover variants)
- `components/corpus/SectionSwitch.tsx`
- `components/corpus/Masthead.tsx`
- `components/corpus/SourceThumb.tsx`
- `components/corpus/SectionHead.tsx`
- `preview-recipes.md` — CSS for the reader-room preview frames

Open any file in the project tab bar to copy.
