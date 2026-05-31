# Research Corpus — Mobile Handoff

A focused package for making the portal **responsive on phones** (≤ 767px). It assumes you've already landed (or are landing) the desktop design from `../DESIGN_HANDOFF.md` — same tokens, same components. Nothing here is a separate mobile route; it's breakpoint behavior + a few mobile-only components layered onto your existing pages.

Stack (verified): Next.js 16 · React 19 · Tailwind v4 · shadcn (base-nova) · Base UI · lucide.

Tailwind's default breakpoint `md` = 768px. Everything below is "mobile"; `md:` and up is "desktop". I use **mobile-first** classes (base = phone, `md:` overrides to desktop) throughout.

---

## What changes on mobile

| Desktop | Mobile |
|---|---|
| Section pills inline in masthead | Full-width **segmented switch** under masthead |
| Card grid (3–4 cols) | **1 column**, full-bleed cards |
| Tag bar wraps | **Horizontal-scroll** strip |
| Notebook detail: 3 panes side by side | **Tabbed** (Synopsis / Artifacts / Sources / Marginalia) |
| Chat in right pane | **Pinned bottom bar**, always visible |
| Folio detail: file grid 3-up | File grid **1-up**, scrollable kind filters |

---

## Files in this package

```
mobile-handoff/
├── MOBILE_HANDOFF.md                ← this file
├── mobile.css                       ← @utility + component classes to append to globals.css
└── components/corpus/
    ├── SectionSwitch.tsx            ← REPLACES the desktop one (now responsive)
    ├── MobileDetailTabs.tsx         ← tab bar for detail pages
    ├── ChatBar.tsx                  ← pinned ask-a-question bar
    ├── ScrollStrip.tsx              ← reusable horizontal scroller (tags / filters)
    └── useMediaQuery.ts             ← tiny hook to branch layout in JS when needed
```

Append `mobile.css` to the bottom of your `src/app/globals.css` (it only adds; nothing conflicts).

---

## 1 — Section switch (responsive)

The desktop `SectionSwitch` already exists. Replace it with the version in `components/corpus/SectionSwitch.tsx` — same links, but it renders inline on `md:` and as a full-width segmented control below the masthead on mobile. Drop it in your `(corpus)/layout.tsx` exactly where it is now; no layout change needed.

Key classes:
```
flex w-full md:w-auto         /* full-bleed on phone, hug on desktop */
```

---

## 2 — Card grids → 1 column

In `notebooklm/page.tsx` and `library/page.tsx`, change the grid wrapper:

```tsx
// before
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 px-14">
// after
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 px-5 md:px-14">
```

The cards (`CorpusCard`, `FolioCard`) already fluid-fill their column — no card change needed. On mobile they go full width automatically. Optionally bump the folio title to `text-2xl` on mobile for tactile feel (already in the component).

---

## 3 — Tag bar → horizontal scroll

Wrap your tag list in `<ScrollStrip>` (provided). It's a `flex` row with `overflow-x-auto`, hidden scrollbar, and `snap-x`. On `md:` it can wrap normally:

```tsx
<ScrollStrip className="px-5 md:px-14">
  {tags.map(t => <TagChip key={t} ... />)}
</ScrollStrip>
```

`ScrollStrip` reads `md:flex-wrap md:overflow-visible` so desktop keeps the wrapping bar.

---

## 4 — Notebook detail → tabs + pinned chat

This is the biggest change. Your desktop `notebooklm/[id]/page.tsx` has a persistent split-pane (artifacts/sources left, chat right). On mobile:

1. Wrap the page body in a flex column that fills the viewport:
   ```tsx
   <div className="flex flex-col h-[100dvh] md:h-auto md:block">
   ```
2. On mobile, render `<MobileDetailTabs>` (Synopsis / Artifacts / Sources / Marginalia) and show one pane at a time. On `md:`, keep your existing split-pane and hide the tabs.
   ```tsx
   const isMobile = useMediaQuery("(max-width: 767px)");
   …
   {isMobile ? (
     <>
       <MobileDetailTabs value={tab} onChange={setTab} />
       <div className="flex-1 overflow-y-auto">
         {tab === "synopsis"   && <SynopsisPane … />}
         {tab === "artifacts"  && <ArtifactsGrid … />}
         {tab === "sources"    && <SourcesPanel … />}   {/* your existing component */}
         {tab === "marginalia" && <MarginaliaPane … />}
       </div>
       <ChatBar onSend={handleAsk} />
     </>
   ) : (
     <YourExistingSplitPane … />
   )}
   ```
3. `<ChatBar>` is `flex-shrink-0`, sits at the bottom of the flex column, and respects `env(safe-area-inset-bottom)`. It calls the **same** `handleAsk` your desktop chat uses — no new endpoint.

`useMediaQuery` (provided) avoids hydration mismatch by returning `false` on the server and updating after mount. If you prefer pure CSS, you can instead render both and toggle with `hidden md:block` / `md:hidden`, but the JS branch is cleaner for the chat state.

---

## 5 — Folio detail → 1-up files + scroll filters

In `library/[id]/page.tsx`:
- File grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 px-5 md:px-8`
- Kind filters (`all / slides / notes / reports / audio / images / links`): wrap in `<ScrollStrip>`
- Action row (Select / Note / Add file): `flex gap-2`, each `flex-1` on mobile so they fill the width

The colour-coded file type headers (SLIDE / REPORT / DOC) need no change.

---

## 6 — Safe areas & viewport

- Use `h-[100dvh]` (dynamic viewport height) on full-screen detail pages so the chat bar isn't hidden behind mobile browser chrome.
- The `ChatBar` already adds `pb-[env(safe-area-inset-bottom)]`.
- Add to your root layout `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />` so safe-area insets resolve.

---

## 7 — What I did NOT change

- No new routes — same `/notebooklm`, `/library`, `/notebooklm/[id]`, `/library/[id]`
- No data/API changes — `ChatBar` reuses your existing ask handler
- No new deps — everything is Tailwind + your existing shadcn/lucide

---

## Migration order

1. Append `mobile.css`, add `viewport-fit=cover` meta → safe areas + utilities ready
2. Swap `SectionSwitch` → nav works on phone
3. Grid `px` + `grid-cols-1` base on both landing pages → landings done
4. Wrap tag/filter bars in `ScrollStrip`
5. Notebook detail tabs + `ChatBar` (the long one)
6. Folio detail file grid + filters

Steps 1–4 are ~30 min total. Step 5 is the real work. Each is shippable alone.

The interactive reference for all of this is `Research Corpus Mobile.html` in the parent project — open it to see the exact spacing, the segmented switch, the tab behavior, and the pinned chat bar in five live iPhone frames.
