// Media Lab (docs/FEATURES.md §18): media.providers.list/.analyze/.generate/
// .transform, plus the multimodal.status/.providers/.analyze/.packet/
// .writeback pipeline (writeback is admin-gated via ConfirmSurface). Mounted
// as a tab inside ArtifactsView (see the "Artifacts | Media Lab" toggle
// there) rather than a separate sidebar view — docs/FEATURES.md files it
// under §18 "Media Lab (in Artifacts view)". Every 404/501 renders
// UnavailableState; every result payload is read defensively and falls back
// to a raw JSON dump when nothing recognizable is found (wire-or-delete: the
// call is real even when this app can't yet render a bespoke view of it).

import { useRef, useState } from "react";
import { FlaskConical, Sparkles, Wand2, Layers, UploadCloud } from "lucide-react";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { formatError, isMethodUnavailableError, isMethodNotInvokableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { compactJson } from "../../lib/wire.ts";
import { fileToBase64 } from "./artifacts-data.ts";
import {
  useAnalyzeMedia,
  useArtifactPickerOptions,
  useGenerateMedia,
  useMediaProviders,
  useMultimodalAnalyze,
  useMultimodalPacket,
  useMultimodalProviders,
  useMultimodalStatus,
  useMultimodalWriteback,
  useTransformMedia,
  summarizeMediaResult,
  type MediaSourceRef,
} from "./media-data.ts";

function degradedFrom(error: unknown): "unavailable" | "not-invokable" | "error" {
  if (isMethodUnavailableError(error)) return "unavailable";
  if (isMethodNotInvokableError(error)) return "not-invokable";
  return "error";
}

// ─── Source picker: existing artifact OR a fresh upload ────────────────────

function useSourcePicker() {
  const picker = useArtifactPickerOptions();
  const [mode, setMode] = useState<"artifact" | "upload">("artifact");
  const [artifactId, setArtifactId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function resolve(): Promise<MediaSourceRef | null> {
    if (mode === "artifact") return artifactId ? { artifactId } : null;
    if (!file) return null;
    const dataBase64 = await fileToBase64(file);
    return { dataBase64, mimeType: file.type || "application/octet-stream", filename: file.name };
  }

  const ready = mode === "artifact" ? Boolean(artifactId) : Boolean(file);

  const ui = (
    <div className="media-lab__source" role="group" aria-label="Source">
      <div className="media-lab__source-tabs" role="tablist" aria-label="Source type">
        <button type="button" role="tab" aria-selected={mode === "artifact"} onClick={() => setMode("artifact")}>
          Existing artifact
        </button>
        <button type="button" role="tab" aria-selected={mode === "upload"} onClick={() => setMode("upload")}>
          Upload
        </button>
      </div>
      {mode === "artifact" ? (
        <select
          value={artifactId}
          onChange={(event) => setArtifactId(event.target.value)}
          disabled={picker.isLoading}
          aria-label="Pick an artifact"
        >
          <option value="">
            {picker.isLoading ? "Loading artifacts…" : "Select an artifact…"}
          </option>
          {picker.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="media-lab__upload">
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud size={14} aria-hidden="true" /> {file ? file.name : "Choose a file"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
      )}
    </div>
  );

  return { ui, resolve, ready };
}

// ─── Generic result render — best-effort fields + raw JSON fallback ────────

function ResultView({ value }: { value: unknown }) {
  const summary = summarizeMediaResult(value);
  return (
    <div className="media-lab__result">
      {summary.text && <p className="media-lab__result-text">{summary.text}</p>}
      {summary.artifactId && (
        <p className="media-lab__result-note">
          Saved to Artifacts as <code>{summary.artifactId}</code>.
        </p>
      )}
      <details className="media-lab__result-raw">
        <summary>Raw response</summary>
        <pre>{compactJson(value)}</pre>
      </details>
    </div>
  );
}

// ─── Providers doctor row (media.providers.list + multimodal.status/.providers) ──

function ProvidersSection() {
  const media = useMediaProviders();
  const multimodalStatus = useMultimodalStatus();
  const multimodalProviders = useMultimodalProviders();

  return (
    <section className="media-lab__section" aria-label="Providers">
      <h3 className="media-lab__heading">
        <FlaskConical size={14} aria-hidden="true" /> Providers
      </h3>

      <div className="media-lab__providers-group">
        <h4>Media</h4>
        {media.isLoading && <SkeletonBlock variant="text" lines={2} />}
        {media.isError && degradedFrom(media.error) !== "error" && (
          <UnavailableState capability="media.providers.list" description="media providers cannot be listed." />
        )}
        {media.isError && degradedFrom(media.error) === "error" && (
          <ErrorState error={media.error} onRetry={() => void media.refetch()} title="Failed to load media providers" />
        )}
        {media.isSuccess && (
          <ProviderRows rows={media.rows} empty="No media providers configured on this daemon." />
        )}
      </div>

      <div className="media-lab__providers-group">
        <h4>Multimodal</h4>
        {(multimodalStatus.isLoading || multimodalProviders.isLoading) && <SkeletonBlock variant="text" lines={2} />}
        {multimodalStatus.isError && degradedFrom(multimodalStatus.error) !== "error" && (
          <UnavailableState capability="multimodal.status" description="multimodal is not exposed by this daemon." />
        )}
        {multimodalStatus.isSuccess && (
          <p className="media-lab__doctor-summary">
            <span className={multimodalStatus.doctor.enabled ? "badge ok" : "badge neutral"}>
              {multimodalStatus.doctor.enabled ? "enabled" : "disabled"}
            </span>
            {multimodalStatus.doctor.note && <span>{multimodalStatus.doctor.note}</span>}
          </p>
        )}
        {multimodalProviders.isError && degradedFrom(multimodalProviders.error) !== "error" && (
          <UnavailableState
            capability="multimodal.providers.list"
            description="multimodal providers cannot be listed."
          />
        )}
        {multimodalProviders.isSuccess && (
          <ProviderRows rows={multimodalProviders.rows} empty="No multimodal providers configured on this daemon." />
        )}
      </div>
    </section>
  );
}

function ProviderRows({ rows, empty }: { rows: { id: string; label: string; configured: boolean; capabilities: readonly string[] }[]; empty: string }) {
  if (rows.length === 0) return <p className="media-lab__note">{empty}</p>;
  return (
    <ul className="media-lab__provider-rows">
      {rows.map((row) => (
        <li key={row.id}>
          <span className={row.configured ? "badge ok" : "badge warning"}>
            {row.configured ? "configured" : "not configured"}
          </span>
          <span className="media-lab__provider-id">{row.label}</span>
          {row.capabilities.length > 0 && (
            <span className="media-lab__provider-caps">{row.capabilities.join(", ")}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

// ─── Analyze ─────────────────────────────────────────────────────────────────

function AnalyzeSection() {
  const source = useSourcePicker();
  const [prompt, setPrompt] = useState("");
  const analyze = useAnalyzeMedia();

  return (
    <section className="media-lab__section" aria-label="Analyze media">
      <h3 className="media-lab__heading">
        <FlaskConical size={14} aria-hidden="true" /> Analyze
      </h3>
      {source.ui}
      <textarea
        className="media-lab__prompt"
        placeholder="Optional: what should the analysis focus on?"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={2}
        aria-label="Analysis prompt"
      />
      <div className="media-lab__actions">
        <button
          type="button"
          disabled={!source.ready || analyze.isPending}
          onClick={async () => {
            const resolved = await source.resolve();
            if (resolved) analyze.mutate({ source: resolved, prompt: prompt.trim() || undefined });
          }}
        >
          {analyze.isPending ? "Analyzing…" : "Analyze"}
        </button>
      </div>
      {analyze.isError && degradedFrom(analyze.error) !== "error" && (
        <UnavailableState capability="media.analyze" description="media analysis is not available on this daemon." />
      )}
      {analyze.isError && degradedFrom(analyze.error) === "error" && (
        <ErrorState error={analyze.error} title="Analyze failed" />
      )}
      {analyze.isSuccess && <ResultView value={analyze.data} />}
    </section>
  );
}

// ─── Generate ────────────────────────────────────────────────────────────────

function GenerateSection() {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState("");
  const generate = useGenerateMedia();

  return (
    <section className="media-lab__section" aria-label="Generate media">
      <h3 className="media-lab__heading">
        <Sparkles size={14} aria-hidden="true" /> Generate
      </h3>
      <textarea
        className="media-lab__prompt"
        placeholder="Describe what to generate…"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={2}
        aria-label="Generation prompt"
      />
      <label className="media-lab__kind">
        <span>Kind</span>
        <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Media kind">
          <option value="">daemon default</option>
          <option value="image">image</option>
          <option value="audio">audio</option>
          <option value="video">video</option>
        </select>
      </label>
      <div className="media-lab__actions">
        <button
          type="button"
          disabled={!prompt.trim() || generate.isPending}
          onClick={() => {
            generate.mutate(
              { prompt: prompt.trim(), kind: kind || undefined },
              {
                onSuccess: () => toast({ title: "Generated — saved to Artifacts", tone: "success" }),
                onError: (error) => toast({ title: "Generate failed", description: formatError(error), tone: "danger" }),
              },
            );
          }}
        >
          {generate.isPending ? "Generating…" : "Generate"}
        </button>
      </div>
      {generate.isError && degradedFrom(generate.error) !== "error" && (
        <UnavailableState capability="media.generate" description="media generation is not available on this daemon." />
      )}
      {generate.isError && degradedFrom(generate.error) === "error" && (
        <ErrorState error={generate.error} title="Generate failed" />
      )}
      {generate.isSuccess && <ResultView value={generate.data} />}
    </section>
  );
}

// ─── Transform ───────────────────────────────────────────────────────────────

function TransformSection() {
  const source = useSourcePicker();
  const [instructions, setInstructions] = useState("");
  const transform = useTransformMedia();

  return (
    <section className="media-lab__section" aria-label="Transform media">
      <h3 className="media-lab__heading">
        <Wand2 size={14} aria-hidden="true" /> Transform
      </h3>
      {source.ui}
      <textarea
        className="media-lab__prompt"
        placeholder="Transform instructions (e.g. crop to square, convert to mp3)…"
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        rows={2}
        aria-label="Transform instructions"
      />
      <div className="media-lab__actions">
        <button
          type="button"
          disabled={!source.ready || !instructions.trim() || transform.isPending}
          onClick={async () => {
            const resolved = await source.resolve();
            if (resolved) transform.mutate({ source: resolved, instructions: instructions.trim() });
          }}
        >
          {transform.isPending ? "Transforming…" : "Transform"}
        </button>
      </div>
      {transform.isError && degradedFrom(transform.error) !== "error" && (
        <UnavailableState capability="media.transform" description="media transform is not available on this daemon." />
      )}
      {transform.isError && degradedFrom(transform.error) === "error" && (
        <ErrorState error={transform.error} title="Transform failed" />
      )}
      {transform.isSuccess && <ResultView value={transform.data} />}
    </section>
  );
}

// ─── Multimodal pipeline: analyze → build packet → writeback (admin confirm) ─

function MultimodalPipelineSection() {
  const { toast } = useToast();
  const source = useSourcePicker();
  const [prompt, setPrompt] = useState("");
  const analyze = useMultimodalAnalyze();
  const packet = useMultimodalPacket();
  const writeback = useMultimodalWriteback();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastSource, setLastSource] = useState<MediaSourceRef | null>(null);

  return (
    <section className="media-lab__section" aria-label="Multimodal pipeline">
      <h3 className="media-lab__heading">
        <Layers size={14} aria-hidden="true" /> Multimodal pipeline
      </h3>
      <p className="media-lab__note">
        Unified analysis → packet → knowledge write-back. Write-back is admin-scoped and
        confirm-gated.
      </p>
      {source.ui}
      <textarea
        className="media-lab__prompt"
        placeholder="Optional: analysis focus…"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={2}
        aria-label="Multimodal analysis prompt"
      />
      <div className="media-lab__actions">
        <button
          type="button"
          disabled={!source.ready || analyze.isPending}
          onClick={async () => {
            const resolved = await source.resolve();
            if (!resolved) return;
            setLastSource(resolved);
            analyze.mutate({ source: resolved, prompt: prompt.trim() || undefined });
          }}
        >
          {analyze.isPending ? "Analyzing…" : "1. Analyze"}
        </button>
        <button
          type="button"
          disabled={!analyze.isSuccess || !lastSource || packet.isPending}
          onClick={() => {
            if (!lastSource) return;
            packet.mutate({ source: lastSource, analysis: analyze.data });
          }}
        >
          {packet.isPending ? "Building…" : "2. Build packet"}
        </button>
        <button type="button" disabled={!packet.isSuccess} onClick={() => setConfirmOpen(true)}>
          3. Write back to Knowledge
        </button>
      </div>

      {analyze.isError && degradedFrom(analyze.error) !== "error" && (
        <UnavailableState capability="multimodal.analyze" description="multimodal analysis is not available on this daemon." />
      )}
      {analyze.isError && degradedFrom(analyze.error) === "error" && (
        <ErrorState error={analyze.error} title="Analyze failed" />
      )}
      {analyze.isSuccess && <ResultView value={analyze.data} />}

      {packet.isError && degradedFrom(packet.error) !== "error" && (
        <UnavailableState capability="multimodal.packet" description="packet building is not available on this daemon." />
      )}
      {packet.isError && degradedFrom(packet.error) === "error" && (
        <ErrorState error={packet.error} title="Packet build failed" />
      )}
      {packet.isSuccess && <ResultView value={packet.data} />}

      <ConfirmSurface
        open={confirmOpen}
        action="Write multimodal packet to Knowledge"
        target={lastSource?.artifactId || lastSource?.filename || "uploaded content"}
        blastRadius="Adds this packet to the shared knowledge base used by every surface and agent on this daemon. Admin-scoped."
        confirmLabel="Write back"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={(meta) => {
          setConfirmOpen(false);
          writeback.mutate(
            { packet: packet.data, meta },
            {
              onSuccess: () => toast({ title: "Written back to Knowledge", tone: "success" }),
              onError: (error) => toast({ title: "Write-back failed", description: formatError(error), tone: "danger" }),
            },
          );
        }}
      />
      {writeback.isError && degradedFrom(writeback.error) !== "error" && (
        <UnavailableState capability="multimodal.writeback" description="write-back is not available on this daemon." />
      )}
    </section>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────

export function MediaLab() {
  return (
    <div className="media-lab">
      <ProvidersSection />
      <AnalyzeSection />
      <GenerateSection />
      <TransformSection />
      <MultimodalPipelineSection />
    </div>
  );
}
