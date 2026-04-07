import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Check, Copy } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="group relative rounded-lg overflow-hidden border border-gray-200 dark:border-white/10 my-3">
      <div className="flex items-center justify-between bg-gray-100 dark:bg-[#2a2a2a] px-3 py-1.5 text-xs">
        <span className="text-gray-500 dark:text-gray-400 font-mono">
          {language || "text"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          padding: "12px 16px",
          fontSize: "13px",
          lineHeight: "1.6",
          background: "#1e1e1e",
        }}
        wrapLongLines
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

export default function MarkdownRenderer({
  content,
  className = "",
}: MarkdownRendererProps) {
  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none prose-pre:p-0 prose-pre:bg-transparent prose-pre:border-0 prose-code:before:content-none prose-code:after:content-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
        code({ className: codeClassName, children, ...rest }) {
          const match = /language-(\w+)/.exec(codeClassName || "");
          const value = String(children).replace(/\n$/, "");

          if (match) {
            return <CodeBlock language={match[1]} value={value} />;
          }

          return (
            <code
              className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-[#333] text-[13px] font-mono"
              {...rest}
            >
              {children}
            </code>
          );
        },
        pre({ children }) {
          return <>{children}</>;
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 dark:text-blue-400 hover:underline"
            >
              {children}
            </a>
          );
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full text-sm border-collapse border border-gray-200 dark:border-white/10">
                {children}
              </table>
            </div>
          );
        },
        th({ children }) {
          return (
            <th className="px-3 py-2 text-left bg-gray-50 dark:bg-[#2a2a2a] border border-gray-200 dark:border-white/10 font-medium">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="px-3 py-2 border border-gray-200 dark:border-white/10">
              {children}
            </td>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  );
}
