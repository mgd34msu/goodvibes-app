// Markdown renderer (GFM) with highlighted code blocks, copy button, and
// UI-only line numbers (numbers live in a separate span and are never part
// of copied text). Ported from goodvibes-webui src/components/
// MarkdownMessage.tsx, minus remark-breaks (not a dependency here).

import { isValidElement, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { highlightCode } from "../lib/highlight.ts";

function codeElementFromChildren(children: ReactNode) {
  const child = Array.isArray(children) ? children[0] : children;
  return isValidElement<{ className?: string; children?: ReactNode }>(child) ? child : null;
}

function languageFromCodeChild(children: ReactNode): string {
  const child = codeElementFromChildren(children);
  if (!child) return "";
  const className = child.props.className ?? "";
  const match = /language-([\w-]+)/.exec(className);
  return match?.[1] ?? "";
}

function textFromReactNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromReactNode).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromReactNode(node.props.children);
  return "";
}

function codeTextFromChildren(children: ReactNode): string {
  const child = codeElementFromChildren(children);
  return textFromReactNode(child?.props.children ?? children);
}

interface CodeBlockProps {
  children: ReactNode;
  lineNumbers: boolean;
}

function CodeBlock({ children, lineNumbers }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const language = languageFromCodeChild(children);
  const code = codeTextFromChildren(children);
  const visibleCode = code.endsWith("\n") ? code.slice(0, -1) : code;
  const highlighted = highlightCode(visibleCode, language);
  const highlightedLines = highlighted.html.split("\n");
  const displayLanguage = language || highlighted.language;

  async function copyCode() {
    if (!code) return;
    await navigator.clipboard?.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
  }

  return (
    <div className={lineNumbers ? "markdown-code-block numbered" : "markdown-code-block"}>
      <div className="markdown-code-header">
        <div className="markdown-code-label">{displayLanguage || "code"}</div>
        <button
          className="markdown-code-copy"
          type="button"
          onClick={() => void copyCode()}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {lineNumbers ? (
        <pre className="markdown-code-pre">
          <code>
            {highlightedLines.map((line, index) => (
              <span className="markdown-code-line" key={index}>
                <span className="markdown-code-line-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span
                  className="markdown-code-line-content"
                  dangerouslySetInnerHTML={{ __html: line || "&nbsp;" }}
                />
              </span>
            ))}
          </code>
        </pre>
      ) : (
        <pre className="markdown-code-pre">
          <code dangerouslySetInnerHTML={{ __html: highlighted.html }} />
        </pre>
      )}
    </div>
  );
}

export interface MarkdownMessageProps {
  content: string;
  /** UI-only line numbers on code blocks — never copied. */
  lineNumbers?: boolean;
}

export function MarkdownMessage({ content, lineNumbers = false }: MarkdownMessageProps) {
  return (
    <div className="markdown-message">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => <CodeBlock lineNumbers={lineNumbers}>{children}</CodeBlock>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
