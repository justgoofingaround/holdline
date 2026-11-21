import { data, getInvoice } from "@/lib/engine";
import { llmConfig, runAll } from "@/lib/llm";
import type { AgentVersion, RunEvent } from "@/lib/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Streams one verdict per payment as server-sent events. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const version: AgentVersion = q.get("version") === "v1" ? "v1" : "v2";
  const pace = Math.min(400, Math.max(0, Number(q.get("pace") ?? 70)));
  const cfg = llmConfig();
  const invoices = data.runOrder.map((id) => getInvoice(id)!);
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: RunEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      const t0 = Date.now();
      try {
        send({ type: "start", total: invoices.length, engine: cfg ? "llm" : "rules", model: cfg?.model ?? null, version });
        const session = `run-${version}-${new Date().toISOString()}`;
        for await (const verdict of runAll(invoices, version, true, session)) {
          if (req.signal.aborted) break;
          send({ type: "verdict", verdict });
          if (!cfg && pace) await sleep(pace); // pacing so the run is watchable; the checks themselves take <1 ms
        }
        send({ type: "done", ms: Date.now() - t0 });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}

// A model-backed run can take minutes; give it room when hosted.
export const maxDuration = 300;
