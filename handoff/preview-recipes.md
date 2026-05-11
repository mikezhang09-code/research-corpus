# Reader-room preview frames

The free-form **Canvas → Reader** tab renders whichever source the user picked, inside a paper-style frame. Below are framework-agnostic CSS recipes for each source kind. Apply them to a wrapper around your existing viewer (you keep the viewer; only the frame changes).

```tsx
<div className={`ff-frame ff-frame-${source.kind}`}>
  {/* your existing viewer: react-pdf, ReactMarkdown, <audio>, <img>, iframe, etc. */}
</div>
```

## Frame base

```css
.ff-frame {
  background: var(--color-vellum);
  border: 1px solid var(--color-ink);
  border-radius: 2px;
  box-shadow: 2px 2px 0 rgb(42 36 24 / 0.08);
  padding: 0;
  overflow: hidden;
  position: relative;
}
.ff-frame::before {
  /* "Folio · pg N" label */
  content: attr(data-label);
  position: absolute;
  top: -1px; left: 16px;
  padding: 3px 10px;
  background: var(--color-vellum);
  border: 1px solid var(--color-ink); border-top: none;
  font-family: var(--font-mono);
  font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--color-ink-fade);
  z-index: 1;
}
```

## Per-kind framing

```css
/* PDF — give the viewer a cream "page" inside the frame */
.ff-frame-pdf > * {
  background: #fbf5e6;
  padding: 48px 56px;
}

/* Markdown — typographic — pair with prose-stone */
.ff-frame-md > * {
  padding: 36px 48px;
  font-family: var(--font-serif);
  font-size: 15px;
  line-height: 1.7;
  color: var(--color-ink-soft);
}

/* Image — let it breathe, give it a thin inner border */
.ff-frame-image {
  background: var(--color-paper-deep);
  padding: 24px;
}
.ff-frame-image img {
  width: 100%; height: auto; display: block;
  border: 1px solid var(--color-ink);
}

/* Audio — show waveform pattern + transcript below */
.ff-frame-audio {
  padding: 28px 36px;
}

/* URL — show as "web archive" with a fake browser bar */
.ff-frame-url::after {
  content: "";
  position: absolute; left: 0; right: 0; top: 0;
  height: 28px; background: var(--color-paper-deep);
  border-bottom: 1px solid var(--color-ink);
}
.ff-frame-url iframe { margin-top: 28px; }
```

In your `library/[id]/page.tsx`, the canvas component looks roughly like:

```tsx
type Tab = "reader" | "synopsis" | "marginalia";
const [tab, setTab] = useState<Tab>("reader");
const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

return (
  <div className="flex-1 bg-paper border-x border-rule flex flex-col">
    <CanvasTabs tab={tab} onChange={setTab} />
    {tab === "reader" && activeSource && (
      <div className="ff-frame" data-label={`${folio.folio} · ${activeSource.name}`}>
        <SourceViewer source={activeSource} />
      </div>
    )}
    {tab === "synopsis"   && <SynopsisEditor folio={folio} />}
    {tab === "marginalia" && <MarginaliaSections folio={folio} />}
  </div>
);
```

Marginalia section shape (suggested schema):

```ts
type MarginaliaSection = {
  id: string;
  kind: "highlights" | "questions" | "connections" | "todo" | "custom";
  title: string;
  items: Array<{ id: string; body: string; checked?: boolean }>;
  position: number;
};
```

The "Draft from sources" button in Synopsis simply calls your existing chat endpoint with a system prompt like:

> You are drafting a synopsis section for a research folio titled "{title}". Use only the provided source excerpts. Return ~120 words of prose in the user's voice (serif, reflective, no bullet lists).

…and appends the response to the editor. No new endpoints needed.
