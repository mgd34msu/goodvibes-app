// The owner profile: one Markdown file the daemon keeps, holding what the
// platform knows about its owner. All nine profile.* verbs live here, because
// they carry no CONFIG_SCHEMA entry and so get a bespoke panel rather than a
// schema-driven row (the profile.* CONFIG keys enabled, autonomousWrites and
// discloseWrites stay in the Daemon config tab where the schema puts them).
//
// The panel answers the three questions the profile exists to answer:
//
//   "what do you know about me?"  profile.read, rendered by section. Mechanical
//      fields render as labelled values; everything else renders as the prose it
//      is. The owner's prose is NOT restyled into a table: the file is a
//      document he wrote, and the daemon's writer never normalizes it, so
//      neither does this.
//   "where did you get that?"     profile.provenance, per field, from that
//      field's own button. Every learned line already shows its compact suffix;
//      the button adds the retained predecessors. Per field, never one bulk dump.
//   "forget that"                 profile.forget, behind a confirm, then a report
//      of what actually went. Deleting is permanent: no tombstone, no retention
//      window, and the history that would have made it undoable goes with it.
//
// WHERE UNDO LIVES, AND WHY. profile.read carries no superseded count, so the
// only honest source for "does an earlier value exist" is profile.provenance.
// Undo therefore sits INSIDE the provenance disclosure, directly under the
// earlier values it would restore, rather than on every field as a mostly-dead
// button.
//
// WHY PROSE LINES HAVE NO LOOKUP AND NO UNDO. profile.provenance and
// profile.undo take a fieldId, and prose bullets are never superseded, so a
// bullet's whole provenance is the suffix already on the line, so there is no
// predecessor list to fetch and nothing to restore. The panel says that instead
// of offering a button that cannot work.
//
// THE TWO NAMED LOOKUPS. profile.get and profile.person are not part of
// rendering the document; they are what a CONSUMER does (ask for one field, or
// for one person's lines) and each answers with the disclosure the owner would
// see. They get their own "Ask the profile" block so the operator can see
// exactly what a named read returns, including the honest present:false for a
// field he has not recorded.
//
// CONTAINMENT. The People section holds facts about people who never agreed to
// be in a database: it is marked in the DOM, carries a visible note, and renders
// as plain inert text with no link, copy, or export affordance. Nothing in this
// file logs a profile value, and nothing here persists one.

import { useState, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, isMethodNotInvokableError, isMethodUnavailableError } from "../../lib/errors.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  buildProfileAppendInput,
  buildProfileForgetInput,
  buildProfileSetInput,
  buildProfileUndoInput,
  forgetReportLine,
  mostRecentSupersededIndex,
  profileDisabledLine,
  profileStateBadgeTone,
  profileStateLabel,
  profileUnavailableLine,
  provenanceSummary,
  readProfileDocument,
  readProfileFieldAnswer,
  readProfilePersonAnswer,
  readProfileProvenanceAnswer,
  readProfileStatus,
  readProfileWriteOutcome,
  sectionHoldsThirdPartyData,
  tierNote,
  writeReportLine,
  type ProfileField,
  type ProfileProseLine,
  type ProfileReport,
  type ProfileSection,
  type ProfileTarget,
  type ProfileWriteOutcome,
} from "./owner-profile.ts";

const MALFORMED_DOCUMENT = "The daemon answered, but its response did not carry an owner profile.";
const MALFORMED_STATUS = "The daemon answered, but its response did not carry the profile's load state.";
const MALFORMED_PROVENANCE = "The daemon answered, but its response did not carry provenance for this field.";
const MALFORMED_WRITE =
  "The daemon answered, but did not say whether anything changed. Check the profile below before assuming it did.";

/** What the row components need from the panel. Passed explicitly: one panel,
 *  one level of nesting, no indirection worth the cost. */
interface RowActions {
  onSave: (field: ProfileField, value: string) => void;
  onForget: (target: ProfileTarget, label: string) => void;
  onUndo: (fieldId: string, label: string) => void;
  busy: boolean;
}

export function OwnerProfileSection() {
  const queryClient = useQueryClient();
  const [report, setReport] = useState<ProfileReport | null>(null);
  const [forgetTarget, setForgetTarget] = useState<{ target: ProfileTarget; label: string } | null>(null);

  const profile = useQuery({
    queryKey: queryKeys.ownerProfileDocument,
    queryFn: async () => {
      const document = readProfileDocument(await gv.profile.read());
      if (!document) throw new Error(MALFORMED_DOCUMENT);
      return document;
    },
    staleTime: 10_000,
    retry: false,
  });

  const status = useQuery({
    queryKey: queryKeys.ownerProfileStatus,
    queryFn: async () => {
      const parsed = readProfileStatus(await gv.profile.status());
      if (!parsed) throw new Error(MALFORMED_STATUS);
      return parsed;
    },
    staleTime: 10_000,
    retry: false,
  });

  // Every write can move the document, its counts, and any field's provenance
  // history at once, so each one invalidates the whole owner-profile prefix.
  const invalidateProfile = () => queryClient.invalidateQueries({ queryKey: queryKeys.ownerProfile });

  const setField = useMutation({
    mutationFn: async ({ fieldId, value }: { fieldId: string; value: string }) =>
      readProfileWriteOutcome(await gv.profile.set(buildProfileSetInput(fieldId, value))),
    onSettled: () => void invalidateProfile(),
  });

  const appendLine = useMutation({
    mutationFn: async ({ section, text }: { section: string; text: string }) =>
      readProfileWriteOutcome(await gv.profile.append(buildProfileAppendInput(section, text))),
    onSettled: () => void invalidateProfile(),
  });

  const forget = useMutation({
    mutationFn: async (target: ProfileTarget) =>
      readProfileWriteOutcome(await gv.profile.forget(buildProfileForgetInput(target))),
    onSettled: () => void invalidateProfile(),
  });

  const undo = useMutation({
    mutationFn: async (fieldId: string) =>
      readProfileWriteOutcome(await gv.profile.undo(buildProfileUndoInput(fieldId))),
    onSettled: () => void invalidateProfile(),
  });

  const busy = setField.isPending || appendLine.isPending || forget.isPending || undo.isPending;

  function onSave(field: ProfileField, value: string): void {
    setField.mutate(
      { fieldId: field.fieldId, value },
      {
        onSuccess: (outcome: ProfileWriteOutcome | null) =>
          setReport(
            writeReportLine(
              outcome,
              `Saved ${field.label}. The previous value stays in the file, and Undo puts it back.`,
              MALFORMED_WRITE,
            ),
          ),
        onError: (error: unknown) => setReport({ tone: "warning", text: formatError(error) }),
      },
    );
  }

  function onAppend(section: ProfileSection, text: string): void {
    appendLine.mutate(
      { section: section.heading, text },
      {
        onSuccess: (outcome: ProfileWriteOutcome | null) =>
          setReport(writeReportLine(outcome, `Added a line to ${section.heading}.`, MALFORMED_WRITE)),
        onError: (error: unknown) => setReport({ tone: "warning", text: formatError(error) }),
      },
    );
  }

  function onUndo(fieldId: string, label: string): void {
    undo.mutate(fieldId, {
      onSuccess: (outcome: ProfileWriteOutcome | null) =>
        setReport(writeReportLine(outcome, `Restored the previous value of ${label}.`, MALFORMED_WRITE)),
      onError: (error: unknown) => setReport({ tone: "warning", text: formatError(error) }),
    });
  }

  function runForget(target: ProfileTarget, label: string): void {
    forget.mutate(target, {
      onSuccess: (outcome: ProfileWriteOutcome | null) => setReport(forgetReportLine(outcome, label)),
      onError: (error: unknown) => setReport({ tone: "warning", text: formatError(error) }),
    });
  }

  const actions: RowActions = {
    onSave,
    onForget: (target, label) => setForgetTarget({ target, label }),
    onUndo,
    busy,
  };

  const verbUnavailable =
    profile.isError && (isMethodUnavailableError(profile.error) || isMethodNotInvokableError(profile.error));

  return (
    <section className="settings-owner-profile" aria-label="Owner profile">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <UserRound size={14} aria-hidden="true" /> Owner profile
        </span>
      </div>

      <p className="settings-owner-profile__note">
        One Markdown file the daemon keeps, holding what the platform knows about you. Edit it here or by hand: your
        hand edits win and are never rewritten. Lines it learned from you carry a short note saying where it heard
        them.
      </p>

      <div className="settings-owner-profile__report" role="status" aria-live="polite" aria-atomic="true">
        {report && <span className={`settings-owner-profile__banner ${report.tone}`}>{report.text}</span>}
      </div>

      {status.isSuccess && (
        <div className="settings-owner-profile__status">
          <span className={`badge ${profileStateBadgeTone(status.data.state)}`}>
            {profileStateLabel(status.data.state)}
          </span>
          {/* Inert text, never a link and never fetched. */}
          <span className="settings-owner-profile__path">{status.data.path}</span>
          {status.data.exists === false && <span className="badge neutral">file not written yet</span>}
          {status.data.lineCount !== undefined && <span>{status.data.lineCount} lines</span>}
          {status.data.fieldCount !== undefined && <span>{status.data.fieldCount} fields</span>}
          {status.data.proseLineCount !== undefined && <span>{status.data.proseLineCount} notes</span>}
        </div>
      )}

      {status.isSuccess && status.data.invalidFields.length > 0 && (
        <div className="settings-owner-profile__invalid" role="note">
          <strong>Kept exactly as written, but not valid values</strong>
          <ul>
            {status.data.invalidFields.map((entry) => (
              <li key={entry.fieldId}>
                {entry.fieldId}: {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {profile.isPending && <SkeletonBlock variant="text" lines={5} />}

      {verbUnavailable && (
        <UnavailableState
          capability="profile.read"
          description="the connected daemon build serves no owner profile. Upgrade it to keep your profile here."
        />
      )}

      {profile.isError && !verbUnavailable && (
        <ErrorState error={profile.error} title="Owner profile unavailable" onRetry={() => void profile.refetch()} />
      )}

      {profile.isSuccess && profile.data.state === "disabled" && (
        <p className="settings-owner-profile__banner info" role="status">
          {profileDisabledLine()}
        </p>
      )}

      {profile.isSuccess && profile.data.state === "unavailable" && (
        <div className="settings-owner-profile__banner warning" role="alert">
          <p>{profileUnavailableLine(profile.data.reason, profile.data.path)}</p>
          <p>Nothing is shown below because the file could not be read, not because your profile is empty.</p>
        </div>
      )}

      {profile.isSuccess && profile.data.state === "loaded" && profile.data.sections.length === 0 && (
        <EmptyState
          icon={<UserRound size={24} aria-hidden="true" />}
          title="Your profile is loaded and empty"
          description="Nothing has been recorded yet. Tell the agent something about yourself, or add a line by hand in the file."
        />
      )}

      {profile.isSuccess && profile.data.state === "loaded" && profile.data.sections.length > 0 && (
        <div className="settings-owner-profile__sections">
          {profile.data.sections.map((section) => (
            <SectionBlock key={section.heading} section={section} actions={actions} onAppend={onAppend} />
          ))}
        </div>
      )}

      <AskTheProfile />

      <ConfirmSurface
        open={forgetTarget !== null}
        danger
        action="Forget this permanently"
        target={forgetTarget?.label ?? ""}
        blastRadius="Deletes the line from your profile file together with every earlier value kept for it, so there is nothing left to undo. No copy is retained anywhere, on any surface."
        confirmLabel={forget.isPending ? "Forgetting…" : "Forget it"}
        onConfirm={() => {
          const pending = forgetTarget;
          setForgetTarget(null);
          if (pending) runForget(pending.target, pending.label);
        }}
        onCancel={() => setForgetTarget(null)}
      />
    </section>
  );
}

// ─── Provenance disclosure: "where did you get that?", per field ─────────────

function FieldProvenance({ field, actions }: { field: ProfileField; actions: RowActions }) {
  // staleTime 0 + refetchOnMount "always": profile.* emits no wire event, so a
  // cached answer can be arbitrarily old, and this disclosure is where Undo
  // becomes clickable. Acting on a list the panel never showed is exactly the
  // thing a per-field provenance lookup exists to prevent. This component mounts
  // when the disclosure opens, so the mount refetch IS the on-open refetch.
  const query = useQuery({
    queryKey: queryKeys.ownerProfileProvenance(field.fieldId),
    queryFn: async () => {
      const answer = readProfileProvenanceAnswer(await gv.profile.provenance(field.fieldId));
      if (!answer) throw new Error(MALFORMED_PROVENANCE);
      return answer;
    },
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });

  if (query.isPending) {
    return (
      <p className="settings-owner-profile__provenance-detail" aria-busy="true">
        Looking up where this came from…
      </p>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        className="settings-owner-profile__provenance-detail"
        error={query.error}
        title="Provenance unavailable"
        onRetry={() => void query.refetch()}
      />
    );
  }

  const answer = query.data;
  const restoredIndex = mostRecentSupersededIndex(answer.superseded);
  const restored = restoredIndex === -1 ? undefined : answer.superseded[restoredIndex];
  return (
    <div className="settings-owner-profile__provenance-detail">
      {!answer.present && <p>This is not in your profile.</p>}
      {answer.present && answer.provenance && <p>{provenanceSummary(answer.provenance)}</p>}
      {answer.present && !answer.provenance && (
        <p>No provenance recorded: you wrote or edited this line by hand.</p>
      )}

      {answer.superseded.length > 0 ? (
        <>
          <p className="settings-owner-profile__hint">Earlier values, still kept in the file:</p>
          <ol className="settings-owner-profile__superseded">
            {answer.superseded.map((entry, index) => (
              <li key={`${String(entry.lineIndex)}-${entry.value}`}>
                <span className="settings-owner-profile__value">{entry.value}</span>
                {entry.provenance && <span>, {provenanceSummary(entry.provenance)}</span>}
                {entry.supersededOn && (
                  <span className="settings-owner-profile__hint"> (superseded {entry.supersededOn})</span>
                )}
                {/* The list is in document order, not recency order, so the one
                    Undo would restore is named rather than left to be guessed
                    from its position. */}
                {index === restoredIndex && (
                  <span className="settings-owner-profile__restored">restored by Undo</span>
                )}
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="settings-owner-profile__button"
            // Disabled while a refetch is in flight: the list on screen is what
            // Undo's label refers to, so it must not be actionable while that
            // list is known to be going out of date.
            disabled={actions.busy || query.isFetching || restored === undefined}
            onClick={() => actions.onUndo(field.fieldId, field.label)}
          >
            {restored === undefined
              ? "Undo"
              : `Undo: put "${restored.value}" back`}
          </button>
        </>
      ) : (
        <p className="settings-owner-profile__hint">No earlier values are kept, so there is nothing to undo.</p>
      )}
    </div>
  );
}

// ─── A mechanical field: labelled value, editable, forgettable ──────────────

function FieldRow({ field, actions }: { field: ProfileField; actions: RowActions }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.value);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const target: ProfileTarget = { kind: "field", fieldId: field.fieldId };

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    setEditing(false);
    actions.onSave(field, draft);
  }

  return (
    <div className="settings-owner-profile__field">
      <dt>{field.label}</dt>
      <dd>
        {editing ? (
          <form className="settings-owner-profile__edit" onSubmit={submit}>
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={`New value for ${field.label}`}
              autoComplete="off"
            />
            <button type="submit" className="settings-owner-profile__button" disabled={actions.busy}>
              Save
            </button>
            <button
              type="button"
              className="settings-owner-profile__button"
              onClick={() => {
                setDraft(field.value);
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <p className="settings-owner-profile__hint">
              Saving keeps the current value in the file as an earlier value, so Undo can put it back. Nothing is
              overwritten silently.
            </p>
          </form>
        ) : (
          <>
            <span className="settings-owner-profile__value">{field.value}</span>
            {field.provenance && <span>, {provenanceSummary(field.provenance)}</span>}
            {!field.valid && (
              <p className="settings-owner-profile__invalid-note" role="note">
                Kept exactly as written, but not a valid value
                {field.invalidReason ? `: ${field.invalidReason}` : " (no reason given)"}. Anything reading this
                falls back as if it were unset.
              </p>
            )}
            <div className="settings-owner-profile__row-actions">
              <button
                type="button"
                className="settings-owner-profile__button"
                onClick={() => {
                  setDraft(field.value);
                  setEditing(true);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="settings-owner-profile__button"
                aria-expanded={provenanceOpen}
                onClick={() => setProvenanceOpen((open) => !open)}
              >
                Where did you get that?
              </button>
              <button
                type="button"
                className="settings-owner-profile__button settings-owner-profile__button--danger"
                disabled={actions.busy}
                onClick={() => actions.onForget(target, field.label)}
              >
                Forget
              </button>
            </div>
          </>
        )}
        {provenanceOpen && <FieldProvenance field={field} actions={actions} />}
      </dd>
    </div>
  );
}

// ─── A prose line, rendered as the prose it is ──────────────────────────────

function ProseRow({
  section,
  line,
  actions,
}: {
  section: ProfileSection;
  line: ProfileProseLine;
  actions: RowActions;
}) {
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  // Addressed by CONTENT, never by position. The section comes from the heading
  // this row is rendered under rather than the line's own `section` field: the
  // heading is what the file reads and what profile.append matches on.
  const target: ProfileTarget = { kind: "line", section: section.heading, text: line.text };

  return (
    <li className="settings-owner-profile__line">
      <p className="settings-owner-profile__prose">
        {line.text}
        {line.provenance && <span>, {provenanceSummary(line.provenance)}</span>}
      </p>
      <div className="settings-owner-profile__row-actions">
        <button
          type="button"
          className="settings-owner-profile__button"
          aria-expanded={provenanceOpen}
          onClick={() => setProvenanceOpen((open) => !open)}
        >
          Where did you get that?
        </button>
        <button
          type="button"
          className="settings-owner-profile__button settings-owner-profile__button--danger"
          disabled={actions.busy}
          onClick={() => actions.onForget(target, line.text)}
        >
          Forget
        </button>
      </div>
      {provenanceOpen && (
        <div className="settings-owner-profile__provenance-detail">
          {line.provenance ? (
            <p>{provenanceSummary(line.provenance)}</p>
          ) : (
            <p>No provenance recorded: you wrote or edited this line by hand.</p>
          )}
          <p className="settings-owner-profile__hint">
            That is the whole answer for a note: notes keep no earlier versions, so there is nothing further to look
            up and nothing to undo.
          </p>
        </div>
      )}
    </li>
  );
}

// ─── A section ──────────────────────────────────────────────────────────────

function SectionBlock({
  section,
  actions,
  onAppend,
}: {
  section: ProfileSection;
  actions: RowActions;
  onAppend: (section: ProfileSection, text: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const thirdParty = sectionHoldsThirdPartyData(section);
  const empty = section.fields.length === 0 && section.prose.length === 0;

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setAdding(false);
    setDraft("");
    onAppend(section, text);
  }

  return (
    <section
      className="settings-owner-profile__section"
      data-tier={section.tier}
      data-third-party={thirdParty ? "true" : undefined}
      aria-label={section.heading}
    >
      <div className="settings-owner-profile__section-head">
        <h3>{section.heading}</h3>
        <span className={`badge ${section.tier === "open" ? "neutral" : "info"}`}>
          {section.tier === "open" ? "Open" : "Closed"}
        </span>
      </div>
      <p className="settings-owner-profile__hint">{tierNote(section.tier)}</p>

      {thirdParty && (
        <p className="settings-owner-profile__containment" role="note">
          These are facts about other people, who never agreed to be in a database. This surface keeps them out of
          logs, exports and diagnostics, and never copies them into anything it sends. They are shown here as plain
          text, for you.
        </p>
      )}

      {section.fields.length > 0 && (
        <dl className="settings-owner-profile__fields">
          {section.fields.map((field) => (
            <FieldRow key={field.fieldId} field={field} actions={actions} />
          ))}
        </dl>
      )}

      {section.prose.length > 0 && (
        <ul className="settings-owner-profile__lines">
          {section.prose.map((line) => (
            <ProseRow key={line.lineIndex} section={section} line={line} actions={actions} />
          ))}
        </ul>
      )}

      {empty && <p className="settings-owner-profile__hint">Nothing recorded in this section.</p>}

      {adding ? (
        <form className="settings-owner-profile__edit" onSubmit={submit}>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={`New line in ${section.heading}`}
            autoComplete="off"
          />
          <button
            type="submit"
            className="settings-owner-profile__button"
            disabled={actions.busy || draft.trim().length === 0}
          >
            Add
          </button>
          <button
            type="button"
            className="settings-owner-profile__button"
            onClick={() => {
              setDraft("");
              setAdding(false);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="settings-owner-profile__button" onClick={() => setAdding(true)}>
          Add a line to {section.heading}
        </button>
      )}
    </section>
  );
}

// ─── The two named lookups: profile.get and profile.person ──────────────────

function AskTheProfile() {
  const [fieldInput, setFieldInput] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");

  const field = useQuery({
    queryKey: queryKeys.ownerProfileField(fieldId),
    queryFn: async () => {
      const answer = readProfileFieldAnswer(await gv.profile.get(fieldId));
      if (!answer) throw new Error("The daemon answered, but its response did not carry that field's lookup.");
      return answer;
    },
    enabled: fieldId.length > 0,
    retry: false,
  });

  const person = useQuery({
    queryKey: queryKeys.ownerProfilePerson(name),
    queryFn: async () => {
      const answer = readProfilePersonAnswer(await gv.profile.person(name));
      if (!answer) throw new Error("The daemon answered, but its response did not carry a People lookup.");
      return answer;
    },
    enabled: name.length > 0,
    retry: false,
  });

  return (
    <section className="settings-owner-profile__ask" aria-label="Ask the profile">
      <h3>Ask the profile</h3>
      <p className="settings-owner-profile__hint">
        What a consumer sees when it asks by name: one field, or one person&apos;s lines. Both answer honestly when
        there is nothing recorded, rather than inventing a value, and a closed-tier read comes back with the
        disclosure you would be shown.
      </p>

      <form
        className="settings-owner-profile__edit"
        onSubmit={(event) => {
          event.preventDefault();
          setFieldId(fieldInput.trim());
        }}
      >
        <input
          type="text"
          value={fieldInput}
          onChange={(event) => setFieldInput(event.target.value)}
          placeholder="commerce.shippingAddress"
          aria-label="Field id to look up"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="settings-owner-profile__button" disabled={!fieldInput.trim()}>
          Look up field
        </button>
      </form>

      {field.isFetching && <p className="settings-owner-profile__hint">Looking that up…</p>}
      {field.isError && (
        // The daemon's refusal for an unknown id NAMES every valid field id, so
        // it is relayed verbatim rather than replaced with a shorter sentence
        // this client would have to keep in sync with the registry.
        <ErrorState error={field.error} title="That lookup did not work" />
      )}
      {field.isSuccess && (
        <div className="settings-owner-profile__answer">
          {!field.data.present && <p>Not recorded: {field.data.fieldId} is not in your profile.</p>}
          {field.data.present && field.data.field && (
            <p>
              <span className="settings-owner-profile__value">{field.data.field.value}</span>
              {field.data.section && (
                <span className="settings-owner-profile__hint"> (under {field.data.section})</span>
              )}
              {field.data.field.provenance && <span>, {provenanceSummary(field.data.field.provenance)}</span>}
            </p>
          )}
          {field.data.disclosure && (
            <p className="settings-owner-profile__hint">Disclosed as: {field.data.disclosure}</p>
          )}
        </div>
      )}

      <form
        className="settings-owner-profile__edit"
        onSubmit={(event) => {
          event.preventDefault();
          setName(nameInput.trim());
        }}
      >
        <input
          type="text"
          value={nameInput}
          onChange={(event) => setNameInput(event.target.value)}
          placeholder="A name from your People section"
          aria-label="Person to look up"
          autoComplete="off"
        />
        <button type="submit" className="settings-owner-profile__button" disabled={!nameInput.trim()}>
          Look up person
        </button>
      </form>
      <p className="settings-owner-profile__hint">
        This takes a name by design and has no list-everyone counterpart: a People line can reach outbound content
        only when you named that person, and a lookup that only takes a name is what makes that structural.
      </p>

      {person.isFetching && <p className="settings-owner-profile__hint">Looking that up…</p>}
      {person.isError && <ErrorState error={person.error} title="That lookup did not work" />}
      {person.isSuccess && (
        <div className="settings-owner-profile__answer" data-third-party="true">
          {person.data.lines.length === 0 ? (
            <p>Nothing recorded about {person.data.name}.</p>
          ) : (
            <ul className="settings-owner-profile__lines">
              {person.data.lines.map((line) => (
                <li key={line.lineIndex} className="settings-owner-profile__prose">
                  {line.text}
                  {line.provenance && <span>, {provenanceSummary(line.provenance)}</span>}
                </li>
              ))}
            </ul>
          )}
          {person.data.disclosure && (
            <p className="settings-owner-profile__hint">Disclosed as: {person.data.disclosure}</p>
          )}
        </div>
      )}
    </section>
  );
}
