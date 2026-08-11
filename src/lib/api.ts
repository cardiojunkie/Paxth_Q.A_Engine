export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function apiFetch<T = void>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const method = (init.method || "GET").toUpperCase();
  if (!["GET", "HEAD"].includes(method) && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      const serverMessage = typeof body.error === "string"
        ? body.error
        : typeof body.error?.message === "string"
          ? body.error.message
          : typeof body.message === "string" ? body.message : null;
      if (serverMessage) message = serverMessage;
    } catch {
      // Keep the status-only message when the server did not return JSON.
    }
    if (response.status === 401) window.dispatchEvent(new Event("paxth:unauthorized"));
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
