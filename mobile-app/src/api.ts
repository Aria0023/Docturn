import Constants from "expo-constants";

/**
 * Typed API client shared across the mobile app. Mirrors the web client's
 * fetch wrapper but keeps the session cookie manually (React Native doesn't
 * persist cookies the way a browser does), so we capture and resend it.
 */
const BASE: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string) ?? "http://localhost:3000";

let sessionCookie: string | null = null;

export interface MobileUser {
  id: number;
  username: string;
  role: string;
  displayName: string;
  organizationId: number;
}

export interface MobileAssignment {
  id: number;
  initials: string;
  room: string | null;
  specialty: string | null;
  expiresAt: string;
}

export interface MobileMessage {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  createdAt: string;
  deletedAt?: string | null;
}

export interface MobileConversation {
  id: number;
  type: "direct" | "group" | "broadcast";
  name: string | null;
  participantIds: number[];
  lastMessage: MobileMessage | null;
  unreadCount: number;
}

export interface MobileProvider {
  id: number;
  userId: number;
  displayName: string;
  credential: string | null;
  specialty: string | null;
  working: boolean;
  shiftType: string | null;
}

export interface AppConfig {
  syntheticData: boolean;
  appName: string;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) sessionCookie = setCookie.split(";")[0]!;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(data?.error ?? res.statusText);
  return data as T;
}

export const ApiClient = {
  baseUrl: BASE,
  sessionCookie: () => sessionCookie,
  login: (orgCode: string, username: string, password: string) =>
    request<MobileUser>("POST", "/api/login", { orgCode, username, password }),
  me: () => request<MobileUser>("GET", "/api/user"),
  logout: () => request<void>("POST", "/api/logout"),
  orgByCode: (code: string) =>
    request<{ id: number; name: string; code: string; timezone: string }>(
      "GET",
      `/api/mobile/org/${code}`,
    ),
  assignments: () => request<MobileAssignment[]>("GET", "/api/mobile/assignments"),
  accept: (id: number) => request("PATCH", `/api/assignments/${id}/accept`),
  reject: (id: number) => request("PATCH", `/api/assignments/${id}/reject`),
  registerDeviceToken: (token: string, platform: string) =>
    request("POST", "/api/mobile/device-tokens", { token, platform }),

  // Public config (synthetic-data banner). No auth.
  config: () => request<AppConfig>("GET", "/api/config"),

  // Secure messaging — same endpoints the web app uses, so web and mobile
  // interoperate on one backend.
  conversations: () =>
    request<MobileConversation[]>("GET", "/api/messaging/conversations"),
  messages: (conversationId: number) =>
    request<MobileMessage[]>(
      "GET",
      `/api/messaging/conversations/${conversationId}/messages`,
    ),
  sendMessage: (conversationId: number, content: string) =>
    request<MobileMessage>("POST", "/api/messaging/send", {
      conversationId,
      content,
    }),
  markRead: (messageIds: number[]) =>
    messageIds.length
      ? request<void>("POST", "/api/messaging/messages/mark-read", { messageIds })
      : Promise.resolve(),
  createConversation: (
    participantIds: number[],
    type: "direct" | "group" = "direct",
    name?: string,
  ) =>
    request<MobileConversation>("POST", "/api/messaging/conversations", {
      participantIds,
      type,
      ...(name ? { name } : {}),
    }),
  directory: () =>
    request<MobileProvider[]>("GET", "/api/physicians/directory"),
};
