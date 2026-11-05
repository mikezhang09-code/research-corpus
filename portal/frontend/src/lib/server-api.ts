// Server-side reads from the FastAPI backend, for server components.
//
// The browser reaches the backend through the /api rewrite in next.config.ts;
// on the server we call it directly over localhost, the same BACKEND_URL the
// rewrite uses. Returns null on any failure so pages can fall back to a
// client-side fetch rather than fail to render.

const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function backendJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND}${path}`, { cache: "no-store" });
    if (!res.ok) {
      console.error(`backend ${path} -> ${res.status}; the page will fetch on the client`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.error(`backend ${path} failed; the page will fetch on the client`, e);
    return null;
  }
}
