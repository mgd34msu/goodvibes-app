// Per-message artifacts slide-over: fenced code blocks extracted from the
// message + file/artifact attachments, rendered into the shared PeekPanel.
// Attachments with a real artifactId link to the daemon's content route.
// Ported from goodvibes-webui src/views/chat/ArtifactsPanel.tsx.

import { useCallback, useState } from "react";
import { Check, Copy, Download, FileText } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { highlightCode } from "../../lib/highlight.ts";
import { usePeek } from "../../components/PeekPanel.tsx";
import { useToast } from "../../lib/toast.ts";
import { downloadContent } from "./chat-local.ts";
import { messageText } from "./message-utils.ts";
import type { ChatMessage } from "./types.ts";

export interface CodeArtifact {
  language: string;
  code: string;
  index: number;
}

export interface FileArtifact {
  id: string;
  label: string;
  mimeType: string;
}

/** Extract fenced code blocks from raw markdown content. */
export function extractCodeBlocks(content: string): CodeArtifact[] {
  const results: CodeArtifact[] = [];
  const fenceRe = /^```([^\n]*)\n([\s\S]*?)^```/gm;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = fenceRe.exec(content)) !== null) {
    results.push({ language: (match[1] ?? "").trim(), code: match[2] ?? "", index: index++ });
  }
  return results;
}

function readString(value: unknown, keys: string[]): string {
  const record = value as Record<string, unknown> | null;
  for (const key of keys) {
    const item = record?.[key];
    if (typeof item === "string" && item) return item;
  }
  return "";
}

function extractFileArtifacts(message: ChatMessage): FileArtifact[] {
  const items: FileArtifact[] = [];
  for (const source of [message.attachments ?? [], message.artifacts ?? []]) {
    for (const entry of source) {
      items.push({
        id: readString(entry, ["artifactId", "id"]),
        label: readString(entry, ["label", "filename", "name"]) || "Attachment",
        mimeType: readString(entry, ["mimeType", "type"]) || "application/octet-stream",
      });
    }
  }
  return items;
}

function ArtifactCodeBlock({ artifact, onCopy }: { artifact: CodeArtifact; onCopy: () => void }) {
  const [copied, setCopied] = useState(false);
  const visibleCode = artifact.code.endsWith("\n") ? artifact.code.slice(0, -1) : artifact.code;
  const highlighted = highlightCode(visibleCode, artifact.language);
  const displayLanguage = artifact.language || highlighted.language;

  function handleCopy(): void {
    void navigator.clipboard?.writeText(artifact.code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
      onCopy();
    });
  }

  function handleSave(): void {
    const ext = displayLanguage || "txt";
    downloadContent(`block-${artifact.index + 1}.${ext}`, "text/plain", artifact.code);
  }

  return (
    <div className="artifact-code-block">
      <div className="artifact-code-header">
        <span className="artifact-code-label">{displayLanguage || "code"}</span>
        <div className="artifact-code-actions">
          <button type="button" className="artifact-code-copy" onClick={handleCopy} aria-label="Copy code">
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
          <button type="button" className="artifact-code-copy" onClick={handleSave} aria-label="Save code block to file">
            <Download size={13} aria-hidden="true" />
            <span>Save</span>
          </button>
        </div>
      </div>
      <pre className="artifact-code-pre">
        <code dangerouslySetInnerHTML={{ __html: highlighted.html }} />
      </pre>
    </div>
  );
}

function ArtifactFileItem({ artifact }: { artifact: FileArtifact }) {
  const hasWireId = Boolean(artifact.id) && !artifact.id.startsWith("local-");
  return (
    <div className="artifact-file-item">
      <FileText size={16} className="artifact-file-icon" aria-hidden="true" />
      <div className="artifact-file-info">
        <span className="artifact-file-label">{artifact.label}</span>
        <span className="artifact-file-mime">{artifact.mimeType}</span>
      </div>
      {hasWireId && (
        <a
          className="artifact-file-open"
          href={gv.artifacts.contentPath(artifact.id)}
          download={artifact.label}
          aria-label={`Download ${artifact.label}`}
        >
          <Download size={13} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

function ArtifactsPanelContent({
  codeBlocks,
  fileArtifacts,
  onCopy,
}: {
  codeBlocks: CodeArtifact[];
  fileArtifacts: FileArtifact[];
  onCopy: () => void;
}) {
  if (!codeBlocks.length && !fileArtifacts.length) {
    return (
      <div className="artifacts-empty">
        <p>No artifacts found in this message.</p>
      </div>
    );
  }
  return (
    <div className="artifacts-panel-content">
      {codeBlocks.length > 0 && (
        <section className="artifacts-section">
          <h3 className="artifacts-section-title">Code blocks</h3>
          <div className="artifacts-code-list">
            {codeBlocks.map((block) => (
              <ArtifactCodeBlock key={block.index} artifact={block} onCopy={onCopy} />
            ))}
          </div>
        </section>
      )}
      {fileArtifacts.length > 0 && (
        <section className="artifacts-section">
          <h3 className="artifacts-section-title">Attachments</h3>
          <div className="artifacts-file-list">
            {fileArtifacts.map((file, index) => (
              <ArtifactFileItem key={file.id || `${file.label}-${index}`} artifact={file} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** openArtifacts(message) — opens the PeekPanel with the message's extracted
 * code blocks and attachments. Needs PeekProvider + ToastProvider above. */
export function useArtifactsPanel(): { openArtifacts: (message: ChatMessage) => void } {
  const { open } = usePeek();
  const { toast } = useToast();

  const openArtifacts = useCallback(
    (message: ChatMessage): void => {
      const codeBlocks = extractCodeBlocks(messageText(message));
      const fileArtifacts = extractFileArtifacts(message);
      const total = codeBlocks.length + fileArtifacts.length;
      open({
        title: total === 1 ? "1 Artifact" : `${total} Artifacts`,
        content: (
          <ArtifactsPanelContent
            codeBlocks={codeBlocks}
            fileArtifacts={fileArtifacts}
            onCopy={() => toast({ title: "Copied to clipboard", tone: "success", durationMs: 2000 })}
          />
        ),
      });
    },
    [open, toast],
  );

  return { openArtifacts };
}
