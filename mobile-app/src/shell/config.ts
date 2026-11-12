import Constants from "expo-constants";
import { Platform } from "react-native";
import { hostOf } from "./links";

/**
 * Build-time configuration, baked by app.config.ts into the app manifest:
 *   extra.apiBaseUrl      — the DocTurn host the WebView loads (EAS env
 *                           EXPO_PUBLIC_API_BASE_URL per build profile)
 *   extra.eas.projectId   — the EAS project (EAS_PROJECT_ID), required for an
 *                           Expo push token
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string; eas?: { projectId?: string } };

export const BRAND_COLOR = "#2563EB";
export const API_BASE_URL = String(extra.apiBaseUrl || "https://docturn.onrender.com").replace(/\/+$/, "");
export const API_HOST = hostOf(API_BASE_URL);
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";
export const PLATFORM: "ios" | "android" = Platform.OS === "android" ? "android" : "ios";
/** Appended to the WebView's user agent; webapp/api-bridge.js reads it (DT.shell). */
export const USER_AGENT_SUFFIX = `DocTurnShell/${APP_VERSION}`;
export const EAS_PROJECT_ID: string | null = extra.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
/**
 * iOS app-bound domains (lets the page's service worker run in WKWebView)
 * exist only for an HTTPS host — app.config.ts emits WKAppBoundDomains under
 * the same condition, and a WebView limited to app-bound domains with none
 * declared could not navigate anywhere (a development build on http://).
 */
export const APP_BOUND_DOMAINS = API_BASE_URL.startsWith("https://");
