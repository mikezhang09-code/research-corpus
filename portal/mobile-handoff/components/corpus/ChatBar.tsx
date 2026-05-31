"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";

/**
 * Pinned ask-a-question bar for mobile detail pages.
 * Sits at the bottom of a flex-column page (flex-shrink-0).
 * Reuses your existing ask handler — pass it as `onSend`.
 */
export function ChatBar({
  onSend,
  placeholder = "Ask a question…",
  disabled,
}: {
  onSend: (text: string) => void | Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };

  return (
    <form
      onSubmit={submit}
      className="flex-shrink-0 flex items-center gap-2.5 border-t border-rule bg-paper-light px-4 pt-2.5"
      style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom, 0.5rem))" }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="flex-1 min-w-0 rounded-full border border-ink bg-vellum px-4 py-2.5 font-serif text-[14px] outline-none placeholder:italic placeholder:text-ink-mute"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="flex-shrink-0 w-[42px] h-[42px] rounded-full bg-ink text-paper-light flex items-center justify-center disabled:opacity-40"
        aria-label="Send"
      >
        <ArrowRight size={16} />
      </button>
    </form>
  );
}
