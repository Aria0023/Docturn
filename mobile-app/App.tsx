import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, BackHandler, Linking, Platform, StyleSheet, View, useColorScheme } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { WebView } from "react-native-webview";
import type { ShouldStartLoadRequest, WebViewErrorEvent, WebViewMessageEvent, WebViewNavigation } from "react-native-webview/lib/WebViewTypes";
import { callShellScript, flagScript, parseShellMessage } from "./src/shell/bridge";
import { API_BASE_URL, API_HOST, APP_VERSION, BRAND_COLOR, PLATFORM, USER_AGENT_SUFFIX } from "./src/shell/config";
import { linkTarget, pushTarget, sameHost, startUrl, type OpenTarget } from "./src/shell/links";
import { OfflinePage } from "./src/shell/OfflinePage";
import { clearDelivered, ensureChannels, getPermission, getToken, installForegroundHandler, requestPermission, responseTitle } from "./src/shell/push";
import { isLight, parseColor, toHex } from "./src/shell/theme";

/**
 * DocTurn native shell: one WebView on the configured DocTurn host. The web
 * app is the product (docs/MOBILE.md); the shell adds what a web page cannot:
 * APNs/FCM push through Expo, universal / app links, the store presence,
 * camera + microphone grants for the page, and the device's back button,
 * safe areas and status bar. Nothing clinical lives here and nothing is
 * stored here: no PHI, no credentials — the page's own session cookie is the
 * only state, inside the WebView's cookie store.
 */

SplashScreen.preventAutoHideAsync().catch(() => {});
installForegroundHandler();

type WebViewHandle = { goBack(): void; reload(): void; injectJavaScript(script: string): void };

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const webview = useRef<WebViewHandle | null>(null);
  const [startUri, setStartUri] = useState<string | null>(null);
  const [theme, setTheme] = useState<{ bar: string; page: string }>({ bar: BRAND_COLOR, page: "#FFFFFF" });
  const [failed, setFailed] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const pageReady = useRef(false);
  const pushToken = useRef<string | null>(null);
  const pendingOpen = useRef<OpenTarget | null>(null);

  const inject = useCallback((script: string) => { webview.current?.injectJavaScript(script); }, []);

  // Hand the Expo token to the page (webapp/api-bridge.js registers it with
  // the signed-in account, now or at sign-in). Called at every page load when
  // the OS permission is already granted, and after the page reports a
  // session — the only moment the OS prompt is shown (never before sign-in).
  const ensurePush = useCallback(async (prompt: boolean) => {
    let perm = await getPermission();
    if (perm === "undetermined" && prompt) perm = await requestPermission();
    if (perm !== "granted") {
      if (perm === "denied") inject(callShellScript("pushStatus", "denied"));
      return perm;
    }
    const token = pushToken.current ?? (await getToken());
    if (!token) { inject(callShellScript("pushStatus", "unavailable")); return perm; }
    pushToken.current = token;
    if (pageReady.current) inject(callShellScript("pushToken", token));
    return perm;
  }, [inject]);

  const openTarget = useCallback((target: OpenTarget) => {
    if (pageReady.current) inject(callShellScript("open", target));
    else pendingOpen.current = target;
  }, [inject]);

  // Where to start: a universal link or a tapped notification that launched
  // the app, otherwise the app's root. Resolved once, then the WebView mounts.
  useEffect(() => {
    let alive = true;
    (async () => {
      let target: OpenTarget | null = null;
      try { const url = await Linking.getInitialURL(); if (url) target = linkTarget(url, API_HOST); } catch { /* none */ }
      if (!target) {
        try { target = pushTarget(responseTitle(await Notifications.getLastNotificationResponseAsync())); } catch { /* none */ }
      }
      await ensureChannels();
      if (alive) setStartUri(startUrl(API_BASE_URL, target));
    })();
    return () => { alive = false; };
  }, []);

  // Links and notification taps while the app is running.
  useEffect(() => {
    const link = Linking.addEventListener("url", ({ url }) => { const t = linkTarget(url, API_HOST); if (t) openTarget(t); });
    const tap = Notifications.addNotificationResponseReceivedListener((r) => { const t = pushTarget(responseTitle(r)); if (t) openTarget(t); });
    return () => { link.remove(); tap.remove(); };
  }, [openTarget]);

  // Android back: the page is one document, so this is the WebView's own
  // history (a link opened in-page); with nothing to go back to, the OS
  // backgrounds the app as usual.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack && webview.current) { webview.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  // Back in front after a failed load: retry on its own.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active" && failed) { setFailed(null); webview.current?.reload(); } });
    return () => sub.remove();
  }, [failed]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    const m = parseShellMessage(e.nativeEvent.data);
    if (!m) return;
    if (m.type === "dt-session") {
      if (m.state === "active") void ensurePush(true);
      else void clearDelivered();
    } else if (m.type === "dt-push") {
      void ensurePush(true).then((perm) => { if (perm === "denied") Linking.openSettings().catch(() => {}); });
    } else if (m.type === "dt-theme") {
      const bar = parseColor(m.color);
      const page = parseColor(m.background);
      setTheme((t) => ({ bar: bar ? toHex(bar) : t.bar, page: page ? toHex(page) : t.page }));
    }
  }, [ensurePush]);

  const onShouldStart = useCallback((req: ShouldStartLoadRequest) => {
    if (sameHost(req.url, API_HOST)) return true;
    if (/^(https?|mailto|tel|sms):/i.test(req.url)) Linking.openURL(req.url).catch(() => {});
    return false; // everything else leaves the shell: the system browser / dialer / mail
  }, []);

  const onLoadEnd = useCallback(() => {
    pageReady.current = true;
    SplashScreen.hideAsync().catch(() => {});
    if (pendingOpen.current) { const t = pendingOpen.current; pendingOpen.current = null; inject(callShellScript("open", t)); }
    void ensurePush(false);
  }, [ensurePush, inject]);

  const onError = useCallback((e: WebViewErrorEvent) => {
    pageReady.current = false;
    setFailed(e.nativeEvent.description || "network");
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const retry = useCallback(() => { setFailed(null); webview.current?.reload(); }, []);

  const barRgb = parseColor(theme.bar);
  const barStyle = barRgb && isLight(barRgb) ? "dark" : "light";
  const dark = scheme === "dark";

  return (
    <View style={[styles.root, { backgroundColor: theme.page }]}>
      <StatusBar style={barStyle} />
      <View style={{ height: insets.top, backgroundColor: theme.bar }} />
      <View style={[styles.page, { paddingLeft: insets.left, paddingRight: insets.right }]}>
        {startUri ? (
          <WebView
            ref={webview as never}
            source={{ uri: startUri }}
            style={[styles.web, { backgroundColor: theme.page }]}
            applicationNameForUserAgent={USER_AGENT_SUFFIX}
            injectedJavaScriptBeforeContentLoaded={flagScript(APP_VERSION, PLATFORM)}
            injectedJavaScriptForMainFrameOnly
            onMessage={onMessage}
            onShouldStartLoadWithRequest={onShouldStart}
            onNavigationStateChange={(nav: WebViewNavigation) => setCanGoBack(!!nav.canGoBack)}
            onLoadStart={() => { pageReady.current = false; }}
            onLoadEnd={onLoadEnd}
            onError={onError}
            onContentProcessDidTerminate={() => webview.current?.reload()}
            onRenderProcessGone={() => webview.current?.reload()}
            renderError={() => <OfflinePage onRetry={retry} dark={dark} />}
            // Media: voice messages and image capture inside the page.
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            mediaCapturePermissionGrantType="grant"
            allowsProtectedMedia={false}
            // The page's storage (lock flag, dismissed banners); the session
            // cookie lives in the WebView's own persistent cookie store.
            domStorageEnabled
            javaScriptEnabled
            cacheEnabled
            // One document, one host: no popups, no zoom chrome, no link previews.
            setSupportMultipleWindows={false}
            allowsLinkPreview={false}
            allowsBackForwardNavigationGestures={false}
            setBuiltInZoomControls={false}
            textZoom={100}
            bounces={false}
            overScrollMode="never"
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            pullToRefreshEnabled // iOS only (react-native-webview); Android relies on the error page's Try again
            // Lets the page's service worker run inside WKWebView (iOS requires
            // app-bound domains for it); WKAppBoundDomains is set in app.config.ts.
            limitsNavigationsToAppBoundDomains
            startInLoadingState={false}
            webviewDebuggingEnabled={__DEV__}
          />
        ) : null}
        {failed && !startUri ? <OfflinePage onRetry={retry} dark={dark} /> : null}
      </View>
      <View style={{ height: insets.bottom, backgroundColor: theme.page }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { flex: 1 },
  web: { flex: 1 },
});
