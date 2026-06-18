import { useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import { ApiClient, type MobileUser } from "../api";

// QR org onboarding: a scanned QR encodes the org code, which we resolve via the
// public /api/mobile/org/:code endpoint before login. Here we accept it typed.
export function LoginScreen({ onLoggedIn }: { onLoggedIn: (u: MobileUser) => void }) {
  const [orgCode, setOrgCode] = useState("MERCY");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const user = await ApiClient.login(orgCode, username, password);
      onLoggedIn(user);
    } catch {
      setError("Invalid credentials");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 28, fontWeight: "700", color: "#2563EB" }}>
        DocTurn
      </Text>
      <Field label="Organization code" value={orgCode} onChange={setOrgCode} />
      <Field label="Username" value={username} onChange={setUsername} />
      <Field label="Password" value={password} onChange={setPassword} secure />
      {error && <Text style={{ color: "#DC2626" }}>{error}</Text>}
      <TouchableOpacity
        onPress={submit}
        disabled={busy}
        style={{
          backgroundColor: "#2563EB",
          padding: 14,
          borderRadius: 8,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "white", fontWeight: "600" }}>
          {busy ? "Signing in…" : "Sign in"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  secure,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
}) {
  return (
    <View>
      <Text style={{ marginBottom: 4, fontWeight: "500" }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        autoCapitalize="none"
        style={{
          borderWidth: 1,
          borderColor: "#E2E8F0",
          borderRadius: 6,
          padding: 10,
        }}
      />
    </View>
  );
}
