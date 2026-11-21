import { subgraph } from "@/lib/kb";

/** One vendor's records and how they connect: /api/kb?vendor=V001&version=v2 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const g = subgraph(q.get("vendor") ?? "", q.get("version") === "v1" ? "v1" : "v2");
  if (!g) return Response.json({ error: "Unknown vendor" }, { status: 404 });
  return Response.json(g);
}
