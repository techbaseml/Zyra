import React, { memo, useDeferredValue, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { copyText } from "../lib/api";
function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node))
    return textOf(node.props.children);
  return "";
}
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  const code = React.isValidElement<{ className?: string }>(children)
    ? children.props.className
    : "";
  const language = code?.match(/language-([^ ]+)/)?.[1] || "code";
  return (
    <div className="code-block">
      <div className="code-header">
        <span>{language}</span>
        <button
          onClick={async () => {
            try {
              await copyText(textOf(children));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setError("Select the code to copy it.");
            }
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}{" "}
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre>{children}</pre>
      {error && <small role="status">{error}</small>}
    </div>
  );
}
export default memo(function Markdown({ text }: { text: string }) {
  const visibleText = useDeferredValue(text);
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="image-omitted">
              [Image: {alt || "external image"} — remote images are not loaded]
            </span>
          ),
        }}
      >
        {visibleText}
      </ReactMarkdown>
    </div>
  );
});
