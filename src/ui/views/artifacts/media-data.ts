// Media Lab data layer (docs/FEATURES.md §18, media.* + multimodal.* rows).
// Neither namespace is on the gv.ts facade (Wave A only wrapped voice.*), so
// every call here goes through the generic `invoke(methodId, …)` export —
// no gv.ts edits. Every response shape is read defensively (lib/wire) since
// media.analyze/generate/transform and multimodal.analyze/packet payloads
// are not pinned across daemon versions; unrecognized shapes still render
// (compactJson fallback in the view), they just don't get bespoke fields.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gv, invoke } from "../../lib/gv.ts";
import type { ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { asRecord, firstArrayAtPath, firstString } from "../../lib/wire.ts";

// ─── Query keys — LOCAL to this view, unique prefixes ("media"/"multimodal"),
// not registered in lib/queries.ts (out of this agent's grant). ─────────────

export const mediaKeys = {
  providers: ["media", "providers"] as const,
  multimodalStatus: ["multimodal", "status"] as const,
  multimodalProviders: ["multimodal", "providers"] as const,
};

// ─── Provider catalogs ───────────────────────────────────────────────────────

export interface MediaProviderRow {
  readonly id: string;
  readonly label: string;
  readonly configured: boolean;
  readonly capabilities: readonly string[];
}

function readCapabilityList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function mediaProviderRowsFrom(value: unknown): MediaProviderRow[] {
  return firstArrayAtPath(value, [["providers"], ["items"], ["data"], ["results"]]).map((entry) => {
    const p = asRecord(entry);
    const id = firstString(p, ["id", "providerId", "name"]);
    return {
      id,
      label: firstString(p, ["label", "name", "id"]) || id,
      configured: p["configured"] === true,
      capabilities: readCapabilityList(p["capabilities"]),
    };
  });
}

export function useMediaProviders() {
  const query = useQuery({
    queryKey: mediaKeys.providers,
    queryFn: () => invoke("media.providers.list"),
    staleTime: 60_000,
    retry: false,
  });
  return { rows: query.data ? mediaProviderRowsFrom(query.data) : [], ...query };
}

export interface MultimodalDoctorInfo {
  readonly enabled: boolean;
  readonly note: string;
}

export function multimodalDoctorFrom(value: unknown): MultimodalDoctorInfo {
  const record = asRecord(value);
  return { enabled: record["enabled"] === true, note: firstString(record, ["note", "message"]) };
}

export function useMultimodalStatus() {
  const query = useQuery({
    queryKey: mediaKeys.multimodalStatus,
    queryFn: () => invoke("multimodal.status"),
    staleTime: 15_000,
    retry: false,
  });
  return { doctor: query.data ? multimodalDoctorFrom(query.data) : { enabled: false, note: "" }, ...query };
}

export function useMultimodalProviders() {
  const query = useQuery({
    queryKey: mediaKeys.multimodalProviders,
    queryFn: () => invoke("multimodal.providers.list"),
    staleTime: 60_000,
    retry: false,
  });
  return { rows: query.data ? mediaProviderRowsFrom(query.data) : [], ...query };
}

// ─── Result readers — best-effort field extraction, raw payload kept for the
// honest JSON fallback the view renders when nothing recognizable is found. ──

export interface MediaResultSummary {
  readonly text: string;
  readonly artifactId: string;
  readonly raw: unknown;
}

export function summarizeMediaResult(value: unknown): MediaResultSummary {
  const record = asRecord(value);
  const text =
    firstString(record, ["summary", "text", "description", "analysis", "result"]) ||
    firstString(asRecord(record["result"]), ["summary", "text", "description"]);
  const artifactId =
    firstString(record, ["artifactId"]) || firstString(asRecord(record["artifact"]), ["id", "artifactId"]);
  return { text, artifactId, raw: value };
}

// ─── media.* mutations ───────────────────────────────────────────────────────

export interface MediaSourceRef {
  /** Either an existing artifact id… */
  readonly artifactId?: string;
  /** …or freshly uploaded bytes. */
  readonly dataBase64?: string;
  readonly mimeType?: string;
  readonly filename?: string;
}

function sourceBody(source: MediaSourceRef): Record<string, unknown> {
  if (source.artifactId) return { artifactId: source.artifactId };
  return {
    dataBase64: source.dataBase64,
    mimeType: source.mimeType || "application/octet-stream",
    filename: source.filename || "upload",
  };
}

export function useAnalyzeMedia() {
  return useMutation({
    mutationFn: (vars: { source: MediaSourceRef; prompt?: string }) =>
      invoke("media.analyze", { body: { ...sourceBody(vars.source), ...(vars.prompt ? { prompt: vars.prompt } : {}) } }),
  });
}

export function useGenerateMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { prompt: string; kind?: string; providerId?: string }) =>
      invoke("media.generate", {
        body: { prompt: vars.prompt, ...(vars.kind ? { kind: vars.kind } : {}), ...(vars.providerId ? { providerId: vars.providerId } : {}) },
      }),
    onSuccess: () => {
      // A successful generate typically materializes a new artifact —
      // refresh the artifacts list prefix so it shows up without a manual reload.
      void queryClient.invalidateQueries({ queryKey: ["artifacts"] });
    },
  });
}

export function useTransformMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { source: MediaSourceRef; instructions: string }) =>
      invoke("media.transform", { body: { ...sourceBody(vars.source), instructions: vars.instructions } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["artifacts"] }),
  });
}

// ─── multimodal.* mutations (analyze → packet → confirm-gated writeback) ────

export function useMultimodalAnalyze() {
  return useMutation({
    mutationFn: (vars: { source: MediaSourceRef; prompt?: string }) =>
      invoke("multimodal.analyze", {
        body: { ...sourceBody(vars.source), ...(vars.prompt ? { prompt: vars.prompt } : {}) },
      }),
  });
}

export function useMultimodalPacket() {
  return useMutation({
    mutationFn: (vars: { source: MediaSourceRef; analysis: unknown }) =>
      invoke("multimodal.packet", { body: { ...sourceBody(vars.source), analysis: vars.analysis } }),
  });
}

/** Admin-gated: writes a built packet into the shared knowledge base. */
export function useMultimodalWriteback() {
  return useMutation({
    mutationFn: (vars: { packet: unknown; meta: ConfirmMetadata }) =>
      invoke("multimodal.writeback", { body: { packet: vars.packet, ...vars.meta } }),
  });
}

// ─── Artifact picker (reuses artifacts.list — same daemon list every
// ArtifactsView row uses, kept here so Media Lab doesn't import ArtifactsView
// internals). ──────────────────────────────────────────────────────────────

export interface ArtifactPickOption {
  readonly id: string;
  readonly label: string;
}

export function artifactPickOptionsFrom(value: unknown): ArtifactPickOption[] {
  return firstArrayAtPath(value, [["artifacts"], ["items"], ["data"]])
    .map((entry) => {
      const record = asRecord(entry);
      const id = firstString(record, ["id", "artifactId"]);
      return { id, label: firstString(record, ["filename", "name", "title"]) || id };
    })
    .filter((option) => option.id);
}

export function useArtifactPickerOptions() {
  const query = useQuery({
    queryKey: ["artifacts", "media-lab-picker"],
    queryFn: () => gv.artifacts.list({ limit: 100 }),
    staleTime: 30_000,
    retry: false,
  });
  return { options: query.data ? artifactPickOptionsFrom(query.data) : [], ...query };
}
