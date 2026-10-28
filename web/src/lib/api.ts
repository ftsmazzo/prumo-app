export type User = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
};

export type TodayItem = Record<string, unknown>;

export type TodayResponse = {
  commitments: TodayItem[];
  tasks: TodayItem[];
  pendingConfirm: TodayItem[];
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `http_${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const client = {
  me: () => api<User>("/api/auth/me"),
  login: (email: string, password: string) =>
    api<User>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => api<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  today: () => api<TodayResponse>("/api/today"),
  commitments: (from?: string) =>
    api<{ items: TodayItem[] }>(
      `/api/commitments${from ? `?from=${encodeURIComponent(from)}` : ""}`,
    ),
  tasks: () => api<{ items: TodayItem[] }>("/api/tasks"),
  patchCommitment: (id: string, body: Record<string, unknown>) =>
    api(`/api/commitments/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  patchTask: (id: string, body: Record<string, unknown>) =>
    api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
};
