"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { MessageSquare, Plus, Send, Loader2, AlertCircle, Save } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  askChat, getChatHistory, uploadLibraryNotebookFile, clearLibraryChatHistory,
  type ChatReference, type ChatTurn,
} from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";

const LIBRARY_PREFIX = "/api/library-notebooks";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  references?: ChatReference[];
  key: string;
};

export type ChatPanelHandle = {
  /** Send a question programmatically (e.g. from a clicked suggested topic). */
  send: (prompt: string) => void;
};

export const ChatPanel = forwardRef<ChatPanelHandle, { notebookId: string; apiPrefix?: string }>(
function ChatPanel(
  { notebookId, apiPrefix },
  ref,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCite, setExpandedCite] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [language] = useLanguage();
  const [saving, setSaving] = useState(false);

  // Save-as-folio-note is only meaningful for the library chat path (folios).
  // NotebookLM's chat lives in Google's product and isn't ours to persist.
  const canSave = apiPrefix === LIBRARY_PREFIX && messages.length > 0 && !loading && !saving;

  // Load history on mount
  useEffect(() => {
    setHistoryLoading(true);
    getChatHistory(notebookId, { apiPrefix })
      .then((data) => {
        if (data.turns.length > 0) {
          const restored: ChatMessage[] = [];
          data.turns.forEach((t, i) => {
            restored.push({ role: "user", text: t.question, key: `h-u-${i}` });
            restored.push({ role: "assistant", text: t.answer, key: `h-a-${i}` });
          });
          setMessages(restored);
        }
        if (data.conversation_id) setConversationId(data.conversation_id);
      })
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [notebookId]);

  // Auto-scroll on messages or loading change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function sendQuestion(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    setError(null);

    const userKey = `u-${Date.now()}`;
    setMessages((prev) => [...prev, { role: "user", text: trimmed, key: userKey }]);
    setLoading(true);

    try {
      const res = await askChat(notebookId, trimmed, {
        conversationId: conversationId ?? undefined,
        apiPrefix,
        language,
      });
      setConversationId(res.conversation_id);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: res.answer,
          references: res.references,
          key: `a-${Date.now()}`,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages((prev) => prev.filter((m) => m.key !== userKey));
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    const q = inputText.trim();
    if (!q || loading) return;
    setInputText("");
    await sendQuestion(q);
  }

  // Keep an up-to-date reference so the imperative `send()` always uses the
  // latest closure (with current conversationId and loading state).
  const sendRef = useRef(sendQuestion);
  sendRef.current = sendQuestion;
  useImperativeHandle(ref, () => ({ send: (prompt: string) => sendRef.current(prompt) }), []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleNewChat() {
    setConversationId(null);
    setMessages([]);
    setError(null);
    textareaRef.current?.focus();
  }

  async function handleSaveAsNote() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const now = new Date();
      const stampDisplay = now.toLocaleString("en-US", {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
      const stampFile = now
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace(/T/, "_")
        .slice(0, 19);
      const md = buildChatMarkdown(messages, stampDisplay);
      const file = new File([md], `chat-${stampFile}.md`, { type: "text/markdown" });
      await uploadLibraryNotebookFile(notebookId, file, "note", `Chat — ${stampDisplay}`);
      // Wipe server-side history so the next turn starts fresh
      await clearLibraryChatHistory(notebookId);
      setConversationId(null);
      setMessages([]);
      textareaRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-vellum">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-rule shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-terracotta" />
          <span className="font-serif-display italic text-[16px] tracking-tight text-ink">Marginalia</span>
        </div>
        <div className="flex items-center gap-1">
          {apiPrefix === LIBRARY_PREFIX && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-7 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink disabled:opacity-50"
              onClick={handleSaveAsNote}
              disabled={!canSave}
              title="Save this chat to the folio as a note, then clear it"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {saving ? "Saving" : "Save"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink"
            onClick={handleNewChat}
            disabled={saving}
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0"
      >
        {historyLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-3/4 ml-auto rounded-[2px]" />
            <Skeleton className="h-16 w-4/5 rounded-[2px]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-ink-mute gap-3 py-12">
            <MessageSquare className="h-8 w-8 opacity-40" />
            <p className="font-serif-display text-[18px] tracking-tight text-ink">Ask the notebook anything</p>
            <p className="font-serif italic text-[12.5px] text-center max-w-52 text-ink-fade">
              Questions are answered using the notebook&apos;s sources.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.key}
              className={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              {msg.role === "user" ? (
                <div className="max-w-[80%] rounded-[2px] bg-ink text-paper px-3.5 py-2.5 font-serif text-[13.5px] leading-snug">
                  {msg.text}
                </div>
              ) : (
                <div className="max-w-[92%] rounded-[2px] bg-paper border border-rule px-3.5 py-2.5">
                  <div className="prose prose-sm max-w-none font-serif
                    prose-headings:font-serif-display prose-headings:tracking-tight prose-headings:text-ink
                    prose-p:leading-relaxed prose-p:text-ink-soft
                    prose-strong:text-ink prose-strong:font-semibold
                    prose-code:bg-paper-deep prose-code:px-1 prose-code:rounded-[1px] prose-code:text-[12px] prose-code:font-mono prose-code:text-ink
                    prose-a:text-terracotta prose-a:underline prose-a:underline-offset-2
                    prose-blockquote:border-l-2 prose-blockquote:border-terracotta prose-blockquote:pl-3 prose-blockquote:text-ink-fade prose-blockquote:italic">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                  {msg.references && msg.references.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {msg.references.map((chatRef, i) => {
                        const citeKey = `${msg.key}-${i}`;
                        return (
                          <CitationBadge
                            key={citeKey}
                            chatRef={chatRef}
                            index={i}
                            msgKey={msg.key}
                            expanded={expandedCite === citeKey}
                            onToggle={() =>
                              setExpandedCite((prev) =>
                                prev === citeKey ? null : citeKey
                              )
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-[2px] bg-paper border border-rule px-3.5 py-3 flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-terracotta" />
              <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade">Thinking…</span>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5 shrink-0">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-rule shrink-0 bg-paper-light">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
            disabled={loading || historyLoading}
            className="flex-1 resize-none rounded-[1px] border border-rule bg-vellum px-3 py-2 font-serif text-[13.5px] text-ink placeholder:text-ink-mute placeholder:italic focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink disabled:opacity-50"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={loading || !inputText.trim()}
            className="h-9 w-9 shrink-0 mb-0.5 rounded-[1px]"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
});

function CitationBadge({
  chatRef,
  index,
  msgKey,
  expanded,
  onToggle,
}: {
  chatRef: ChatReference;
  index: number;
  msgKey: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <span className="inline-block align-baseline">
      <button
        onClick={onToggle}
        className="inline-flex items-center justify-center h-4 min-w-4 px-1 ml-0.5 rounded-[1px] font-mono text-[10px] tracking-[0.06em] border border-terracotta/40 text-terracotta bg-vellum hover:bg-terracotta/10 transition-colors"
        title={chatRef.cited_text ?? chatRef.source_id}
      >
        {chatRef.citation_number ?? index + 1}
      </button>
      {expanded && chatRef.cited_text && (
        <span className="block mt-1 font-serif italic text-[12.5px] bg-paper border border-rule rounded-[1px] p-2 text-ink-fade leading-relaxed">
          {chatRef.cited_text}
          <span className="block mt-1 font-mono not-italic text-[9px] tracking-[0.1em] uppercase text-ink-mute truncate">
            src: {chatRef.source_id.slice(0, 8)}…
          </span>
        </span>
      )}
    </span>
  );
}

function buildChatMarkdown(messages: ChatMessage[], stamp: string): string {
  const lines: string[] = [`# Chat — ${stamp}`, ""];
  let turn = 1;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user") {
      lines.push(`## Question ${turn}`, "", m.text.trim(), "");
      const a = messages[i + 1];
      if (a && a.role === "assistant") {
        lines.push("### Answer", "", a.text.trim(), "");
        i++;
        turn++;
      } else {
        lines.push("### Answer", "", "_(no answer captured)_", "");
        turn++;
      }
      lines.push("---", "");
    } else if (m.role === "assistant" && i === 0) {
      // orphan assistant message — render under a placeholder question
      lines.push("## Answer", "", m.text.trim(), "", "---", "");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
