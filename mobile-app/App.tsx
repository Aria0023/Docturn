import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { ApiClient, type MobileUser } from "./src/api";
import { realtime } from "./src/realtime";
import { LoginScreen } from "./src/screens/LoginScreen";
import { AssignmentsScreen } from "./src/screens/AssignmentsScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";

const Tab = createBottomTabNavigator();

export default function App() {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ApiClient.me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    realtime.connect();
    return () => realtime.close();
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
        <LoginScreen onLoggedIn={setUser} />
      </>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Tab.Navigator
        screenOptions={{ tabBarActiveTintColor: "#2563EB", headerShown: true }}
      >
        <Tab.Screen name="Assignments">
          {() => <AssignmentsScreen />}
        </Tab.Screen>
        <Tab.Screen name="Profile">
          {() => <ProfileScreen user={user} onLogout={() => setUser(null)} />}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
