import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  ApiClient,
  type MobileConversation,
  type MobileMessage,
  type MobileProvider,
  type MobileUser,
} from "../api";
import { realtime } from "../realtime";

const PRIMARY = "#2563EB";
const BORDER = "#E2E8F0";
const MUTED = "#64748B";

function hhmm(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

function initials(name: string): string {
  return name
    .replace(/\(root\)/i, "")
    .replace(/^Dr\.?\s*/i, "")
    .trim()
    .split(/[\s,]+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Secure messaging: conversation list → thread → new. One pane at a time (phone).
// Same backend as the web app, so web and mobile message each other live.
export function MessagesScreen({ user }: { user: MobileUser }) {
  const [convos, setConvos] = useState<MobileConversation[]>([]);
  const [providers, setProviders] = useState<MobileProvider[]>([]);
  const [view, setView] = useState<"list" | "thread" | "new">("list");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<MobileMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<MobileMessage>>(null);
  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeId;

  const nameFor = useCallback(
    (uid: number) =>
      uid === user.id
        ? "You"
        : providers.find((p) => p.userId === uid)?.displayName ?? `User ${uid}`,
    [providers, user.id],
  );

  const titleFor = useCallback(
    (c: MobileConversation) =>
      c.name ??
      (c.participantIds
        .filter((id) => id !== user.id)
        .map(nameFor)
        .join(", ") ||
        "Conversation"),
    [nameFor, user.id],
  );

  const loadConvos = useCallback(async () => {
    try {
      setConvos(await ApiClient.conversations());
    } catch {
      /* ignore */
    }
  }, []);

  const loadThread = useCallback(async (id: number) => {
    try {
      const msgs = await ApiClient.messages(id);
      setMessages(msgs);
      const unreadFromOthers = msgs
        .filter((m) => m.senderId !== user.id)
        .map((m) => m.id);
      await ApiClient.markRead(unreadFromOthers);
    } catch {
      /* ignore */
    }
  }, [user.id]);

  // Initial load + realtime: refresh the open thread and the unread badges.
  useEffect(() => {
    void loadConvos();
    ApiClient.directory().then(setProviders).catch(() => {});
    return realtime.subscribe((msg) => {
      if (msg.type === "MESSAGE_RECEIVED") {
        const openId = activeIdRef.current;
        if (msg.message && openId && msg.message.conversationId === openId) {
          void loadThread(openId);
        }
        void loadConvos();
      }
    });
  }, [loadConvos, loadThread]);

  async function openThread(id: number) {
    setActiveId(id);
    setView("thread");
    setMessages([]);
    await loadThread(id);
    void loadConvos();
  }

  async function send() {
    const text = draft.trim();
    if (!text || activeId == null || sending) return;
    setSending(true);
    setDraft("");
    try {
      const m = await ApiClient.sendMessage(activeId, text);
      setMessages((prev) => [...prev, m]);
      void loadConvos();
    } catch {
      setDraft(text); // restore on failure
    } finally {
      setSending(false);
    }
  }

  // Start (or reopen) a direct conversation with a colleague.
  async function startWith(p: MobileProvider) {
    const existing = convos.find(
      (c) =>
        c.type === "direct" &&
        c.participantIds.length === 2 &&
        c.participantIds.includes(p.userId) &&
        c.participantIds.includes(user.id),
    );
    if (existing) {
      await openThread(existing.id);
      return;
    }
    try {
      const c = await ApiClient.createConversation([p.userId]);
      await loadConvos();
      await openThread(c.id);
    } catch {
      /* ignore */
    }
  }

  // ---- New-conversation picker ----
  if (view === "new") {
    const pick = providers.filter(
      (p) =>
        p.userId !== user.id &&
        (!query ||
          p.displayName.toLowerCase().includes(query.toLowerCase()) ||
          (p.specialty ?? "").toLowerCase().includes(query.toLowerCase())),
    );
    return (
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        <Header title="New message" onBack={() => { setView("list"); setQuery(""); }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search colleagues by name or specialty…"
          placeholderTextColor={MUTED}
          style={inputStyle}
        />
        <FlatList
          data={pick}
          keyExtractor={(p) => String(p.userId)}
          ListEmptyComponent={<Empty text="No colleagues found." />}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => startWith(item)} style={rowStyle}>
              <Avatar text={initials(item.displayName)} online={item.working} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "600", fontSize: 15 }}>{item.displayName}</Text>
                <Text style={{ color: MUTED, fontSize: 13 }}>
                  {item.specialty ?? "Provider"}
                  {item.working ? " · on shift" : ""}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      </View>
    );
  }

  // ---- Thread ----
  if (view === "thread" && activeId != null) {
    const c = convos.find((x) => x.id === activeId);
    const isGroup = (c?.participantIds.length ?? 0) > 2;
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: "#fff" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Header title={c ? titleFor(c) : "Conversation"} onBack={() => setView("list")} />
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: 14, gap: 8 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Empty text="No messages yet. Say hello." />}
          renderItem={({ item }) => {
            const mine = item.senderId === user.id;
            return (
              <View style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
                {isGroup && !mine && (
                  <Text style={{ fontSize: 11, color: MUTED, marginBottom: 2, marginLeft: 6 }}>
                    {nameFor(item.senderId)}
                  </Text>
                )}
                <View
                  style={{
                    maxWidth: "82%",
                    backgroundColor: mine ? PRIMARY : "#F1F5F9",
                    borderRadius: 14,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                  }}
                >
                  <Text style={{ color: mine ? "#fff" : "#0F172A", fontSize: 15 }}>
                    {item.deletedAt ? "(message deleted)" : item.content}
                  </Text>
                </View>
                <Text style={{ fontSize: 10.5, color: MUTED, marginTop: 2, marginHorizontal: 4 }}>
                  {hhmm(item.createdAt)}
                  {mine ? " · Sent" : ""}
                </Text>
              </View>
            );
          }}
        />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: BORDER }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a secure message…"
            placeholderTextColor={MUTED}
            multiline
            style={{ flex: 1, maxHeight: 110, minHeight: 40, borderWidth: 1, borderColor: BORDER, borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, fontSize: 15 }}
          />
          <TouchableOpacity
            onPress={send}
            disabled={!draft.trim() || sending}
            style={{ backgroundColor: draft.trim() ? PRIMARY : "#93C5FD", width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }}
          >
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>➤</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ---- Conversation list ----
  const shown = convos.filter(
    (c) => !query || titleFor(c).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: BORDER }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search conversations…"
          placeholderTextColor={MUTED}
          style={{ flex: 1, height: 40, borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 }}
        />
        <TouchableOpacity onPress={() => setView("new")} style={{ backgroundColor: PRIMARY, height: 40, paddingHorizontal: 14, borderRadius: 10, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "700" }}>New</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(c) => String(c.id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await loadConvos(); setRefreshing(false); }}
          />
        }
        ListEmptyComponent={<Empty text="No conversations yet. Tap “New” to message a colleague." />}
        renderItem={({ item }) => {
          const title = titleFor(item);
          const last = item.lastMessage;
          const mineLast = last?.senderId === user.id;
          return (
            <TouchableOpacity onPress={() => openThread(item.id)} style={rowStyle}>
              <Avatar text={item.participantIds.length > 2 ? "👥" : initials(title)} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontWeight: "700", fontSize: 15 }} numberOfLines={1}>{title}</Text>
                  {last && <Text style={{ color: MUTED, fontSize: 11 }}>{hhmm(last.createdAt)}</Text>}
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
                  <Text style={{ color: MUTED, fontSize: 13, flex: 1 }} numberOfLines={1}>
                    {last ? (mineLast ? "You: " : "") + (last.deletedAt ? "(deleted)" : last.content) : "No messages yet"}
                  </Text>
                  {item.unreadCount > 0 && (
                    <View style={{ backgroundColor: PRIMARY, borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", marginLeft: 8 }}>
                      <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{item.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER }}>
      <TouchableOpacity onPress={onBack} style={{ paddingRight: 6 }}>
        <Text style={{ color: PRIMARY, fontSize: 16, fontWeight: "600" }}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={{ fontWeight: "700", fontSize: 16, flex: 1 }} numberOfLines={1}>{title}</Text>
    </View>
  );
}

function Avatar({ text, online }: { text: string; online?: boolean }) {
  return (
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: PRIMARY, fontWeight: "700" }}>{text}</Text>
      {online && <View style={{ position: "absolute", right: 0, bottom: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: "#10B981", borderWidth: 2, borderColor: "#fff" }} />}
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={{ padding: 24, color: MUTED, textAlign: "center" }}>{text}</Text>;
}

const rowStyle = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 12,
  paddingHorizontal: 14,
  paddingVertical: 12,
  borderBottomWidth: 1,
  borderBottomColor: BORDER,
};

const inputStyle = {
  margin: 12,
  height: 40,
  borderWidth: 1,
  borderColor: BORDER,
  borderRadius: 10,
  paddingHorizontal: 12,
  fontSize: 15,
};
