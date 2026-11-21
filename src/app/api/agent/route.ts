import { randomUUID } from "node:crypto";
import { chat, type ChatTurn } from "@/lib/chat";

/**
 * Ask Holdline. POST { message, history?, conversation_id? } → { output: { text }, blocked, invoices }.
 * Also accepts { question } or { document_text } so PRISM's test runner can drive it.
 * If PRISM_TEST_KEY is set, callers must send it in the X-Prism-Test-Key header. The app's own page is let
 * through by its Sec-Fetch-Site header; that keeps casual callers off a deployed demo but is not a security boundary.
 */
export async function POST(req: Request) {
  const key = process.env.PRISM_TEST_KEY;
  if (key && req.headers.get("x-prism-test-key") !== key && req.headers.get("sec-fetch-site") !== "same-origin")
    return Response.json({ error: "Missing or wrong X-Prism-Test-Key" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const message = body?.message ?? body?.question ?? body?.document_text;
  if (typeof message !== "string" || !message.trim() || message.length > 8000)
    return Response.json({ error: "Send { message } (max 8000 characters)" }, { status: 400 });
  const history: ChatTurn[] = Array.isArray(body.history)
    ? body.history
        .filter((h: unknown): h is ChatTurn => !!h && typeof h === "object" && ["user", "assistant"].includes((h as ChatTurn).role) && typeof (h as ChatTurn).content === "string")
        .slice(-20)
    : [];
  const conversationId = typeof body.conversation_id === "string" && body.conversation_id ? body.conversation_id.slice(0, 120) : randomUUID();

  const r = await chat(message.trim(), history, conversationId);
  return Response.json({ output: { text: r.text }, blocked: r.blocked, invoices: r.invoices, engine: r.engine, conversation_id: conversationId });
}

// A model-backed run can take minutes; give it room when hosted.
export const maxDuration = 300;
