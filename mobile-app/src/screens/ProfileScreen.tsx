import { useEffect } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { ApiClient, type MobileUser } from "../api";

export function ProfileScreen({
  user,
  onLogout,
}: {
  user: MobileUser;
  onLogout: () => void;
}) {
  // Register a (stub) FCM/APNs device token so out-of-app pushes can land.
  useEffect(() => {
    const token = `expo-${user.id}-${Date.now()}`;
    ApiClient.registerDeviceToken(token, "ios").catch(() => {});
  }, [user.id]);

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>{user.displayName}</Text>
      <Text style={{ color: "#64748B", textTransform: "capitalize" }}>
        {user.role.replace("_", " ")}
      </Text>
      <TouchableOpacity
        onPress={async () => {
          await ApiClient.logout().catch(() => {});
          onLogout();
        }}
        style={{
          marginTop: 24,
          padding: 14,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: "#E2E8F0",
          alignItems: "center",
        }}
      >
        <Text style={{ fontWeight: "600" }}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}
