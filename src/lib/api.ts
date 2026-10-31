export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
let csrf: string | null = null;
export function setCsrf(value: string | null) {
  csrf = value;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers:
      method === "GET"
        ? {}
        : {
            "Content-Type": "application/json",
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    signal,
  });
  const data = (await response
    .json()
    .catch(() => ({
      error: "The server returned an unreadable response.",
    }))) as { error?: string; code?: string };
  if (!response.ok)
    throw new ApiError(
      data.error || "Request failed.",
      response.status,
      data.code,
    );
  return data as T;
}
export async function streamChat(body: unknown, signal: AbortSignal) {
  const response = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf || "" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const data = (await response.json()) as { error?: string; code?: string };
    throw new ApiError(
      data.error || "Could not start a response.",
      response.status,
      data.code,
    );
  }
  if (!response.body)
    throw new Error("Streaming is unavailable in this browser.");
  return response.body;
}
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
export async function copyText(value: string) {
  if (!navigator.clipboard)
    throw new Error(
      "Clipboard access requires HTTPS. Select the text to copy it.",
    );
  await navigator.clipboard.writeText(value);
}
export function download(
  name: string,
  content: string,
  type = "text/markdown;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
