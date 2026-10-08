// Streams a Creative Commons track from Jamendo / Freesound when the host blocks a
// direct browser download (CORS). Only those hosts are allowed, so this is not an open proxy.
export const maxDuration = 60;

const ALLOWED = [/(^|\.)jamendo\.com$/, /(^|\.)freesound\.org$/];

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("u") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (target.protocol !== "https:" || !ALLOWED.some((r) => r.test(target.hostname))) return new Response("Host not allowed", { status: 403 });
  const up = await fetch(target, { redirect: "follow" });
  if (!up.ok || !up.body) return new Response("Upstream error", { status: 502 });
  return new Response(up.body, {
    headers: {
      "content-type": up.headers.get("content-type") ?? "audio/mpeg",
      ...(up.headers.get("content-length") ? { "content-length": up.headers.get("content-length")! } : {}),
      "cache-control": "private, no-store",
    },
  });
}
