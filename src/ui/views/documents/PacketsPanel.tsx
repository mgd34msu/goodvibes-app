// Review packets: wizard + presets + freshness check + ZIP export + channel
// share (docs/GAPS.md §11 rows 4-6). Third Documents tab, alongside Drafts
// and Model compare. Packets/presets persist via packets-data.ts (the
// /app/registries "notes" collection); ZIP export via zip-writer.ts
// (store-only, no dependency — see that file's header for why); channel
// share reuses the exact invoke shape views/channels/CatalogPanel.tsx uses
// (channels.actions.invoke), gated by the shared ConfirmSurface.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Package, Send, Star, Trash2, X } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { formatError, errorStatus } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { asRecord, compactJson, firstArrayAtPath, firstString, formatRelative } from "../../lib/wire.ts";
import { Modal } from "../../components/Modal.tsx";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  deleteNote,
  docKeys,
  documentFrom,
  listDocuments,
  listVersions,
  versionFrom,
  type DocRecord,
} from "./documents-data.ts";
import {
  checkFreshness,
  createPacket,
  createPreset,
  deletePacket,
  deletePreset,
  listAllNotes,
  packetsFrom,
  plainNotesFrom,
  presetsFrom,
  type PacketItemRef,
  type PacketPreset,
  type PlainNote,
  type ReviewPacket,
} from "./packets-data.ts";
import { createZip, downloadBlob } from "./zip-writer.ts";

function isRegistryUnavailable(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 404 || status === 501;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "packet"
  );
}

export interface PacketsPanelProps {
  /** Note id to scroll to + highlight (from the /note toast's jump link). */
  highlightNoteId?: string;
  /** Whether the Packets & notes tab is the one currently showing — this
   * panel stays mounted-but-hidden on the other Documents tabs, so its polls
   * gate on this instead of running forever in the background (item 18). */
  active: boolean;
}

export function PacketsPanel({ highlightNoteId, active }: PacketsPanelProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const docsQuery = useQuery({
    queryKey: docKeys.list,
    queryFn: listDocuments,
    refetchInterval: active ? 30_000 : false,
  });
  const docs = useMemo(() => (docsQuery.data ?? []).map(documentFrom).filter((d) => d.id), [docsQuery.data]);

  const notesQuery = useQuery({
    queryKey: docKeys.allNotes,
    queryFn: listAllNotes,
    refetchInterval: active ? 30_000 : false,
  });
  const notes = notesQuery.data ?? [];
  const packets = useMemo(() => packetsFrom(notes), [notes]);
  const presets = useMemo(() => presetsFrom(notes), [notes]);
  const plainNotes = useMemo(() => plainNotesFrom(notes), [notes]);

  const unavailable =
    (docsQuery.isError && isRegistryUnavailable(docsQuery.error)) ||
    (notesQuery.isError && isRegistryUnavailable(notesQuery.error));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: docKeys.allNotes });

  if (unavailable) {
    return (
      <UnavailableState
        capability="/app/registries/notes"
        description="the app-local registry is not served by this build, so review packets cannot be stored."
      />
    );
  }
  if (docsQuery.isPending || notesQuery.isPending) return <SkeletonBlock variant="text" lines={6} />;
  if (docsQuery.isError) {
    return <ErrorState error={docsQuery.error} onRetry={() => void docsQuery.refetch()} title="Failed to load documents" />;
  }
  if (notesQuery.isError) {
    return <ErrorState error={notesQuery.error} onRetry={() => void notesQuery.refetch()} title="Failed to load packets" />;
  }

  return (
    <div className="packets-panel">
      <PacketWizard docs={docs} presets={presets} onCreated={invalidate} />
      <PacketsList docs={docs} packets={packets} onChanged={invalidate} />
      <NotesSection notes={plainNotes} highlightNoteId={highlightNoteId} onChanged={invalidate} />
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

function PacketWizard({
  docs,
  presets,
  onCreated,
}: {
  docs: DocRecord[];
  presets: PacketPreset[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [versionByDoc, setVersionByDoc] = useState<Record<string, number>>({});
  const [presetName, setPresetName] = useState("");
  const [showPresetInput, setShowPresetInput] = useState(false);

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  function toggle(id: string): void {
    setSelected((current) => ({ ...current, [id]: !current[id] }));
  }

  function applyPreset(preset: PacketPreset): void {
    setSelected(Object.fromEntries(preset.docIds.map((id) => [id, true])));
    setContext(preset.context);
    toast({ title: `Loaded preset "${preset.name}"`, tone: "info", durationMs: 2500 });
  }

  const removePreset = useMutation({
    mutationFn: (id: string) => deletePreset(id),
    onSuccess: () => onCreated(),
    onError: (error: unknown) => toast({ title: "Delete preset failed", description: formatError(error), tone: "danger" }),
  });

  const build = useMutation({
    mutationFn: async () => {
      const items: PacketItemRef[] = [];
      for (const doc of docs) {
        if (!selected[doc.id]) continue;
        const versions = (await listVersions(doc.id)).map(versionFrom);
        const wantedV = versionByDoc[doc.id] ?? doc.headVersion;
        const version = versions.find((v) => v.v === wantedV) ?? versions.sort((a, b) => b.v - a.v)[0];
        if (!version) continue;
        items.push({
          docId: doc.id,
          docTitle: doc.title,
          version: version.v,
          label: version.label,
          content: version.content,
        });
      }
      if (items.length === 0) throw new Error("Pick at least one document with a saved version.");
      return createPacket({
        title: title.trim() || `Review packet — ${new Date().toLocaleDateString()}`,
        context: context.trim(),
        items,
      });
    },
    onSuccess: () => {
      setTitle("");
      setContext("");
      setSelected({});
      onCreated();
      toast({ title: "Packet built", tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Could not build packet", description: formatError(error), tone: "danger" }),
  });

  const savePreset = useMutation({
    mutationFn: () => createPreset({ name: presetName.trim(), docIds: selectedIds, context: context.trim() }),
    onSuccess: () => {
      setPresetName("");
      setShowPresetInput(false);
      onCreated();
      toast({ title: "Preset saved", tone: "success", durationMs: 2500 });
    },
    onError: (error: unknown) => toast({ title: "Save preset failed", description: formatError(error), tone: "danger" }),
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!build.isPending) build.mutate();
  }

  return (
    <section className="packet-wizard" aria-label="Review packet wizard">
      <h3 className="packets-section-title">
        <Package size={14} aria-hidden="true" /> Packet wizard
      </h3>

      {presets.length > 0 && (
        <div className="packet-wizard__presets">
          <span>Presets</span>
          {presets.map((preset) => (
            <span key={preset.id} className="packet-wizard__preset-chip">
              <button
                type="button"
                onClick={() => applyPreset(preset)}
                title={preset.docIds.length ? `${preset.docIds.length} document(s)` : "No documents saved"}
              >
                <Star size={11} aria-hidden="true" /> {preset.name}
              </button>
              <button
                type="button"
                aria-label={`Delete preset ${preset.name}`}
                title="Delete preset"
                onClick={() => removePreset.mutate(preset.id)}
                disabled={removePreset.isPending}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="packet-wizard__form">
        <label className="packet-wizard__field">
          <span>Packet title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={`Review packet — ${new Date().toLocaleDateString()}`}
          />
        </label>

        {docs.length === 0 ? (
          <p className="document-comments__empty">No drafts yet — create one in the Drafts tab first.</p>
        ) : (
          <fieldset className="packet-wizard__docs">
            <legend>Documents to include</legend>
            {docs.map((doc) => (
              <div key={doc.id} className="packet-wizard__doc-row">
                <label>
                  <input type="checkbox" checked={Boolean(selected[doc.id])} onChange={() => toggle(doc.id)} />
                  {doc.title}
                </label>
                {selected[doc.id] && (
                  <select
                    aria-label={`Version of ${doc.title}`}
                    value={versionByDoc[doc.id] ?? doc.headVersion}
                    onChange={(e) =>
                      setVersionByDoc((current) => ({ ...current, [doc.id]: Number(e.target.value) }))
                    }
                  >
                    {Array.from({ length: doc.headVersion }, (_, i) => doc.headVersion - i).map((v) => (
                      <option key={v} value={v}>
                        v{v}
                        {v === doc.headVersion ? " (head)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </fieldset>
        )}

        <label className="packet-wizard__field">
          <span>Context for reviewers</span>
          <textarea
            rows={3}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="What should reviewers focus on? Any deadlines or open questions?"
          />
        </label>

        <div className="packet-wizard__actions">
          <button type="submit" disabled={build.isPending || selectedIds.length === 0}>
            {build.isPending ? "Building…" : "Build packet"}
          </button>
          {showPresetInput ? (
            <span className="packet-wizard__preset-save">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Preset name"
                aria-label="Preset name"
                autoFocus
              />
              <button
                type="button"
                onClick={() => savePreset.mutate()}
                disabled={!presetName.trim() || selectedIds.length === 0 || savePreset.isPending}
              >
                Save
              </button>
              <button type="button" onClick={() => setShowPresetInput(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setShowPresetInput(true)} disabled={selectedIds.length === 0}>
              Save selection as preset
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

// ─── Saved packets: freshness, export, share, delete ─────────────────────────

function PacketsList({
  docs,
  packets,
  onChanged,
}: {
  docs: DocRecord[];
  packets: ReviewPacket[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<ReviewPacket | null>(null);
  const [shareTarget, setShareTarget] = useState<ReviewPacket | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => deletePacket(id),
    onSuccess: () => {
      setDeleteTarget(null);
      onChanged();
      toast({ title: "Packet deleted", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Delete failed", description: formatError(error), tone: "danger" }),
  });

  function exportZip(packet: ReviewPacket): void {
    const freshness = checkFreshness(packet, docs);
    const manifest = {
      title: packet.title,
      context: packet.context,
      createdAt: packet.createdAt,
      items: packet.items.map((item) => ({ docId: item.docId, docTitle: item.docTitle, version: item.version, label: item.label })),
      freshness,
    };
    const blob = createZip([
      { name: "manifest.json", content: JSON.stringify(manifest, null, 2) },
      { name: "context.md", content: `# ${packet.title}\n\n${packet.context || "(no context provided)"}\n` },
      ...packet.items.map((item) => ({
        name: `${slug(item.docTitle)}-v${item.version}.md`,
        content: item.content,
      })),
    ]);
    downloadBlob(`${slug(packet.title)}-packet.zip`, blob);
    toast({ title: "ZIP exported", description: "Store-only archive (no compression) — opens in any unzip tool.", tone: "success" });
  }

  if (packets.length === 0) {
    return (
      <EmptyState
        icon={<Package size={24} aria-hidden="true" />}
        title="No review packets yet"
        description="Use the wizard above to bundle document versions with reviewer context."
      />
    );
  }

  return (
    <section className="packets-list" aria-label="Saved review packets">
      <h3 className="packets-section-title">
        <Package size={14} aria-hidden="true" /> Saved packets ({packets.length})
      </h3>
      <ul className="packets-list__items">
        {packets.map((packet) => {
          const freshness = checkFreshness(packet, docs);
          const staleCount = freshness.filter((f) => f.stale).length;
          return (
            <li key={packet.id} className="packet-card">
              <div className="packet-card__header">
                <span className="packet-card__title">{packet.title}</span>
                <span className="packet-card__meta">{formatRelative(packet.createdAt)}</span>
              </div>
              {packet.context && <p className="packet-card__context">{packet.context}</p>}
              <ul className="packet-card__items">
                {freshness.map((row) => (
                  <li key={row.docId}>
                    {row.stale ? (
                      <AlertTriangle size={12} aria-hidden="true" className="packet-card__stale-icon" />
                    ) : (
                      <CheckCircle2 size={12} aria-hidden="true" className="packet-card__fresh-icon" />
                    )}
                    <span>
                      {row.docTitle} v{row.capturedVersion}
                    </span>
                    {row.currentHeadVersion === null ? (
                      <span className="badge neutral">document removed</span>
                    ) : row.stale ? (
                      <span className="badge bad">stale — head is now v{row.currentHeadVersion}</span>
                    ) : (
                      <span className="badge ok">fresh</span>
                    )}
                  </li>
                ))}
              </ul>
              {staleCount > 0 && (
                <p className="packet-card__stale-note" role="status">
                  {staleCount} of {freshness.length} included version(s) are behind the current head.
                </p>
              )}
              <div className="packet-card__actions">
                <button type="button" onClick={() => exportZip(packet)}>
                  <Download size={13} aria-hidden="true" /> Export ZIP
                </button>
                <button type="button" onClick={() => setShareTarget(packet)}>
                  <Send size={13} aria-hidden="true" /> Share via channel
                </button>
                <button type="button" className="packet-card__delete" onClick={() => setDeleteTarget(packet)}>
                  <Trash2 size={13} aria-hidden="true" /> Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmSurface
        open={deleteTarget !== null}
        action="Delete review packet"
        target={deleteTarget?.title ?? ""}
        blastRadius="Removes the packet record (and its captured content snapshot) from the app registry. This cannot be undone."
        danger
        confirmLabel="Delete packet"
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      <SharePacketModal packet={shareTarget} onClose={() => setShareTarget(null)} />
    </section>
  );
}

// ─── Share via channel (channels.actions.invoke, admin+dangerous confirm) ────

interface ChannelActionRow {
  surface: string;
  id: string;
  label: string;
  dangerous: boolean;
}

function readChannelActionRows(value: unknown): ChannelActionRow[] {
  return firstArrayAtPath(value, [["actions"], ["items"], ["data"]]).map((entry) => {
    const row = asRecord(entry);
    return {
      surface: firstString(row, ["surface"]),
      id: firstString(row, ["id", "actionId"]),
      label: firstString(row, ["label", "name", "id"]) || firstString(row, ["id"]),
      dangerous: row["dangerous"] === true,
    };
  });
}

function packetSummaryText(packet: ReviewPacket): string {
  const lines = packet.items.map((item) => `- ${item.docTitle} (v${item.version})`);
  return `Review packet: ${packet.title}\n\n${packet.context || "(no context provided)"}\n\nDocuments:\n${lines.join("\n")}`;
}

function SharePacketModal({ packet, onClose }: { packet: ReviewPacket | null; onClose: () => void }) {
  const { toast } = useToast();
  const [surface, setSurface] = useState("");
  const [actionId, setActionId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [confirming, setConfirming] = useState(false);

  const actions = useQuery({
    queryKey: ["documents-registry", "channel-actions"],
    queryFn: () => invoke("channels.actions.list"),
    select: readChannelActionRows,
    enabled: packet !== null,
    retry: false,
  });

  const rows = actions.data ?? [];
  const selectedRow = rows.find((row) => row.surface === surface && row.id === actionId) ?? null;

  const share = useMutation({
    mutationFn: (meta: ConfirmMetadata) => {
      if (!packet || !selectedRow) throw new Error("Pick a surface and action first.");
      return invoke("channels.actions.invoke", {
        params: { surface: selectedRow.surface, actionId: selectedRow.id },
        body: { text: packetSummaryText(packet), accountId: recipient || undefined, ...meta },
      });
    },
    onSuccess: () => {
      setConfirming(false);
      onClose();
      toast({ title: "Packet shared", description: `Sent via ${selectedRow?.label ?? "channel"} to ${recipient}`, tone: "success" });
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: "Share failed", description: formatError(error), tone: "danger" });
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!selectedRow || !recipient.trim() || share.isPending) return;
    setConfirming(true);
  }

  return (
    <>
      <Modal open={packet !== null} onClose={onClose} title={`Share packet: ${packet?.title ?? ""}`}>
        {packet && (
          <form className="packet-share" onSubmit={handleSubmit}>
            {actions.isPending && <SkeletonBlock variant="text" lines={3} />}
            {actions.isError && (
              <UnavailableState capability="channels.actions.list" description="channel actions cannot be listed on this daemon." />
            )}
            {actions.isSuccess && rows.length === 0 && (
              <p className="document-comments__empty">No channel actions are published — nothing to share through yet.</p>
            )}
            {rows.length > 0 && (
              <>
                <label className="packet-share__field">
                  <span>Action</span>
                  <select
                    value={surface && actionId ? `${surface}::${actionId}` : ""}
                    onChange={(e) => {
                      const [s, a] = e.target.value.split("::");
                      setSurface(s ?? "");
                      setActionId(a ?? "");
                    }}
                  >
                    <option value="">Pick a surface action…</option>
                    {rows.map((row) => (
                      <option key={`${row.surface}::${row.id}`} value={`${row.surface}::${row.id}`}>
                        {row.surface} · {row.label}
                        {row.dangerous ? " (dangerous)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="packet-share__field">
                  <span>Recipient (account id / handle) — required</span>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="e.g. #team-review or a user handle"
                    required
                  />
                </label>
                <label className="packet-share__field">
                  <span>Message preview</span>
                  <textarea rows={5} value={packetSummaryText(packet)} readOnly className="packet-share__preview" />
                </label>
              </>
            )}
            <div className="packet-share__actions">
              <button type="button" className="packet-share__btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="packet-share__btn packet-share__btn--primary" disabled={!selectedRow || !recipient.trim() || share.isPending}>
                <Send size={13} aria-hidden="true" /> {share.isPending ? "Sending…" : "Send…"}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <ConfirmSurface
        open={confirming && packet !== null}
        action="Share review packet"
        target={`${recipient || "(no recipient)"} via ${selectedRow?.surface ?? ""} · ${selectedRow?.label ?? ""}`}
        blastRadius={
          selectedRow?.dangerous
            ? "Marked dangerous by the daemon — this sends a real message to a real recipient on a live channel surface."
            : "Sends a real message to a real recipient on a live channel surface."
        }
        danger
        confirmLabel="Send"
        onConfirm={(meta) => share.mutate(meta)}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

// ─── Plain notes (includes chat's /note-saved items) ─────────────────────────

function NotesSection({
  notes,
  highlightNoteId,
  onChanged,
}: {
  notes: PlainNote[];
  highlightNoteId?: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [highlighted, setHighlighted] = useState(highlightNoteId ?? "");

  useEffect(() => {
    if (!highlightNoteId) return;
    setHighlighted(highlightNoteId);
    const el = document.getElementById(`note-${highlightNoteId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timer = window.setTimeout(() => setHighlighted(""), 4000);
    return () => window.clearTimeout(timer);
  }, [highlightNoteId]);

  const remove = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: () => {
      onChanged();
      toast({ title: "Note deleted", tone: "info" });
    },
    onError: (error: unknown) => toast({ title: "Delete failed", description: formatError(error), tone: "danger" }),
  });

  if (notes.length === 0) return null;

  return (
    <section className="packets-notes" aria-label="Quick notes">
      <h3 className="packets-section-title">Notes ({notes.length})</h3>
      <ul className="packets-notes__list">
        {notes.map((note) => (
          <li
            key={note.id}
            id={`note-${note.id}`}
            className={note.id === highlighted ? "packet-note packet-note--highlight" : "packet-note"}
          >
            <p className="packet-note__text">{note.text || compactJson(note.raw)}</p>
            <div className="packet-note__meta">
              <span className="badge neutral">{note.tag}</span>
              <span>{formatRelative(note.createdAt)}</span>
              <button type="button" onClick={() => remove.mutate(note.id)} disabled={remove.isPending}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
