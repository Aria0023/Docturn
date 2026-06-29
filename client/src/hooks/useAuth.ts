import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { User } from '@/lib/types';

export const userQueryKey = ['user'] as const;

export function useUser() {
  return useQuery<User | null>({
    queryKey: userQueryKey,
    queryFn: async () => {
      try {
        return await api.get<User>('/api/user');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          return null;
        }
        throw err;
      }
    },
    staleTime: 30_000,
  });
}

export interface LoginInput {
  username: string;
  password: string;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<User>('/api/login', input),
    onSuccess: (user) => {
      qc.setQueryData(userQueryKey, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/api/logout'),
    onSuccess: () => {
      qc.setQueryData(userQueryKey, null);
      qc.clear();
    },
  });
}
