import { type NextRequest, NextResponse } from "next/server";
import { supabase, env } from "@/lib/supabase";
import { r2Bucket, r2KeyForUpload, r2PublicUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

// POST /api/library-notebooks/{id}/generate  { kind }
//
// Generates a new artifact with AI, using the folio's existing text artifacts
// (notes, reports, quizzes, flashcards, mind maps) as context. The model is
// the same Anthropic-compatible MiMo proxy the private portal's chat uses;
// the result is stored exactly like a manual upload, so every viewer/editor
// opens it unchanged.

type Kind = "note" | "mindmap" | "quiz" | "flashcards";

const KINDS: Kind[] = ["note", "mindmap", "quiz", "flashcards"];

// Categories whose stored bytes are readable text; anything else falls back
// to an extension check so e.g. uncategorised .md uploads still contribute.
const TEXT_CATEGORIES = new Set(["note", "report", "quiz", "flashcards", "mindmap"]);
const TEXT_EXTS = new Set([".md", ".markdown", ".txt", ".json", ".csv"]);

const MAX_CONTEXT_FILES = 24;
const MAX_CHARS_PER_FILE = 12_000;
const MAX_TOTAL_CHARS = 80_000;

interface ContextRow {
  title: string;
  file_category: string;
  file_ext: string | null;
  r2_key: string | null;
  r2_url: string | null;
}

async function readText(row: ContextRow): Promise<string | null> {
  try {
    if (row.r2_key) {
      const obj = await r2Bucket().get(row.r2_key);
      if (obj) return await new Response(obj.body).text();
    }
    if (row.r2_url) {
      const res = await fetch(row.r2_url);
      if (res.ok) return await res.text();
    }
  } catch {
    /* unreadable file — skipped from context */
  }
  return null;
}

// ---- prompts ----

const SYSTEM = `You are generating a study artifact for a personal research portal.
Base your output ONLY on the source artifacts provided by the user. Do not invent
facts that are not supported by the sources.`;

function languageDirective(language: string): string {
  return language === "zh"
    ? "Write the artifact in Simplified Chinese (中文)."
    : "Write the artifact in English.";
}

const KIND_INSTRUCTIONS: Record<Kind, string> = {
  note: `Write a synthesis note in Markdown that distils the key ideas across ALL the
source artifacts: the main themes, how the pieces relate, and any open questions.
Start with a single "# <title>" heading on the first line (a short, specific title),
then well-structured sections. Output ONLY the Markdown — no preamble, no code fence.`,
  mindmap: `Produce a mind map of the source material as STRICT JSON (no code fence,
no commentary) in exactly this shape:
{"title": "<short file title>", "name": "<central topic>", "children": [{"name": "...", "children": [...]}]}
Aim for 3-6 main branches and 2-4 levels of depth. "children" may be omitted on leaves.`,
  quiz: `Produce a multiple-choice quiz covering the most important points of the
source material as STRICT JSON (no code fence, no commentary) in exactly this shape:
{"title": "<short quiz title>", "questions": [{"question": "...", "hint": "...", "answerOptions": [{"text": "...", "rationale": "why right/wrong", "isCorrect": true}]}]}
Write 6-10 questions, each with exactly 4 answer options and exactly one isCorrect: true.
Every option needs a rationale. The hint is optional but encouraged.`,
  flashcards: `Produce study flashcards covering the key facts and concepts of the
source material as STRICT JSON (no code fence, no commentary) in exactly this shape:
{"title": "<short deck title>", "cards": [{"front": "question or term", "back": "answer or definition"}]}
Write 12-20 cards. Fronts should be specific prompts, backs concise but complete.`,
};

// ---- model call ----

async function callModel(system: string, prompt: string): Promise<string> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  const base = (env("ANTHROPIC_BASE_URL") ?? "https://api.xiaomimimo.com/anthropic").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env("ANTHROPIC_MODEL") ?? "mimo-v2.5",
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Model API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  // MiMo can interleave {"type":"thinking"} blocks — keep text blocks only.
  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Model returned an empty response");
  return text;
}

// ---- output parsing / validation ----

function extractJson(text: string): unknown {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  // The model may wrap the object in prose (or append commentary after it),
  // so find the balanced "}" for each candidate "{" instead of slicing
  // first-"{" .. last-"}".
  for (let start = stripped.indexOf("{"); start >= 0; start = stripped.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < stripped.length; i++) {
      const ch = stripped[i];
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = inString;
      } else if (ch === '"') {
        inString = !inString;
      } else if (!inString && ch === "{") {
        depth++;
      } else if (!inString && ch === "}" && --depth === 0) {
        try {
          const parsed: unknown = JSON.parse(stripped.slice(start, i + 1));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
        } catch {
          /* not valid JSON from this "{" — try the next one */
        }
        break;
      }
    }
  }
  throw new Error("Model response contained no JSON object");
}

type MindMapNode = { name: string; children?: MindMapNode[] };

function cleanMindMapNode(raw: unknown, depth = 0): MindMapNode | null {
  if (depth > 6 || typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? "").trim();
  if (!name) return null;
  const children = (Array.isArray(o.children) ? o.children : [])
    .map((c) => cleanMindMapNode(c, depth + 1))
    .filter((c): c is MindMapNode => c !== null);
  return children.length ? { name, children } : { name };
}

// Returns { title, content, ext, mime } or throws with a useful message.
function buildArtifact(kind: Kind, raw: string): { title: string; content: string; ext: string; mime: string } {
  if (kind === "note") {
    const heading = raw.match(/^#\s+(.+)$/m);
    const title = (heading?.[1] ?? "Generated note").trim();
    return { title, content: raw, ext: ".md", mime: "text/markdown" };
  }

  const obj = extractJson(raw) as Record<string, unknown>;
  const title = String(obj.title ?? "").trim() || `Generated ${kind}`;

  if (kind === "mindmap") {
    const root = cleanMindMapNode({ name: obj.name, children: obj.children });
    if (!root || !root.children?.length) throw new Error("Model returned an empty mind map");
    return { title, content: JSON.stringify(root, null, 2), ext: ".json", mime: "application/json" };
  }

  if (kind === "quiz") {
    const questions = (Array.isArray(obj.questions) ? obj.questions : [])
      .map((q: Record<string, unknown>) => {
        const opts = (Array.isArray(q.answerOptions) ? q.answerOptions : [])
          .map((o: Record<string, unknown>) => ({
            text: String(o.text ?? "").trim(),
            rationale: String(o.rationale ?? "").trim(),
            isCorrect: Boolean(o.isCorrect),
          }))
          .filter((o) => o.text);
        const hint = String(q.hint ?? "").trim();
        return {
          question: String(q.question ?? "").trim(),
          ...(hint ? { hint } : {}),
          answerOptions: opts,
        };
      })
      .filter((q) => q.question && q.answerOptions.length >= 2 && q.answerOptions.some((o) => o.isCorrect));
    if (questions.length === 0) throw new Error("Model returned no valid quiz questions");
    return { title, content: JSON.stringify({ questions }, null, 2), ext: ".json", mime: "application/json" };
  }

  // flashcards
  const cards = (Array.isArray(obj.cards) ? obj.cards : [])
    .map((c: Record<string, unknown>) => ({
      front: String(c.front ?? "").trim(),
      back: String(c.back ?? "").trim(),
    }))
    .filter((c) => c.front && c.back);
  if (cards.length === 0) throw new Error("Model returned no valid flashcards");
  return { title, content: JSON.stringify({ cards }, null, 2), ext: ".json", mime: "application/json" };
}

// ---- route ----

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: { kind?: string; language?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const kind = body.kind as Kind;
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: `kind must be one of: ${KINDS.join(", ")}` }, { status: 400 });
  }
  const langDirective = languageDirective((body.language ?? "en").toLowerCase());

  const db = supabase();
  const { data: notebook } = await db
    .from("library_notebooks")
    .select("title")
    .eq("id", id)
    .maybeSingle();
  if (!notebook) return NextResponse.json({ error: "Folio not found" }, { status: 404 });

  const { data: rows, error: listError } = await db
    .from("library_items")
    .select("title, file_category, file_ext, r2_key, r2_url")
    .eq("notebook_id", id)
    .order("added_at", { ascending: false });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });

  const textRows = ((rows ?? []) as ContextRow[]).filter(
    (r) => TEXT_CATEGORIES.has(r.file_category) || (r.file_ext && TEXT_EXTS.has(r.file_ext)),
  ).slice(0, MAX_CONTEXT_FILES);

  // Read the context artifacts, truncating so huge files can't blow the prompt.
  const sections: string[] = [];
  let total = 0;
  for (const row of textRows) {
    if (total >= MAX_TOTAL_CHARS) break;
    const text = await readText(row);
    if (!text?.trim()) continue;
    const slice = text.slice(0, Math.min(MAX_CHARS_PER_FILE, MAX_TOTAL_CHARS - total));
    total += slice.length;
    sections.push(
      `<artifact title="${row.title.replace(/"/g, "'")}" type="${row.file_category}">\n${slice}\n</artifact>`,
    );
  }
  if (sections.length === 0) {
    return NextResponse.json(
      { error: "This folio has no readable text artifacts to use as context. Add a note, report, quiz, flashcards or mind map first." },
      { status: 400 },
    );
  }

  // The directive appears in both turns — with a large sources block the
  // tail of the system prompt can get under-weighted (same fix as the
  // private portal's generate endpoint).
  const prompt = `Folio: "${(notebook as { title: string }).title}" — ${sections.length} source artifact(s) follow.

${sections.join("\n\n")}

${KIND_INSTRUCTIONS[kind]}

${langDirective}`;

  let artifact: { title: string; content: string; ext: string; mime: string };
  try {
    artifact = buildArtifact(kind, await callModel(`${SYSTEM}\n${langDirective}`, prompt));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Generation failed: ${msg}` }, { status: 502 });
  }

  // Persist exactly like the upload route so a failed insert leaves no litter.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${kind}-${stamp}${artifact.ext}`;
  const itemId = crypto.randomUUID();
  const r2Key = r2KeyForUpload(itemId, filename);
  const bytes = new TextEncoder().encode(artifact.content);

  try {
    await r2Bucket().put(r2Key, bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: artifact.mime } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `R2 upload failed: ${msg}` }, { status: 502 });
  }

  const row = {
    id: itemId,
    title: artifact.title,
    description: `Generated by AI from ${sections.length} folio artifact(s)`,
    source_type: "upload",
    original_name: filename,
    mime_type: artifact.mime,
    file_ext: artifact.ext,
    file_category: kind,
    r2_key: r2Key,
    r2_url: r2PublicUrl(r2Key),
    file_size_bytes: bytes.byteLength,
    is_link_only: false,
    tags: [] as string[],
    notebook_id: id,
  };
  const { data, error } = await db.from("library_items").insert(row).select().single();
  if (error) {
    try {
      await r2Bucket().delete(r2Key);
    } catch {
      /* best-effort */
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
