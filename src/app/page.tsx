import App from "@/components/App";
import { data, queue } from "@/lib/engine";
import { kbStats, overview } from "@/lib/kb";
import { llmConfig } from "@/lib/llm";

export default function Page() {
  const kb = { stats: kbStats(), rows: { v1: overview("v1"), v2: overview("v2") } };
  return <App meta={data.meta} queue={queue()} model={llmConfig()?.model ?? null} kb={kb} />;
}
