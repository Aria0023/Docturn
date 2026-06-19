import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Conversation, DirectoryEntry, Message } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Input,
} from "@/components/ui";
import { cn } from "@/lib/cn";

export function Messaging() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ["/api/messaging/conversations"],
  });
  const { data: directory = [] } = useQuery<DirectoryEntry[]>({
    queryKey: ["/api/physicians/directory"],
  });
  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: [`/api/messaging/conversations/${activeId}/messages`],
    enabled: activeId != null,
  });

  const nameFor = (c: Conversation) => {
    if (c.name) return c.name;
    const others = c.participantIds.filter((id) => id !== user?.id);
    const entry = directory.find((d) => d.userId === others[0]);
    return entry?.displayName ?? `Conversation #${c.id}`;
  };

  const send = useMutation({
    mutationFn: () =>
      api.post("/api/messaging/send", {
        conversationId: activeId,
        content: draft,
      }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({
        queryKey: [`/api/messaging/conversations/${activeId}/messages`],
      });
      qc.invalidateQueries({ queryKey: ["/api/messaging/conversations"] });
    },
  });

  const startWith = useMutation({
    mutationFn: (userId: number) =>
      api.post<Conversation>("/api/messaging/conversations", {
        type: "direct",
        participantIds: [userId],
      }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["/api/messaging/conversations"] });
      setActiveId(c.id);
    },
  });

  // Mark unread as read when a conversation opens.
  useEffect(() => {
    if (activeId == null) return;
    const ids = messages
      .filter((m) => m.senderId !== user?.id)
      .map((m) => m.id);
    if (ids.length) {
      api
        .post("/api/messaging/messages/mark-read", { messageIds: ids })
        .then(() =>
          qc.invalidateQueries({ queryKey: ["/api/messaging/conversations"] }),
        )
        .catch(() => {});
    }
  }, [activeId, messages, user?.id, qc]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const peers = directory.filter((d) => d.userId !== user?.id);

  return (
    <div className="space-y-4" style={{ padding: 28, maxWidth: 1040, margin: "0 auto" }}>
      <h1 className="text-2xl font-bold">Messages</h1>
      <Card className="flex h-[70vh] overflow-hidden">
        {/* Conversation list */}
        <div className="flex w-72 flex-col border-r border-border">
          <div className="border-b border-border p-3">
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value=""
              onChange={(e) =>
                e.target.value && startWith.mutate(Number(e.target.value))
              }
            >
              <option value="">+ New direct message…</option>
              {peers.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 overflow-auto">
            {conversations.length === 0 ? (
              <EmptyState message="No conversations." />
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left hover:bg-muted",
                    activeId === c.id && "bg-muted",
                  )}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-bold">
                    {nameFor(c)
                      .split(" ")
                      .map((p) => p[0])
                      .slice(-2)
                      .join("")}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <div className="truncate text-sm font-semibold">
                      {nameFor(c)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {c.lastMessage?.content ?? "No messages yet"}
                    </div>
                  </div>
                  {c.unreadCount > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                      {c.unreadCount}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread */}
        <div className="flex flex-1 flex-col">
          {activeId == null ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a conversation
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 space-y-2 overflow-auto p-4">
                {messages.map((m) => {
                  const me = m.senderId === user?.id;
                  return (
                    <div
                      key={m.id}
                      className={cn("flex", me ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[70%] rounded-lg px-3 py-2 text-sm",
                          me
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-foreground",
                        )}
                      >
                        {m.content}
                      </div>
                    </div>
                  );
                })}
              </div>
              <form
                className="flex gap-2 border-t border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft.trim()) send.mutate();
                }}
              >
                <Input
                  placeholder="Type a message…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <Button type="submit" disabled={!draft.trim()}>
                  <Send size={16} />
                </Button>
              </form>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
