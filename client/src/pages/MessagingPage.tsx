import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Conversation, Message, User } from '@/lib/types';
import { userQueryKey } from '@/hooks/useAuth';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';

function conversationLabel(c: Conversation): string {
  if (c.title) return c.title;
  return c.type === 'direct' ? 'Direct message' : `${c.type} conversation`;
}

export function MessagingPage() {
  const qc = useQueryClient();
  const me = qc.getQueryData<User>(userQueryKey);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get<Conversation[]>('/api/conversations'),
  });

  useEffect(() => {
    if (selectedId === null && conversationsQuery.data && conversationsQuery.data.length > 0) {
      setSelectedId(conversationsQuery.data[0].id);
    }
  }, [conversationsQuery.data, selectedId]);

  const messagesQuery = useQuery({
    queryKey: ['messages', selectedId],
    queryFn: () => api.get<Message[]>(`/api/conversations/${selectedId}/messages`),
    enabled: selectedId !== null,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => api.post(`/api/conversations/${id}/mark-read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });

  useEffect(() => {
    if (selectedId !== null) {
      markRead.mutate(selectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messagesQuery.data]);

  const sendMessage = useMutation({
    mutationFn: (body: string) =>
      api.post<Message>(`/api/conversations/${selectedId}/messages`, { body }),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['messages', selectedId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.trim() && selectedId !== null) sendMessage.mutate(draft.trim());
  };

  const conversations = conversationsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Messaging</h1>

      <div className="grid h-[calc(100vh-12rem)] grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
        <Card className="flex flex-col overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
            Conversations
          </div>
          <div className="flex-1 overflow-auto">
            {conversationsQuery.isLoading && (
              <p className="p-4 text-sm text-slate-500">Loading…</p>
            )}
            {!conversationsQuery.isLoading && conversations.length === 0 && (
              <p className="p-4 text-sm text-slate-500">No conversations.</p>
            )}
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-left text-sm transition-colors',
                  selectedId === c.id ? 'bg-blue-50' : 'hover:bg-slate-50',
                )}
              >
                <span className="truncate font-medium text-slate-800">
                  {conversationLabel(c)}
                </span>
                {c.type === 'emergency' && <Badge tone="rejected">urgent</Badge>}
              </button>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col overflow-hidden">
          {selectedId === null ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
              Select a conversation to start.
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto p-4">
                {messagesQuery.isLoading && (
                  <p className="text-sm text-slate-500">Loading messages…</p>
                )}
                {messagesQuery.data?.length === 0 && (
                  <p className="text-sm text-slate-500">No messages yet.</p>
                )}
                {messagesQuery.data?.map((m) => {
                  const mine = me?.id === m.senderId;
                  return (
                    <div
                      key={m.id}
                      className={cn('flex', mine ? 'justify-end' : 'justify-start')}
                    >
                      <div
                        className={cn(
                          'max-w-[70%] rounded-lg px-3 py-2 text-sm',
                          mine
                            ? 'bg-[#2563EB] text-white'
                            : 'bg-slate-100 text-slate-800',
                        )}
                      >
                        {m.deleted ? (
                          <span className="italic opacity-70">Message deleted</span>
                        ) : (
                          m.body
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <form
                onSubmit={handleSend}
                className="flex items-center gap-2 border-t border-slate-200 p-3"
              >
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type a message…"
                />
                <Button type="submit" size="icon" disabled={sendMessage.isPending || !draft.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
