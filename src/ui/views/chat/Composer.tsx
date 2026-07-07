// The chat composer: multi-line grow, Enter send / Shift+Enter newline,
// attachment chips (uploaded files + @-mentioned existing artifacts),
// drag-drop / paste-image / big-paste-to-chip, slash-command hints, input
// history (ArrowUp/Down + Ctrl+R reverse search), per-session provider/model
// picker (daemon-owned via session update), reasoning effort, voice controls,
// and the 30 msg/min send-budget indicator. Ported and extended from
// goodvibes-webui src/views/chat/Composer.tsx.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { AtSign, Check, ChevronDown, Gauge, Paperclip, Send, Volume2, VolumeX, X } from "lucide-react";
import { gv, listFrom } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError } from "../../lib/errors.ts";
import { bestId, bestTitle, firstString } from "../../lib/wire.ts";
import { MicButton } from "./MicButton.tsx";
import { readInputHistory } from "./chat-local.ts";
import { SEND_BUDGET_PER_MINUTE, type AttachedArtifactRef, type SendBudget } from "./useChatSend.ts";
import { modelOptionsFromProvider, type ModelOption, type ProviderOption } from "./provider-models.ts";

export interface SlashCommandHint {
  name: string;
  description: string;
}

export interface ReasoningControl {
  value: string;
  pending: boolean;
  onChange: (value: string) => void;
}

export interface ComposerProps {
  draft: string;
  attachedFiles: File[];
  artifactRefs: AttachedArtifactRef[];
  isSendPending: boolean;
  sendBudget: SendBudget;
  /** Error rows rendered above the box (send/turn/rename/model errors). */
  errorRows: (string | { error: unknown })[];
  providerOptions: ProviderOption[];
  sessionProvider: string;
  sessionModel: string;
  modelPickerPending: boolean;
  /** null while providers are loading; honest note handled by parent. */
  onSelectModel: (providerId: string, modelId: string) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  slashCommands: readonly SlashCommandHint[];
  reasoning: ReasoningControl | null;
  alwaysSpeak: boolean;
  onToggleAlwaysSpeak: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFilesAdded: (files: File[]) => void;
  onRemoveAttachedFile: (index: number) => void;
  onAddArtifactRef: (ref: AttachedArtifactRef) => void;
  onRemoveArtifactRef: (index: number) => void;
}

// ─── Attachment chips ────────────────────────────────────────────────────────

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function AttachmentChip({ file, index, onRemove }: { file: File; index: number; onRemove: (index: number) => void }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImageFile(file)) return undefined;
    const url = URL.createObjectURL(file);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <span className="composer-attachment">
      {thumbUrl ? (
        <img src={thumbUrl} alt="" aria-hidden="true" className="composer-attachment-thumb" />
      ) : (
        <Paperclip size={13} aria-hidden="true" />
      )}
      <span className="composer-attachment-name">{file.name}</span>
      <button
        type="button"
        title={`Remove ${file.name}`}
        aria-label={`Remove attachment ${file.name}`}
        onClick={() => onRemove(index)}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  );
}

// ─── Model picker (provider-first, model-second, daemon-owned selection) ─────

interface ModelPickerProps {
  providerOptions: ProviderOption[];
  sessionProvider: string;
  sessionModel: string;
  pending: boolean;
  onSelectModel: (providerId: string, modelId: string) => void;
}

function ModelPicker({ providerOptions, sessionProvider, sessionModel, pending, onSelectModel }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [expandedProviderId, setExpandedProviderId] = useState("");
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const effectiveExpanded = expandedProviderId || sessionProvider || providerOptions[0]?.id || "";
  const expandedProvider = providerOptions.find((p) => p.id === effectiveExpanded);
  const models: ModelOption[] = expandedProvider ? modelOptionsFromProvider(expandedProvider.value) : [];

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: PointerEvent) {
      if (triggerRef.current?.contains(event.target as Node)) return;
      if (popoverRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const triggerLabel = pending
    ? "Switching…"
    : sessionModel
      ? `${sessionProvider ? `${sessionProvider} · ` : ""}${sessionModel}`
      : sessionProvider || "Daemon default";

  return (
    <div className="composer-route">
      <button
        ref={triggerRef}
        type="button"
        className="composer-model-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={`Model for this chat: ${triggerLabel}`}
        data-pending={pending ? "true" : undefined}
        disabled={!providerOptions.length}
        title={
          providerOptions.length
            ? "Provider and model for this chat session (stored on the daemon)"
            : "No providers reported by the daemon"
        }
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="composer-model-label">{triggerLabel}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="listbox"
          aria-label="Select provider and model"
          className="composer-model-popover"
          tabIndex={-1}
        >
          {providerOptions.map((provider) => {
            const isExpanded = provider.id === effectiveExpanded;
            return (
              <div key={provider.id} className="composer-model-popover-section">
                <button
                  type="button"
                  className="composer-model-option composer-model-provider-btn"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedProviderId(provider.id)}
                >
                  <span className="composer-model-section-label">{provider.label}</span>
                </button>
                {isExpanded &&
                  (models.length ? (
                    models.map((model) => {
                      const selected = model.providerId === sessionProvider && model.modelId === sessionModel;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className="composer-model-option"
                          onClick={() => {
                            onSelectModel(model.providerId, model.modelId);
                            setOpen(false);
                            triggerRef.current?.focus();
                          }}
                        >
                          <span className="composer-model-option-label">{model.label}</span>
                          {selected && <Check size={14} className="composer-model-option-check" aria-hidden="true" />}
                        </button>
                      );
                    })
                  ) : (
                    <p className="composer-model-none">This provider reports no model list — the daemon default applies.</p>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Slash menu ──────────────────────────────────────────────────────────────

function SlashMenu({
  commands,
  activeIndex,
  onSelect,
  menuId,
  optionIdPrefix,
}: {
  commands: readonly SlashCommandHint[];
  activeIndex: number;
  onSelect: (name: string) => void;
  menuId: string;
  optionIdPrefix: string;
}) {
  if (!commands.length) return null;
  return (
    <div id={menuId} role="listbox" aria-label="Slash commands" className="composer-slash-menu">
      <div className="composer-slash-menu-label">Commands</div>
      {commands.map((cmd, i) => (
        <button
          key={cmd.name}
          id={`${optionIdPrefix}-${i}`}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className="composer-slash-item"
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(cmd.name);
          }}
        >
          <span className="composer-slash-item-name">/{cmd.name}</span>
          <span className="composer-slash-item-desc">{cmd.description}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Composer ────────────────────────────────────────────────────────────────

const BIG_PASTE_LINES = 8;

export function Composer({
  draft,
  attachedFiles,
  artifactRefs,
  isSendPending,
  sendBudget,
  errorRows,
  providerOptions,
  sessionProvider,
  sessionModel,
  modelPickerPending,
  onSelectModel,
  composerRef,
  fileInputRef,
  slashCommands,
  reasoning,
  alwaysSpeak,
  onToggleAlwaysSpeak,
  onDraftChange,
  onSubmit,
  onComposerKeyDown,
  onFilesAdded,
  onRemoveAttachedFile,
  onAddArtifactRef,
  onRemoveArtifactRef,
}: ComposerProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [historySearch, setHistorySearch] = useState<string | null>(null);
  const historyIndexRef = useRef(-1);
  const pasteCounter = useRef(0);
  const slashMenuId = useId();
  const mentionMenuId = useId();
  const slashOptionIdPrefix = `${slashMenuId}-opt`;

  // Multi-line grow (44–160px).
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "0px";
    composer.style.height = `${Math.min(Math.max(composer.scrollHeight, 44), 160)}px`;
  }, [draft, composerRef]);

  // ── Slash menu state ────────────────────────────────────────────────────
  const showSlashMenu = !slashDismissed && slashCommands.length > 0 && draft.startsWith("/") && !draft.includes(" ");
  const filteredSlashCommands = showSlashMenu
    ? draft.length > 1
      ? slashCommands.filter((cmd) => cmd.name.toLowerCase().startsWith(draft.slice(1).toLowerCase()))
      : slashCommands
    : [];

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [filteredSlashCommands.length]);

  useEffect(() => {
    if (!draft.startsWith("/") || draft.includes(" ")) setSlashDismissed(false);
  }, [draft]);

  // ── @-mention artifact attach ───────────────────────────────────────────
  const updateMentionState = useCallback(
    (value: string) => {
      const caret = composerRef.current?.selectionStart ?? value.length;
      const before = value.slice(0, caret);
      const match = /(^|\s)@([\w./-]*)$/.exec(before);
      setMentionQuery(match ? (match[2] ?? "") : null);
      setMentionActiveIndex(0);
    },
    [composerRef],
  );

  const mentionArtifacts = useQuery({
    queryKey: [...queryKeys.artifacts, "mention-picker"],
    queryFn: () => gv.artifacts.list({ limit: 50 }),
    enabled: mentionQuery !== null,
    staleTime: 30_000,
    retry: false,
  });

  const mentionItems =
    mentionQuery === null
      ? []
      : listFrom(mentionArtifacts.data, ["artifacts", "items", "data", "results"])
          .map((artifact) => ({
            artifactId: bestId(artifact),
            label:
              firstString(artifact, ["filename", "label", "name", "title"]) || bestTitle(artifact, bestId(artifact)),
          }))
          .filter((item) => item.artifactId)
          .filter((item) => !mentionQuery || item.label.toLowerCase().includes(mentionQuery.toLowerCase()))
          .slice(0, 8);

  const applyMention = useCallback(
    (item: { artifactId: string; label: string }) => {
      const caret = composerRef.current?.selectionStart ?? draft.length;
      const before = draft.slice(0, caret).replace(/(^|\s)@[\w./-]*$/, "$1");
      onDraftChange(before + draft.slice(caret));
      onAddArtifactRef({ artifactId: item.artifactId, label: item.label });
      setMentionQuery(null);
      composerRef.current?.focus();
    },
    [composerRef, draft, onAddArtifactRef, onDraftChange],
  );

  // ── Drag-and-drop ───────────────────────────────────────────────────────
  const handleDragOver = useCallback((event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files")) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsDragOver(false);
      const files = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
      if (files.length) onFilesAdded(files);
    },
    [onFilesAdded],
  );

  // ── Paste: images → attachments; big text paste → paste chip ───────────
  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const images = Array.from(clipboard.items)
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (images.length) {
        event.preventDefault();
        onFilesAdded(images);
        return;
      }
      const text = clipboard.getData("text/plain");
      if (text && text.split("\n").length > BIG_PASTE_LINES) {
        // Paste normalization: a wall of text becomes a chip, not a wall.
        event.preventDefault();
        pasteCounter.current += 1;
        onFilesAdded([new File([text], `paste-${pasteCounter.current}.txt`, { type: "text/plain" })]);
      }
    },
    [onFilesAdded],
  );

  // ── Input history (ArrowUp/Down recall, Ctrl+R reverse search) ─────────
  const recallHistory = useCallback(
    (direction: -1 | 1) => {
      const history = readInputHistory();
      if (!history.length) return false;
      let index = historyIndexRef.current;
      if (index === -1 && direction === -1) index = history.length - 1;
      else index += direction;
      if (index < 0 || index >= history.length) {
        if (index >= history.length) {
          historyIndexRef.current = -1;
          onDraftChange("");
          return true;
        }
        return false;
      }
      historyIndexRef.current = index;
      onDraftChange(history[index] ?? "");
      return true;
    },
    [onDraftChange],
  );

  const historyMatches =
    historySearch !== null
      ? readInputHistory()
          .filter((entry) => entry.toLowerCase().includes(historySearch.toLowerCase()))
          .slice(-8)
          .reverse()
      : [];

  // ── Keyboard routing ────────────────────────────────────────────────────
  const handleTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl+R reverse search over input history.
      if (event.key.toLowerCase() === "r" && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
        event.preventDefault();
        setHistorySearch((current) => (current === null ? "" : null));
        return;
      }

      if (mentionQuery !== null && mentionItems.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setMentionActiveIndex((i) => Math.min(mentionItems.length - 1, i + 1));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setMentionActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const selected = mentionItems[mentionActiveIndex];
          if (selected) {
            event.preventDefault();
            applyMention(selected);
            return;
          }
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setMentionQuery(null);
          return;
        }
      }

      if (showSlashMenu && filteredSlashCommands.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashActiveIndex((i) => Math.min(filteredSlashCommands.length - 1, i + 1));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const selected = filteredSlashCommands[slashActiveIndex];
          if (selected) {
            event.preventDefault();
            onDraftChange(`/${selected.name} `);
            return;
          }
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSlashDismissed(true);
          return;
        }
      }

      // History recall only when the caret can't move within the draft.
      const caret = event.currentTarget.selectionStart ?? 0;
      if (event.key === "ArrowUp" && (draft === "" || caret === 0) && !event.shiftKey) {
        if (recallHistory(-1)) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === "ArrowDown" && historyIndexRef.current !== -1 && !event.shiftKey) {
        if (recallHistory(1)) {
          event.preventDefault();
          return;
        }
      }

      onComposerKeyDown(event);
    },
    [
      applyMention,
      draft,
      filteredSlashCommands,
      mentionActiveIndex,
      mentionItems,
      mentionQuery,
      onComposerKeyDown,
      onDraftChange,
      recallHistory,
      showSlashMenu,
      slashActiveIndex,
    ],
  );

  const handleDraftChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      historyIndexRef.current = -1;
      onDraftChange(event.target.value);
      updateMentionState(event.target.value);
    },
    [onDraftChange, updateMentionState],
  );

  const handleFileSelection = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length) onFilesAdded(files);
      event.target.value = "";
    },
    [onFilesAdded],
  );

  const handleTranscript = useCallback(
    (text: string) => {
      if (!text) return;
      onDraftChange(draft.trim() ? `${draft.trimEnd()} ${text}` : text);
      composerRef.current?.focus();
    },
    [composerRef, draft, onDraftChange],
  );

  const budgetWarning = sendBudget.remaining <= 5;
  const sendDisabled = isSendPending || sendBudget.blocked || (!draft.trim() && !attachedFiles.length && !artifactRefs.length);

  return (
    <form
      className="composer"
      onSubmit={onSubmit}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {errorRows.map((row, index) => {
        const text = typeof row === "string" ? row : formatError(row.error);
        return text ? (
          <div key={index} className="composer-error" role="alert">
            {text}
          </div>
        ) : null;
      })}

      {(attachedFiles.length > 0 || artifactRefs.length > 0) && (
        <div className="composer-attachments">
          {attachedFiles.map((file, index) => (
            <AttachmentChip
              key={`${file.name}-${file.lastModified}-${index}`}
              file={file}
              index={index}
              onRemove={onRemoveAttachedFile}
            />
          ))}
          {artifactRefs.map((ref, index) => (
            <span key={`${ref.artifactId}-${index}`} className="composer-attachment composer-attachment--ref">
              <AtSign size={13} aria-hidden="true" />
              <span className="composer-attachment-name">{ref.label}</span>
              <button
                type="button"
                title={`Remove ${ref.label}`}
                aria-label={`Remove referenced artifact ${ref.label}`}
                onClick={() => onRemoveArtifactRef(index)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {historySearch !== null && (
        <div className="composer-history-search" role="dialog" aria-label="Search input history">
          <input
            autoFocus
            value={historySearch}
            placeholder="Reverse search input history…"
            aria-label="Reverse search input history"
            onChange={(event) => setHistorySearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setHistorySearch(null);
                composerRef.current?.focus();
              }
              if (event.key === "Enter" && historyMatches[0]) {
                event.preventDefault();
                onDraftChange(historyMatches[0]);
                setHistorySearch(null);
                composerRef.current?.focus();
              }
            }}
          />
          <div className="composer-history-matches">
            {historyMatches.length ? (
              historyMatches.map((entry, index) => (
                <button
                  key={`${index}-${entry.slice(0, 24)}`}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onDraftChange(entry);
                    setHistorySearch(null);
                    composerRef.current?.focus();
                  }}
                >
                  {entry.length > 90 ? `${entry.slice(0, 90)}…` : entry}
                </button>
              ))
            ) : (
              <span className="composer-history-empty">No matching history</span>
            )}
          </div>
        </div>
      )}

      <div className="composer-box" data-drag-over={isDragOver ? "true" : undefined}>
        {showSlashMenu && filteredSlashCommands.length > 0 && (
          <SlashMenu
            commands={filteredSlashCommands}
            activeIndex={slashActiveIndex}
            onSelect={(name) => {
              onDraftChange(`/${name} `);
              composerRef.current?.focus();
            }}
            menuId={slashMenuId}
            optionIdPrefix={slashOptionIdPrefix}
          />
        )}

        {mentionQuery !== null && (
          <div id={mentionMenuId} role="listbox" aria-label="Attach an artifact" className="composer-mention-menu">
            <div className="composer-slash-menu-label">Attach artifact</div>
            {mentionArtifacts.isLoading ? (
              <span className="composer-mention-note">Loading artifacts…</span>
            ) : mentionArtifacts.isError ? (
              <span className="composer-mention-note">Artifacts unavailable: {formatError(mentionArtifacts.error)}</span>
            ) : mentionItems.length ? (
              mentionItems.map((item, index) => (
                <button
                  key={item.artifactId}
                  type="button"
                  role="option"
                  aria-selected={index === mentionActiveIndex}
                  className="composer-slash-item"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyMention(item);
                  }}
                >
                  <span className="composer-slash-item-name">{item.label}</span>
                  <span className="composer-slash-item-desc">{item.artifactId}</span>
                </button>
              ))
            ) : (
              <span className="composer-mention-note">No artifacts match “{mentionQuery}”.</span>
            )}
          </div>
        )}

        <textarea
          ref={composerRef}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={handleTextareaKeyDown}
          onPaste={handlePaste}
          placeholder="Message GoodVibes — Enter to send, Shift+Enter for a newline, / for commands, @ to attach an artifact"
          aria-label="Message GoodVibes"
          aria-autocomplete={showSlashMenu || mentionQuery !== null ? "list" : undefined}
          aria-controls={
            mentionQuery !== null ? mentionMenuId : showSlashMenu && filteredSlashCommands.length > 0 ? slashMenuId : undefined
          }
          rows={1}
        />
        <input ref={fileInputRef} type="file" hidden multiple onChange={handleFileSelection} />

        <div className="composer-toolbar">
          <div className="composer-tools">
            <button
              type="button"
              className="composer-tool"
              title="Attach files"
              aria-label="Attach files"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSendPending}
            >
              <Paperclip size={15} aria-hidden="true" />
            </button>
            <MicButton onTranscript={handleTranscript} disabled={isSendPending} />
            <button
              type="button"
              className={alwaysSpeak ? "composer-tool is-active" : "composer-tool"}
              title={alwaysSpeak ? "Always speak replies: on" : "Always speak replies: off"}
              aria-label={alwaysSpeak ? "Turn off always-speak" : "Turn on always-speak"}
              aria-pressed={alwaysSpeak}
              onClick={onToggleAlwaysSpeak}
            >
              {alwaysSpeak ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
            </button>
            {reasoning && (
              <label className="composer-reasoning" title="Reasoning effort (provider.reasoningEffort, shared config)">
                <Gauge size={13} aria-hidden="true" />
                <select
                  aria-label="Reasoning effort"
                  value={reasoning.value}
                  disabled={reasoning.pending}
                  onChange={(event) => reasoning.onChange(event.target.value)}
                >
                  <option value="">effort: default</option>
                  <option value="instant">instant</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
            )}
          </div>

          <ModelPicker
            providerOptions={providerOptions}
            sessionProvider={sessionProvider}
            sessionModel={sessionModel}
            pending={modelPickerPending}
            onSelectModel={onSelectModel}
          />

          <div className="composer-actions">
            <span
              className={`composer-budget${budgetWarning ? " is-warning" : ""}${sendBudget.blocked ? " is-blocked" : ""}`}
              title={`Companion chat allows ${SEND_BUDGET_PER_MINUTE} messages per minute per client. ${sendBudget.remaining} left in the current window.`}
              role="status"
            >
              {sendBudget.blocked
                ? "rate limit reached — wait a moment"
                : budgetWarning
                  ? `${sendBudget.remaining}/${SEND_BUDGET_PER_MINUTE} sends left this minute`
                  : ""}
            </span>
            <button
              type="submit"
              className="send-button"
              title={sendBudget.blocked ? "Send budget reached (30 msg/min)" : "Send message (Enter)"}
              aria-label="Send message"
              data-pending={isSendPending ? "true" : undefined}
              disabled={sendDisabled}
            >
              <Send size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
