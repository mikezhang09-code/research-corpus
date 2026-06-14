"use client";

import { useEffect, useId, useState, type HTMLAttributes, type ReactNode } from "react";
import type { Components, Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { Check, Copy, Loader2 } from "lucide-react";
import { loadMermaid } from "@/lib/mermaid";
import { copyTextToClipboard } from "@/lib/clipboard";
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

function CopyablePre({ children, node: _node, ...props }: PreProps) {
  void _node;
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (await copyTextToClipboard(flattenText(children))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <div className="relative group">
      <pre {...props}>{children}</pre>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy code"}
        aria-label={copied ? "Copied" : "Copy code"}
        className="absolute top-2 right-2 h-7 w-7 inline-flex items-center justify-center rounded-[1px] border border-rule bg-vellum/90 text-ink-fade opacity-60 hover:opacity-100 hover:text-ink hover:border-ink group-hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

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
  pre(props: PreProps) {
    if (MERMAID_RE.test(childClassName(props.children))) return <>{props.children}</>;
    return <CopyablePre {...props} />;
  },
};
