import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { ApiClient, type MobileUser } from "./src/api";
import { realtime } from "./src/realtime";
import { LoginScreen } from "./src/screens/LoginScreen";
import { AssignmentsScreen } from "./src/screens/AssignmentsScreen";
import { MessagesScreen } from "./src/screens/MessagesScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";

const Tab = createBottomTabNavigator();

// Test-only marker (mirrors the web banner). Defaults on until the server is
// deliberately started with SYNTHETIC_DATA=false.
function SyntheticBanner() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    ApiClient.config()
      .then((c) => setOn(c.syntheticData !== false))
      .catch(() => setOn(true));
  }, []);
  if (!on) return null;
  return (
    <View style={{ backgroundColor: "#FDE68A", paddingTop: 44, paddingBottom: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "#F59E0B" }}>
      <Text style={{ color: "#7C2D12", fontWeight: "700", fontSize: 12, textAlign: "center" }}>
        SYNTHETIC DATA — testing only. Do not enter real patient info (PHI).
      </Text>
    </View>
  );
}

export default function App() {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    ApiClient.me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Register for Expo push after sign-in: content-free wake-ups only (the
  // server never puts message text or patient data in a push payload).
  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== "granted") return;
        const token = (await Notifications.getExpoPushTokenAsync()).data;
        await ApiClient.registerDeviceToken(token, "expo");
      } catch {
        /* push is best-effort; app works without it */
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    realtime.connect();
    const refreshUnread = () =>
      ApiClient.conversations()
        .then((cs) => setUnread(cs.reduce((n, c) => n + (c.unreadCount || 0), 0)))
        .catch(() => {});
    void refreshUnread();
    const off = realtime.subscribe((m) => {
      if (m.type === "MESSAGE_RECEIVED") void refreshUnread();
    });
    const timer = setInterval(refreshUnread, 20000);
    return () => {
      off();
      clearInterval(timer);
      realtime.close();
    };
  }, [user]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!user) {
    return (
      <>
        <StatusBar style="dark" />
        <SyntheticBanner />
        <LoginScreen onLoggedIn={setUser} />
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <SyntheticBanner />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{ tabBarActiveTintColor: "#2563EB", headerShown: true }}
        >
          <Tab.Screen name="Messages" options={{ tabBarBadge: unread || undefined }}>
            {() => <MessagesScreen user={user} />}
          </Tab.Screen>
          <Tab.Screen name="Assignments">
            {() => <AssignmentsScreen />}
          </Tab.Screen>
          <Tab.Screen name="Profile">
            {() => <ProfileScreen user={user} onLogout={() => setUser(null)} />}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
    </View>
  );
}
