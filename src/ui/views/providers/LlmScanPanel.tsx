// Local LLM server scan (docs/GAPS.md §14 row 9, MISSING): strictly opt-in —
// nothing here ever probes localhost until the user clicks "Scan". Hits
// /app/local/llm-scan (Bun-side, 1.5s timeout per port, Ollama/LM
// Studio/llama.cpp/vLLM only) and renders a results table with a
// "use as custom provider" helper that prefills CustomProvidersPanel's
// create-new form — it does not write anything itself.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { EmptyState, ErrorState } from "../../components/feedback.tsx";
import { llmScanApi, providerJsonFromLlmServer, type LlmScanServer } from "./providers-local-api.ts";

const KIND_LABELS: Record<LlmScanServer["kind"], string> = {
  ollama: "Ollama",
  lmstudio: "LM Studio",
  llamacpp: "llama.cpp",
  vllm: "vLLM",
};

export function LlmScanPanel({
  onUseAsCustomProvider,
}: {
  onUseAsCustomProvider: (suggestedFile: string, json: Record<string, unknown>) => void;
}) {
  const { toast } = useToast();
  const [hasScanned, setHasScanned] = useState(false);

  const scan = useMutation({
    mutationFn: () => llmScanApi.scan(),
    onSuccess: () => setHasScanned(true),
    onError: (error: unknown) => toast({ title: "Scan failed", description: formatError(error), tone: "danger" }),
  });

  const servers = scan.data?.servers ?? [];
  const alive = servers.filter((s) => s.alive);

  return (
    <section className="providers-panel providers-llm-scan" aria-label="Local LLM server scan">
      <div className="providers-panel__title">
        <h3>Local LLM Servers</h3>
        <Radar size={16} aria-hidden="true" />
      </div>

      <p className="providers-custom__note">
        Opt-in only — nothing is probed until you click Scan. Checks four fixed localhost ports for a brief,
        1.5-second-timeout HTTP GET each: <code>11434</code> (Ollama), <code>1234</code> (LM Studio),{" "}
        <code>8080</code> (llama.cpp), <code>8000</code> (vLLM). No other hosts or ports are touched.
      </p>

      <button type="button" className="providers-button providers-button--primary" onClick={() => scan.mutate()} disabled={scan.isPending}>
        {scan.isPending ? "Scanning…" : "Scan localhost for LLM servers"}
      </button>

      {scan.isError && <ErrorState error={scan.error} title="Scan failed" onRetry={() => scan.mutate()} />}

      {hasScanned && !scan.isError && (
        alive.length === 0 ? (
          <EmptyState
            icon={<Radar size={24} aria-hidden="true" />}
            title="No local LLM servers found"
            description={`Checked ${servers.length} known ports — none answered.`}
          />
        ) : (
          <div className="providers-model-grid" role="list" aria-label="Discovered local LLM servers">
            {alive.map((server) => (
              <article key={`${server.kind}-${server.port}`} className="providers-model-row" role="listitem">
                <div className="providers-model-row__copy">
                  <strong>
                    {KIND_LABELS[server.kind]} · localhost:{server.port}
                  </strong>
                  <span>
                    {server.models.length > 0
                      ? `${server.models.length} model${server.models.length === 1 ? "" : "s"}: ${server.models.slice(0, 5).join(", ")}${server.models.length > 5 ? "…" : ""}`
                      : "No models reported"}
                  </span>
                </div>
                <div className="providers-model-row__actions">
                  <button
                    type="button"
                    className="providers-button"
                    onClick={() => onUseAsCustomProvider(`${server.kind}.json`, providerJsonFromLlmServer(server))}
                  >
                    Use as custom provider
                  </button>
                </div>
              </article>
            ))}
          </div>
        )
      )}
    </section>
  );
}
