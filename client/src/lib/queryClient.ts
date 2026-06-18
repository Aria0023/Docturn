import { QueryClient } from "@tanstack/react-query";
import { api } from "./api";

// Convention from the spec: a query key IS the endpoint path. A default
// queryFn turns ["/api/foo"] into GET /api/foo.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: ({ queryKey }) => api.get(queryKey[0] as string),
      retry: false,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});
