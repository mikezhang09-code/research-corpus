"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, AlertCircle, Eye, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLibraryFileContent } from "@/lib/api";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";

// Pinned to the React version this app ships (see package.json) so the live
// preview behaves like the rest of the portal.
const REACT_VERSION = "19.2.4";
const BABEL_VERSION = "7.28.0";

// Builds the self-contained HTML document that runs the component preview.
//
// Untrusted .jsx/.tsx comes straight out of the R2 bucket, so it is executed in
// a `sandbox="allow-scripts"` iframe (a unique, null origin). That keeps the
// user's code away from the portal's cookies/DOM — important for the public
// Cloudflare worker where anyone can view a folio.
//
// The file is run as a real ES module: Babel transpiles JSX/TSX (keeping the
// import/export syntax), bare specifiers are rewritten to esm.sh, and the result
// is imported from a blob URL. `react`/`react-dom` go through an import map so
// the file AND any third-party libraries (recharts, etc.) share one React
// instance — otherwise hooks throw "invalid hook call".
function buildPreviewDoc(source: string, isTsx: boolean): string {
  // JSON.stringify gives a valid JS string literal; escaping `<` additionally
  // prevents a `</script>` in the source from terminating our inline script.
  const encoded = JSON.stringify(source).replace(/</g, "\\u003c");
  const esm = (spec: string) => `https://esm.sh/${spec}@${REACT_VERSION}`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<script type="importmap">
{
  "imports": {
    "react": "${esm("react")}",
    "react/": "${esm("react")}/",
    "react-dom": "${esm("react-dom")}",
    "react-dom/": "${esm("react-dom")}/",
    "react-dom/client": "${esm("react-dom")}/client"
  }
}
</script>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #2a2418;
    background: #fbf8f0;
    padding: 20px;
  }
  #root:empty::after {
    content: "Rendering…";
    color: #8a8268;
    font: 12px ui-monospace, monospace;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .__jsx-err {
    font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #a13b2a;
    background: #f7ece6;
    border: 1px solid rgba(161,59,42,0.4);
    border-radius: 2px;
    padding: 14px 16px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .__jsx-err b { display: block; margin-bottom: 6px; letter-spacing: 0.08em; text-transform: uppercase; font-size: 10px; }
</style>
</head>
<body>
<div id="root"></div>
<script type="module">
  import React from "react";
  import { createRoot } from "react-dom/client";

  const SOURCE = ${encoded};
  const IS_TSX = ${isTsx ? "true" : "false"};
  const root = document.getElementById("root");

  function showError(label, err) {
    const msg = (err && err.message) ? err.message : String(err);
    root.innerHTML = "";
    const box = document.createElement("div");
    box.className = "__jsx-err";
    const head = document.createElement("b");
    head.textContent = label;
    box.appendChild(head);
    box.appendChild(document.createTextNode(msg));
    root.appendChild(box);
  }

  window.addEventListener("error", (e) => showError("Runtime error", e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => showError("Runtime error", e.reason));

  // Point bare third-party specifiers at esm.sh, pinning React as an external so
  // libraries reuse the import-map React instead of bundling their own copy.
  // \`react\`, \`react-dom\` and relative/absolute paths are left untouched.
  function rewriteImports(src) {
    return src.replace(
      /(\\bfrom\\s*|\\bimport\\s*)(["'])([^"']+)\\2/g,
      (match, pre, quote, spec) => {
        if (spec === "react" || spec === "react-dom") return match;
        if (spec.startsWith("react/") || spec.startsWith("react-dom/")) return match;
        if (/^(https?:|\\.|\\/)/.test(spec)) return match;
        return pre + quote + "https://esm.sh/" + spec + "?external=react,react-dom" + quote;
      },
    );
  }

  try {
    const Babel = (await import("https://esm.sh/@babel/standalone@${BABEL_VERSION}")).default;

    let transpiled;
    try {
      transpiled = Babel.transform(rewriteImports(SOURCE), {
        filename: IS_TSX ? "file.tsx" : "file.jsx",
        presets: [
          ["react", { runtime: "automatic" }],
          ["typescript", { isTSX: true, allExtensions: true, allowDeclareFields: true }],
        ],
      }).code;
    } catch (e) {
      showError("Compile error", e);
      throw e;
    }

    const url = URL.createObjectURL(new Blob([transpiled], { type: "text/javascript" }));
    let mod;
    try {
      mod = await import(url);
    } catch (e) {
      showError("Module error", e);
      throw e;
    } finally {
      URL.revokeObjectURL(url);
    }

    const Component = mod.default || mod.App;
    if (!Component) {
      showError("Nothing to render", new Error("No default export was found. Add \`export default\` to your component."));
    } else {
      class Boundary extends React.Component {
        constructor(p) { super(p); this.state = { err: null }; }
        static getDerivedStateFromError(err) { return { err }; }
        componentDidCatch(err) { showError("Render error", err); }
        render() { return this.state.err ? null : this.props.children; }
      }
      createRoot(root).render(React.createElement(Boundary, null, React.createElement(Component)));
    }
  } catch (e) {
    if (root && !root.querySelector(".__jsx-err")) showError("Preview failed", e);
  }
</script>
</body>
</html>`;
}

export function JsxModal({
  notebookId,
  fileId,
  title,
  ext,
  onClose,
}: {
  /** Folio id, or null for a free-form file. */
  notebookId: string | null;
  fileId: string;
  title: string;
  ext: string;
  onClose: () => void;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<"preview" | "source">("preview");

  const isTsx = ext.toLowerCase() === ".tsx";

  useEffect(() => {
    let cancelled = false;
    getLibraryFileContent(notebookId, fileId)
      .then((text) => { if (!cancelled) setSource(text); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [notebookId, fileId]);

  const srcDoc = useMemo(
    () => (source !== null ? buildPreviewDoc(source, isTsx) : null),
    [source, isTsx],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-5xl max-h-[90vh]"} flex flex-col overflow-hidden`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0 gap-3">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
          <div className="flex items-center gap-1 shrink-0">
            <div className="flex items-center rounded-[1px] border border-rule mr-1">
              <button
                type="button"
                onClick={() => setTab("preview")}
                title="Live preview"
                className={`flex items-center gap-1.5 h-8 px-2.5 font-mono text-[10px] tracking-[0.14em] uppercase ${
                  tab === "preview" ? "bg-ink text-paper" : "text-ink-fade hover:text-ink hover:bg-paper-deep"
                }`}
              >
                <Eye className="h-3.5 w-3.5" /> Preview
              </button>
              <button
                type="button"
                onClick={() => setTab("source")}
                title="Source code"
                className={`flex items-center gap-1.5 h-8 px-2.5 font-mono text-[10px] tracking-[0.14em] uppercase border-l border-rule ${
                  tab === "source" ? "bg-ink text-paper" : "text-ink-fade hover:text-ink hover:bg-paper-deep"
                }`}
              >
                <Code2 className="h-3.5 w-3.5" /> Source
              </button>
            </div>
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-paper-light flex flex-col">
          {error ? (
            <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase px-6 py-4">
              <AlertCircle className="h-4 w-4 shrink-0" /> Failed to load: {error}
            </div>
          ) : source === null || srcDoc === null ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase px-6 py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : tab === "preview" ? (
            <iframe
              // Untrusted code runs sandboxed (scripts only — no same-origin),
              // so it cannot touch the portal session or DOM.
              key={srcDoc.length}
              title={`${title} preview`}
              srcDoc={srcDoc}
              sandbox="allow-scripts"
              className="w-full flex-1 min-h-[60vh] border-0 bg-white"
            />
          ) : (
            <pre className="flex-1 min-h-0 overflow-auto px-6 py-4 m-0 font-mono text-[12px] leading-relaxed text-ink whitespace-pre">
              {source}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
