import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Shown in place of the page when the WebView could not load DocTurn (no
 * network, DNS, TLS, server down). It says nothing about data: once the page
 * loads, the web app's own offline rules apply (docs/MOBILE.md).
 */
export function OfflinePage({ onRetry, detail, dark }: { onRetry: () => void; detail?: string; dark: boolean }) {
  const fg = dark ? "#F8FAFC" : "#0F172A";
  const sub = dark ? "#CBD5E1" : "#475569";
  return (
    <View style={[styles.wrap, { backgroundColor: dark ? "#0F172A" : "#FFFFFF" }]} accessibilityRole="alert">
      <Text style={[styles.title, { color: fg }]}>Can’t reach DocTurn</Text>
      <Text style={[styles.sub, { color: sub }]}>Check your connection and try again. The app retries by itself when it comes back to the front.</Text>
      {detail ? <Text style={[styles.detail, { color: sub }]}>{detail}</Text> : null}
      <Pressable onPress={onRetry} accessibilityRole="button" style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 28 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  sub: { fontSize: 15, lineHeight: 21, textAlign: "center", maxWidth: 360 },
  detail: { fontSize: 12, marginTop: 10, textAlign: "center" },
  button: { marginTop: 22, minHeight: 48, minWidth: 160, paddingHorizontal: 22, borderRadius: 10, backgroundColor: "#2563EB", alignItems: "center", justifyContent: "center" },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});
