"use client";

import { useEffect, useId, useState, type HTMLAttributes, type ReactNode } from "react";
import type { Components, Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { Loader2 } from "lucide-react";
import "katex/dist/katex.min.css";
import "./markdown-extras.css";

// Shared react-markdown configuration for every markdown surface in the
// portal: GFM tables/strikethrough, KaTeX math, syntax-highlighted code
// fences, and ```mermaid fences rendered as diagrams.
//
// Single-dollar inline math is disabled on purpose: research reports are full
// of literal dollar amounts ("$5B vs $3B revenue") that would otherwise be
// mangled into math. Use $$...$$ for both inline and display math.
export const markdownRemarkPlugins: Options["remarkPlugins"] = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
];

export const markdownRehypePlugins: Options["rehypePlugins"] = [
  rehypeHighlight,
  rehypeKatex,
];

const MERMAID_RE = /\blanguage-mermaid\b/;

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return flattenText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

// Minimal surface of the mermaid UMD global this module uses.
type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

declare global {
  interface Window { mermaid?: MermaidApi }
}

const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.min.js";
let mermaidLoader: Promise<MermaidApi> | null = null;

// mermaid is enormous (the bundled copy pushed the public Worker past
// Cloudflare's 3 MiB script limit), so it is never bundled: the browser pulls
// it from the CDN, and only when a document actually contains a ```mermaid
// fence.
function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidLoader) {
    mermaidLoader = new Promise<MermaidApi>((resolve, reject) => {
      if (window.mermaid) return resolve(window.mermaid);
      const script = document.createElement("script");
      script.src = MERMAID_CDN;
      script.onload = () => {
        if (window.mermaid) {
          window.mermaid.initialize({ startOnLoad: false, theme: "neutral", fontFamily: "inherit" });
          resolve(window.mermaid);
        } else {
          reject(new Error("mermaid script loaded but window.mermaid is missing"));
        }
      };
      script.onerror = () => {
        mermaidLoader = null; // allow a retry on the next diagram
        reject(new Error("failed to load mermaid from CDN"));
      };
      document.head.appendChild(script);
    });
  }
  return mermaidLoader;
}

function MermaidDiagram({ source }: { source: string }) {
  const renderId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then(async (mermaid) => {
        const { svg } = await mermaid.render(`mermaid-${renderId}`, source);
        if (!cancelled) setSvg(svg);
      })
      .catch((e: unknown) => {
        // A parse failure can leave mermaid's scratch element in the DOM.
        document.getElementById(`dmermaid-${renderId}`)?.remove();
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [source, renderId]);

  if (error) {
    return (
      <pre title={`Mermaid: ${error}`}>
        <code>{source}</code>
      </pre>
    );
  }
  if (!svg) {
    return (
      <div className="not-prose flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase border border-rule rounded-[2px] bg-paper-deep/40 px-4 py-6 my-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Rendering diagram…
      </div>
    );
  }
  return (
    <div
      className="not-prose overflow-x-auto flex justify-center my-4 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

type CodeProps = HTMLAttributes<HTMLElement> & { children?: ReactNode; node?: unknown };
type PreProps = HTMLAttributes<HTMLPreElement> & { children?: ReactNode; node?: unknown };

function childClassName(children: ReactNode): string {
  const only = Array.isArray(children) ? children.find(Boolean) : children;
  if (only && typeof only === "object" && "props" in only) {
    return (only as { props?: { className?: string } }).props?.className ?? "";
  }
  return "";
}

// Spread into the `components` prop of ReactMarkdown (before any local
// overrides). Routes ```mermaid fences to MermaidDiagram and unwraps their
// <pre> so diagrams aren't framed as code blocks.
export const markdownCodeComponents: Components = {
  code({ className, children, node: _node, ...props }: CodeProps) {
    void _node; // react-markdown's hast node must not reach the DOM element
    if (MERMAID_RE.test(className ?? "")) {
      return <MermaidDiagram source={flattenText(children).trim()} />;
    }
    return <code className={className} {...props}>{children}</code>;
  },
  pre({ children, node: _node, ...props }: PreProps) {
    void _node;
    if (MERMAID_RE.test(childClassName(children))) return <>{children}</>;
    return <pre {...props}>{children}</pre>;
  },
};
