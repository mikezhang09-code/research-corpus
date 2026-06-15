// Shared Mermaid loader. mermaid is enormous (bundling it pushed the public
// Worker past Cloudflare's 3 MiB limit), so it is never bundled: the browser
// pulls it from the CDN on first use. Shared by the Markdown renderer
// (```mermaid fences) and the Diagram artifact editor/viewer.

// Minimal surface of the mermaid UMD global this app uses.
export type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  parse(source: string): Promise<unknown>;
  render(id: string, source: string): Promise<{ svg: string }>;
};

declare global {
  interface Window {
    mermaid?: MermaidApi;
  }
}

const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.min.js";
let mermaidLoader: Promise<MermaidApi> | null = null;

export function loadMermaid(): Promise<MermaidApi> {
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
