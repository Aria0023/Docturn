import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from "react-native";
import { ApiClient, type MobileAssignment } from "../api";
import { realtime } from "../realtime";

// Pending queue with realtime updates: ASSIGNMENT_CREATED/UPDATED refetch.
export function AssignmentsScreen() {
  const [items, setItems] = useState<MobileAssignment[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await ApiClient.assignments());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    return realtime.subscribe((msg) => {
      if (
        msg.type === "ASSIGNMENT_CREATED" ||
        msg.type === "ASSIGNMENT_UPDATED"
      ) {
        void load();
      }
    });
  }, [load]);

  async function respond(id: number, action: "accept" | "reject") {
    if (action === "accept") await ApiClient.accept(id);
    else await ApiClient.reject(id);
    void load();
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(a) => String(a.id)}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListEmptyComponent={
        <Text style={{ padding: 24, color: "#64748B" }}>
          No pending requests.
        </Text>
      }
      renderItem={({ item }) => (
        <View
          style={{
            padding: 16,
            borderBottomWidth: 1,
            borderBottomColor: "#E2E8F0",
            gap: 8,
          }}
        >
          <Text style={{ fontWeight: "700", fontSize: 16 }}>
            {item.initials}
            {item.room ? ` · Room ${item.room}` : ""}
          </Text>
          {item.specialty && (
            <Text style={{ color: "#64748B" }}>{item.specialty}</Text>
          )}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              onPress={() => respond(item.id, "accept")}
              style={{ backgroundColor: "#059669", padding: 10, borderRadius: 6, flex: 1 }}
            >
              <Text style={{ color: "white", textAlign: "center" }}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => respond(item.id, "reject")}
              style={{ backgroundColor: "#F1F5F9", padding: 10, borderRadius: 6, flex: 1 }}
            >
              <Text style={{ textAlign: "center" }}>Decline</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    />
  );
}
