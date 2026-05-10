"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Plus, Send, Loader2, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { askChat, getChatHistory, type ChatReference, type ChatTurn } from "@/lib/api";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  references?: ChatReference[];
  key: string;
};

export function ChatPanel({ notebookId }: { notebookId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCite, setExpandedCite] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load history on mount
  useEffect(() => {
    setHistoryLoading(true);
    getChatHistory(notebookId)
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

  async function handleSend() {
    const q = inputText.trim();
    if (!q || loading) return;

    setInputText("");
    setError(null);

    const userKey = `u-${Date.now()}`;
    setMessages((prev) => [...prev, { role: "user", text: q, key: userKey }]);
    setLoading(true);

    try {
      const res = await askChat(notebookId, q, {
        conversationId: conversationId ?? undefined,
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

  return (
    <div className="flex flex-col h-full border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">Chat</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-7 text-xs"
          onClick={handleNewChat}
        >
          <Plus className="h-3.5 w-3.5" />
          New chat
        </Button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0"
      >
        {historyLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-3/4 ml-auto rounded-2xl" />
            <Skeleton className="h-16 w-4/5 rounded-2xl" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 py-12">
            <MessageSquare className="h-8 w-8 opacity-20" />
            <p className="text-sm font-medium">Ask the notebook anything</p>
            <p className="text-xs text-center max-w-48">
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
                <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-3.5 py-2.5 text-sm">
                  {msg.text}
                </div>
              ) : (
                <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5">
                  <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-p:leading-relaxed prose-p:text-foreground prose-strong:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:rounded prose-code:text-sm prose-a:text-primary prose-a:underline">
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
            <div className="rounded-2xl rounded-tl-sm bg-muted px-3.5 py-3 flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Thinking…</span>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 flex items-start gap-2 text-destructive text-xs bg-destructive/5 border border-destructive/20 rounded-md p-2.5 shrink-0">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
            disabled={loading || historyLoading}
            className="flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={loading || !inputText.trim()}
            className="h-9 w-9 shrink-0 mb-0.5"
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
}

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
        className="inline-flex items-center justify-center h-4 min-w-4 px-1 ml-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        title={chatRef.cited_text ?? chatRef.source_id}
      >
        {chatRef.citation_number ?? index + 1}
      </button>
      {expanded && chatRef.cited_text && (
        <span className="block mt-1 text-xs bg-muted border border-border rounded p-2 text-muted-foreground leading-relaxed">
          {chatRef.cited_text}
          <span className="block mt-1 text-[10px] text-muted-foreground/70 font-mono truncate">
            src: {chatRef.source_id.slice(0, 8)}…
          </span>
        </span>
      )}
    </span>
  );
}
