
/** Text to speech through ElevenLabs. Returns 204 without a key so the browser falls back to its own voice. */
export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return new Response(null, { status: 204 });
  const { text } = (await req.json()) as { text?: string };
  if (!text || text.length > 600) return Response.json({ error: "text required, max 600 chars" }, { status: 400 });
  const voice = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5" }),
  });
  if (!res.ok) return Response.json({ error: `ElevenLabs ${res.status}` }, { status: 502 });
  return new Response(res.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
}
