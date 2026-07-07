// Record detail peek (FEATURES.md §7: detail with confidence, provenance,
// links, review state; update + review-state transitions; links add/list).
//
// Every field renders verbatim — a provenance `ref` that looks like a file
// path is plain text exactly like any other ref, never turned into a link or
// fetched. The peek re-queries memory.records.get keyed under the ["memory"]
// prefix, so any memory mutation's invalidation refreshes an open peek too.

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { gv, invoke } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { MemoryReviewForm, type MemoryReviewDraft } from "./ReviewQueuePanel.tsx";
import {
  MEMORY_LINK_RELATIONS,
  MEMORY_SCOPES,
  formatConfidence,
  formatProvenanceLink,
  formatTimestamp,
  isFlaggedReviewState,
  memoryKeys,
  parseLinks,
  parseRecordEntity,
  reviewStateTone,
  splitTags,
  type MemoryRecord,
  type MemoryScope,
} from "./memory-wire.ts";

export function MemoryRecordPeek({ initial }: { initial: MemoryRecord }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const detail = useQuery({
    queryKey: memoryKeys.record(initial.id),
    queryFn: async () => parseRecordEntity(await gv.memory.records.get(initial.id)),
    // Paint instantly from the row we already have; the fetch refreshes it.
    initialData: initial,
    retry: false,
  });
  const record = detail.data ?? initial;

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: memoryKeys.all });

  const updateReview = useMutation({
    mutationFn: (input: MemoryReviewDraft) =>
      gv.memory.records.updateReview(record.id, { id: record.id, ...input }),
    onSuccess: async () => {
      await invalidateAll();
      toast({ title: "Review saved", tone: "success" });
    },
    onError: (error: unknown) => {
      toast({ title: "Could not save the review", description: formatError(error), tone: "danger" });
    },
  });

  const flagged = isFlaggedReviewState(record.reviewState);

  return (
    <div className="memory-record-detail">
      {detail.isError && !isMethodUnavailableError(detail.error) && (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="Could not refresh this record" />
      )}

      <section className="memory-record-detail__section">
        <h3>{record.summary}</h3>
        <dl className="memory-record-detail__facts">
          <div>
            <dt>Type</dt>
            <dd>
              <span className="badge neutral">{record.cls}</span>
            </dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>
              <span className="badge neutral">{record.scope}</span>
            </dd>
          </div>
          <div>
            <dt>Review state</dt>
            <dd>
              <span className={`badge ${reviewStateTone(record.reviewState)}`}>{record.reviewState}</span>
            </dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{formatConfidence(record.confidence)}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatTimestamp(record.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatTimestamp(record.updatedAt)}</dd>
          </div>
          {record.reviewedAt !== undefined && (
            <div>
              <dt>Reviewed</dt>
              <dd>
                {formatTimestamp(record.reviewedAt)}
                {record.reviewedBy ? ` by ${record.reviewedBy}` : ""}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {flagged && record.staleReason && (
        <section className="memory-record-detail__section memory-record-detail__stale-reason" role="note">
          <h4>Why this is flagged</h4>
          <p>{record.staleReason}</p>
        </section>
      )}

      {record.detail && (
        <section className="memory-record-detail__section">
          <h4>Detail</h4>
          <p className="memory-record-detail__detail">{record.detail}</p>
        </section>
      )}

      <section className="memory-record-detail__section">
        <h4>Tags</h4>
        {record.tags.length ? (
          <div className="memory-record-detail__tags">
            {record.tags.map((tag) => (
              <span key={tag} className="memory-tag-chip">
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="memory-record-detail__none">No tags</p>
        )}
      </section>

      <section className="memory-record-detail__section">
        <h4>Provenance</h4>
        {record.provenance.length ? (
          <ul className="memory-record-detail__provenance">
            {record.provenance.map((link, index) => (
              <li key={`${link.kind}-${link.ref}-${index}`}>{formatProvenanceLink(link)}</li>
            ))}
          </ul>
        ) : (
          <p className="memory-record-detail__none">No provenance recorded</p>
        )}
      </section>

      <section className="memory-record-detail__section">
        <h4>Review</h4>
        {/* Keyed by state+confidence so a background refetch reseeds the draft. */}
        <MemoryReviewForm
          key={`${record.id}:${record.reviewState}:${record.confidence}`}
          record={record}
          saving={updateReview.isPending}
          onSave={(input) => updateReview.mutate(input)}
        />
      </section>

      <EditRecordSection record={record} />

      <LinksSection record={record} />
    </div>
  );
}

// ─── Edit (memory.records.update — content fields, distinct from review) ─────

function EditRecordSection({ record }: { record: MemoryRecord }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(record.summary);
  const [detail, setDetail] = useState(record.detail ?? "");
  const [tags, setTags] = useState(record.tags.join(", "));
  const knownScope = (MEMORY_SCOPES as readonly string[]).includes(record.scope)
    ? (record.scope as MemoryScope)
    : "project";
  const [scope, setScope] = useState<MemoryScope>(knownScope);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => gv.memory.records.update(record.id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: memoryKeys.all });
      setEditing(false);
      toast({ title: "Record updated", tone: "success" });
    },
    onError: (error: unknown) => {
      if (isMethodUnavailableError(error)) {
        toast({
          title: "Update not available",
          description: "This daemon does not serve memory.records.update.",
          tone: "warning",
        });
        return;
      }
      toast({ title: "Update failed", description: formatError(error), tone: "danger" });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!summary.trim() || update.isPending) return;
    update.mutate({
      id: record.id,
      scope,
      summary: summary.trim(),
      detail: detail.trim(),
      tags: splitTags(tags),
    });
  }

  if (!editing) {
    return (
      <section className="memory-record-detail__section">
        <h4>Edit</h4>
        <button
          type="button"
          className="memory-button"
          onClick={() => {
            // Reseed the draft from the current record on open.
            setSummary(record.summary);
            setDetail(record.detail ?? "");
            setTags(record.tags.join(", "));
            setScope(knownScope);
            setEditing(true);
          }}
        >
          Edit summary, detail, tags, scope
        </button>
      </section>
    );
  }

  return (
    <section className="memory-record-detail__section">
      <h4>Edit</h4>
      <form className="memory-form" onSubmit={submit}>
        <label>
          Summary
          <input value={summary} onChange={(event) => setSummary(event.target.value)} aria-label="Edit summary" required />
        </label>
        <label>
          Detail
          <textarea value={detail} onChange={(event) => setDetail(event.target.value)} rows={3} aria-label="Edit detail" />
        </label>
        <div className="memory-form__split">
          <label>
            Tags
            <input value={tags} onChange={(event) => setTags(event.target.value)} aria-label="Edit tags, comma separated" />
          </label>
          <label>
            Scope
            <select value={scope} onChange={(event) => setScope(event.target.value as MemoryScope)} aria-label="Edit scope">
              {MEMORY_SCOPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="memory-form__actions">
          <button type="button" className="memory-button" onClick={() => setEditing(false)} disabled={update.isPending}>
            Cancel
          </button>
          <button
            type="submit"
            className="memory-button memory-button--primary"
            disabled={update.isPending || !summary.trim()}
            aria-busy={update.isPending}
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ─── Links (memory.records.links.list / .add) ────────────────────────────────

function LinksSection({ record }: { record: MemoryRecord }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [toId, setToId] = useState("");
  const [relation, setRelation] = useState("");

  const links = useQuery({
    queryKey: memoryKeys.links(record.id),
    queryFn: async () =>
      parseLinks(await invoke("memory.records.links.list", { params: { id: record.id } })),
    retry: false,
  });

  const addLink = useMutation({
    mutationFn: (body: { toId: string; relation: string }) =>
      invoke("memory.records.links.add", { params: { id: record.id }, body: { id: record.id, ...body } }),
    onSuccess: async () => {
      setToId("");
      setRelation("");
      await queryClient.invalidateQueries({ queryKey: memoryKeys.all });
      toast({ title: "Link added", tone: "success" });
    },
    onError: (error: unknown) => {
      if (isMethodUnavailableError(error)) {
        toast({
          title: "Links not available",
          description: "This daemon does not serve memory.records.links.add.",
          tone: "warning",
        });
        return;
      }
      // The daemon 404s when either endpoint record does not exist — honest,
      // never a 200 pretending a link was made.
      toast({ title: "Could not add link", description: formatError(error), tone: "danger" });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!toId.trim() || !relation.trim() || addLink.isPending) return;
    addLink.mutate({ toId: toId.trim(), relation: relation.trim() });
  }

  const linksUnavailable = links.isError && isMethodUnavailableError(links.error);

  return (
    <section className="memory-record-detail__section">
      <h4>
        <Link2 size={14} aria-hidden="true" /> Links
      </h4>

      {links.isPending && <SkeletonBlock width="100%" height={24} />}

      {linksUnavailable && (
        <UnavailableState
          capability="memory.records.links.list"
          description="the record graph cannot be read or extended here."
        />
      )}

      {links.isError && !linksUnavailable && (
        <ErrorState error={links.error} onRetry={() => void links.refetch()} title="Could not load links" />
      )}

      {links.isSuccess &&
        (links.data.length ? (
          <ul className="memory-record-detail__links">
            {links.data.map((link, index) => {
              const outgoing = link.fromId === record.id;
              const otherId = outgoing ? link.toId : link.fromId;
              return (
                <li key={`${link.fromId}-${link.relation}-${link.toId}-${index}`}>
                  <span className="badge info">{outgoing ? link.relation : `⟵ ${link.relation}`}</span>{" "}
                  <code className="memory-record-detail__link-id">{otherId}</code>
                  {link.createdAt !== undefined && (
                    <span className="memory-record-detail__link-time"> · {formatTimestamp(link.createdAt)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="memory-record-detail__none">No links — this record stands alone.</p>
        ))}

      {!linksUnavailable && (
        <form className="memory-link-form" onSubmit={submit}>
          <input
            value={toId}
            onChange={(event) => setToId(event.target.value)}
            placeholder="Target record id"
            aria-label="Target record id"
          />
          <input
            value={relation}
            onChange={(event) => setRelation(event.target.value)}
            placeholder="Relation (e.g. supersedes)"
            aria-label="Link relation"
            list="memory-link-relations"
          />
          <datalist id="memory-link-relations">
            {MEMORY_LINK_RELATIONS.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <button
            type="submit"
            className="memory-button"
            disabled={addLink.isPending || !toId.trim() || !relation.trim()}
            aria-busy={addLink.isPending}
          >
            {addLink.isPending ? "Linking…" : "Add link"}
          </button>
        </form>
      )}
    </section>
  );
}
