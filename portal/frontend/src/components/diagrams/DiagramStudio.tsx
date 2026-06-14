"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Download,
  Image as ImageIcon,
  Sparkles,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { assistDiagram } from "@/lib/api";

const STORAGE_KEY = "diagram-studio:code";

const STARTER = `flowchart TD
    A[Start] --> B{Authenticated?}
    B -->|yes| C[Load dashboard]
    B -->|no| D[Redirect to login]
    C --> E[Done]
    D --> E`;

const TEMPLATES: { label: string; code: string }[] = [
  { label: "Flowchart", code: STARTER },
  {
    label: "Sequence",
    code: `sequenceDiagram
    participant U as User
    participant API
    participant DB
    U->>API: POST /login
    API->>DB: lookup user
    DB-->>API: row
    API-->>U: 200 + token`,
  },
  {
    label: "State",
    code: `stateDiagram-v2
    [*] --> Draft
    Draft --> Review: submit
    Review --> Draft: changes
    Review --> Published: approve
    Published --> [*]`,
  },
  {
    label: "Class",
    code: `classDiagram
    class Notebook {
      +string id
      +string title
      +addSource()
    }
    class Source {
      +string id
      +string kind
    }
    Notebook "1" --> "*" Source`,
  },
  {
    label: "Gantt",
    code: `gantt
    title Project plan
    dateFormat YYYY-MM-DD
    section Build
    Editor      :a1, 2026-06-14, 3d
    AI panel    :after a1, 2d
    section Ship
    Review      :2026-06-19, 1d`,
  },
];

const EXAMPLE_PROMPTS = [
  "Add an error-handling branch after the login step",
  "Convert this to a left-to-right layout",
  "Add a retry loop with a max of 3 attempts",
];

// Lazily import + initialise Mermaid once on the client.
let mermaidReady: Promise<typeof import("mermaid").default> | null = null;
function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: "default",
        securityLevel: "strict",
        flowchart: { htmlLabels: true },
      });
      return mod.default;
    });
  }
  return mermaidReady;
}

export function DiagramStudio() {
  // Restore the last session's diagram. Reads localStorage on the client only;
  // the textarea carries suppressHydrationWarning so the SSR/client value gap
  // doesn't warn.
  const [code, setCode] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem(STORAGE_KEY) ?? STARTER;
    return STARTER;
  });
  const [svg, setSvg] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState("");
  const [copied, setCopied] = useState(false);
  const renderSeq = useRef(0);

  // Debounced render + persist whenever the source changes.
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, code);
    const handle = setTimeout(async () => {
      const seq = ++renderSeq.current;
      const trimmed = code.trim();
      if (!trimmed) {
        setSvg("");
        setRenderError(null);
        return;
      }
      try {
        const mermaid = await getMermaid();
        await mermaid.parse(trimmed); // throws on syntax error
        const { svg: out } = await mermaid.render(`dgm-${seq}`, trimmed);
        if (seq === renderSeq.current) {
          setSvg(out);
          setRenderError(null);
        }
      } catch (err) {
        if (seq === renderSeq.current) {
          setRenderError(err instanceof Error ? err.message : String(err));
        }
        // Mermaid injects an orphan error node on failure — clean it up.
        document.getElementById(`dgm-${seq}`)?.remove();
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [code]);

  const runAssistant = useCallback(async () => {
    const instruction = prompt.trim();
    if (!instruction || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    setAiNote("");
    try {
      const res = await assistDiagram(instruction, code);
      setCode(res.mermaid);
      setAiNote(res.explanation || "Updated the diagram.");
      setPrompt("");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  }, [prompt, code, aiBusy]);

  const copyCode = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [code]);

  const download = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadSvg = useCallback(() => {
    if (!svg) return;
    download(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "diagram.svg");
  }, [svg, download]);

  const downloadPng = useCallback(() => {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = (img.naturalWidth || 800) * scale;
      canvas.height = (img.naturalHeight || 600) * scale;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => b && download(b, "diagram.png"), "image/png");
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [svg, download]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Diagram Studio</h1>
          <p className="text-sm text-muted-foreground">
            Mermaid source is the single source of truth. Edit the text, or ask the AI.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {TEMPLATES.map((t) => (
            <Button key={t.label} variant="outline" size="sm" onClick={() => setCode(t.code)}>
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {/* AI assistant bar */}
      <div className="mb-4 rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runAssistant();
            }}
            placeholder="Describe a change — e.g. 'add a payment step after checkout'"
            className="h-9 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <Button onClick={runAssistant} disabled={aiBusy || !prompt.trim()} size="sm">
            <Wand2 className="size-4" />
            {aiBusy ? "Thinking…" : "Generate"}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {EXAMPLE_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => setPrompt(p)}
              className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {p}
            </button>
          ))}
        </div>
        {aiNote && <p className="mt-2 text-xs text-muted-foreground">✺ {aiNote}</p>}
        {aiError && (
          <p className="mt-2 flex items-center gap-1 text-xs text-destructive">
            <TriangleAlert className="size-3.5" /> {aiError}
          </p>
        )}
      </div>

      {/* Editor + preview */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Mermaid source
            </span>
            <Button variant="ghost" size="xs" onClick={copyCode}>
              <Copy className="size-3.5" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            suppressHydrationWarning
            className="h-[60vh] w-full resize-none rounded-lg border bg-background p-3 font-mono text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>

        <div className="flex flex-col">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Preview
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="xs" onClick={downloadSvg} disabled={!svg}>
                <Download className="size-3.5" /> SVG
              </Button>
              <Button variant="ghost" size="xs" onClick={downloadPng} disabled={!svg}>
                <ImageIcon className="size-3.5" /> PNG
              </Button>
            </div>
          </div>
          <div className="relative h-[60vh] overflow-auto rounded-lg border bg-white p-4">
            {renderError && (
              <div className="absolute inset-x-0 top-0 z-10 flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span className="font-mono">{renderError}</span>
              </div>
            )}
            {svg ? (
              <div
                className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
                // Mermaid output is sanitised (securityLevel: "strict").
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : (
              !renderError && (
                <p className="pt-10 text-center text-sm text-muted-foreground">
                  Your diagram will render here.
                </p>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
