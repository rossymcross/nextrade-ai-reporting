"use client";

import { useEffect, useRef, useState } from "react";
import { ChartView } from "./ChartView";
import type { AssistantReply, ChatTurn, Highlight } from "@/lib/types";
import { cn } from "@/lib/cn";
import { ArrowUp, Lightbulb, Info } from "lucide-react";

type Supplier = { id: string; name: string };

const SUGGESTIONS = [
  "Top 5 products by revenue last month",
  "Revenue trend — last 30 days",
  "Category breakdown this month",
  "Compare Tuesday vs Wednesday last week",
  "What's my cancellation rate last month?",
  "Show a snapshot of this month",
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function Chat({
  initialSupplier,
  suppliers,
}: {
  initialSupplier: string;
  suppliers: Supplier[];
}) {
  const [supplier, setSupplier] = useState(initialSupplier);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, loading]);

  async function switchSupplier(id: string) {
    if (id === supplier) return;
    setSwitching(true);
    try {
      await fetch("/api/supplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setSupplier(id);
      setTurns([]);
    } finally {
      setSwitching(false);
    }
  }

  async function send(message: string) {
    const msg = message.trim();
    if (!msg || loading) return;
    const userTurn: ChatTurn = { id: uid(), role: "user", content: msg };
    const history = turns
      .slice(-6)
      .map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, userTurn]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history }),
      });
      const reply: AssistantReply = await res.json();
      const assistantTurn: ChatTurn = {
        id: uid(),
        role: "assistant",
        content: reply.text,
        reply,
      };
      setTurns((prev) => [...prev, assistantTurn]);
    } catch {
      setTurns((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content:
            "Network error reaching the AI service. Try again in a moment.",
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  const activeSupplier =
    suppliers.find((s) => s.id === supplier)?.name || "—";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <header className="bg-[var(--color-primary)] text-white">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 grid place-items-center bg-[var(--color-accent)] text-[var(--color-ink)] mono text-[11px] font-semibold rounded-sm">
              N
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-semibold tracking-[-0.01em]">
                NexTrade AI
              </span>
              <span className="mono text-[10px] uppercase opacity-75 tracking-wide">
                Reporting&nbsp;Assistant
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-[11px] uppercase mono opacity-75 tracking-wide">
              Logged in as
            </label>
            <div className="relative">
              <select
                className={cn(
                  "appearance-none bg-white/10 hover:bg-white/15 transition border border-white/20 rounded-sm pl-3 pr-8 py-1.5 text-[13px] font-medium",
                  "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/60"
                )}
                value={supplier}
                onChange={(e) => switchSupplier(e.target.value)}
                disabled={switching || loading}
              >
                {suppliers.map((s) => (
                  <option
                    key={s.id}
                    value={s.id}
                    className="text-[var(--color-ink)]"
                  >
                    {s.name}
                  </option>
                ))}
              </select>
              <svg
                className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
              >
                <path
                  d="M1 3l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </header>

      {/* Chat scroll area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={{ scrollBehavior: "smooth" }}
      >
        <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-5">
          {turns.length === 0 && <EmptyState onPick={(s) => send(s)} supplier={activeSupplier} />}
          {turns.map((turn) => (
            <MessageBubble key={turn.id} turn={turn} />
          ))}
          {loading && <LoadingBubble />}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t hairline bg-white">
        <div className="max-w-3xl mx-auto px-4 py-3">
          {turns.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {SUGGESTIONS.slice(0, 3).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-[11px] text-[var(--color-muted)] bg-[var(--color-primary-50)] hover:bg-[var(--color-primary)]/10 border hairline rounded-sm px-2.5 py-1 transition"
                  disabled={loading}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1 card rounded-[4px] focus-within:border-[var(--color-primary)]/40 transition">
              <textarea
                ref={inputRef}
                className="w-full bg-transparent resize-none px-3.5 py-3 text-[14px] leading-[1.5] placeholder:text-[var(--color-muted)]/70 focus:outline-none"
                placeholder="Ask NexTrade AI anything about your shipments, vendors, or orders"
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 140) + "px";
                }}
                onKeyDown={handleKey}
                disabled={loading || switching}
                autoFocus
              />
              <div className="flex items-center justify-between px-3.5 pb-2">
                <span className="mono text-[10px] text-[var(--color-muted)]/70 uppercase tracking-wide">
                  Enter to send · Shift + Enter for newline
                </span>
                <span className="mono text-[10px] text-[var(--color-accent)] uppercase tracking-wide flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
                  AI ready
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              className={cn(
                "h-[44px] w-[44px] grid place-items-center rounded-sm transition",
                "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-600)]",
                "disabled:bg-[var(--color-muted)]/30 disabled:cursor-not-allowed"
              )}
              aria-label="Send"
            >
              <ArrowUp size={18} strokeWidth={2.25} />
            </button>
          </div>
          <p className="mono text-[10px] text-[var(--color-muted)]/70 mt-2 uppercase tracking-wide">
            Your data is isolated — AI only sees orders for{" "}
            <span className="text-[var(--color-ink)]">{activeSupplier}</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  onPick,
  supplier,
}: {
  onPick: (s: string) => void;
  supplier: string;
}) {
  return (
    <div className="flex flex-col items-start gap-5 pt-8">
      <div className="flex items-center gap-2 mono text-[11px] text-[var(--color-muted)] uppercase tracking-wide">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
        NexTrade AI · Online
      </div>
      <h1 className="text-[44px] leading-[1.02] heading-xtight font-semibold">
        Ask anything about your sales,
        <br />
        <span className="text-[var(--color-primary)]">logged in as {supplier}</span>.
      </h1>
      <p className="text-[15px] text-[var(--color-muted)] max-w-[560px] leading-[1.55]">
        Natural-language reporting, plugged straight into your vendor data.
        Charts drop into the chat. Numbers never cross vendors.
      </p>
      <div className="grid sm:grid-cols-2 gap-2 w-full max-w-[640px]">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="group card px-3.5 py-3 text-left hover:border-[var(--color-primary)]/40 transition flex items-start gap-2.5"
          >
            <Lightbulb
              size={14}
              className="mt-0.5 text-[var(--color-primary)] flex-shrink-0"
            />
            <span className="text-[13px] text-[var(--color-ink)] leading-snug group-hover:text-[var(--color-primary)] transition">
              {s}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ turn }: { turn: ChatTurn }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-[var(--color-primary)] text-white rounded-sm px-3.5 py-2.5 max-w-[75%] text-[14px] leading-[1.5] shadow-sm">
          {turn.content}
        </div>
      </div>
    );
  }

  const reply = turn.reply;
  return (
    <div className="flex justify-start">
      <div className="card ai-accent max-w-[92%] w-full px-5 py-4 text-[14px] leading-[1.55]">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
          <span className="mono text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            NexTrade AI
          </span>
        </div>

        {reply?.unsupported ? (
          <UnsupportedView text={turn.content} unsupported={reply.unsupported} />
        ) : (
          <>
            <p className="text-[var(--color-ink)]">{turn.content}</p>
            {reply?.chart && (
              <>
                <div className="mono text-[10px] uppercase tracking-wide text-[var(--color-muted)] mt-4 pb-1 border-b hairline">
                  {reply.chart.title}
                </div>
                <ChartView spec={reply.chart} />
              </>
            )}
            {reply?.highlights && reply.highlights.length > 0 && (
              <HighlightsStrip highlights={reply.highlights} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function UnsupportedView({
  text,
  unsupported,
}: {
  text: string;
  unsupported: NonNullable<AssistantReply["unsupported"]>;
}) {
  return (
    <div>
      <p className="text-[var(--color-ink)] mb-3">{text}</p>
      <div className="border-l-2 border-[var(--color-muted)]/30 pl-3 py-1 mb-3 flex items-start gap-2">
        <Info
          size={14}
          className="mt-0.5 flex-shrink-0 text-[var(--color-muted)]"
        />
        <p className="text-[13px] text-[var(--color-muted)] leading-[1.55]">
          {unsupported.reason}
        </p>
      </div>
      <p className="mono text-[10px] uppercase tracking-wide text-[var(--color-muted)] mb-1.5">
        Try instead
      </p>
      <div className="flex flex-col gap-1.5">
        {unsupported.suggestions.map((s) => (
          <div
            key={s}
            className="text-[13px] text-[var(--color-primary)] hover:underline cursor-default"
          >
            → {s}
          </div>
        ))}
      </div>
    </div>
  );
}

function HighlightsStrip({ highlights }: { highlights: Highlight[] }) {
  return (
    <div className="mt-3 pt-3 border-t hairline grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
      {highlights.map((h, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <span className="mono text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            {h.label}
          </span>
          <span className="text-[13px] font-medium text-[var(--color-ink)] truncate">
            {h.value}
          </span>
          {h.sub && (
            <span className="mono text-[11px] text-[var(--color-muted)]">
              {h.sub}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function LoadingBubble() {
  return (
    <div className="flex justify-start">
      <div className="card ai-accent px-5 py-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
          <span className="mono text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            NexTrade AI
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="lime-pulse">
            <span />
            <span />
            <span />
          </div>
          <span className="mono text-[11px] text-[var(--color-muted)]">
            Analysing your data
          </span>
        </div>
      </div>
    </div>
  );
}
