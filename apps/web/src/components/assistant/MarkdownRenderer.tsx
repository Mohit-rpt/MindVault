import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  onCitationClick?: (citationId: string) => void;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  onCitationClick,
}) => {
  if (!content) return null;

  // Split by code fences first
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const blocks: Array<{ type: 'code' | 'text'; lang?: string; text: string }> = [];

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: 'text',
        text: content.slice(lastIndex, match.index),
      });
    }

    blocks.push({
      type: 'code',
      lang: match[1] || 'plaintext',
      text: match[2].trimEnd(),
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    blocks.push({
      type: 'text',
      text: content.slice(lastIndex),
    });
  }

  return (
    <div className="space-y-3 text-[13.5px] leading-relaxed text-theme-text font-sans">
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return <CodeBlock key={idx} language={block.lang || 'code'} code={block.text} />;
        }
        return (
          <TextBlock
            key={idx}
            text={block.text}
            onCitationClick={onCitationClick}
          />
        );
      })}
    </div>
  );
};

const CodeBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-xl border border-theme-border overflow-hidden bg-theme-code shadow-sm">
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-theme-border/60 bg-theme-surface-secondary/70 text-[11px] font-mono text-theme-text-secondary">
        <span className="uppercase tracking-wider font-semibold">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 hover:text-theme-text transition-colors px-1.5 py-0.5 rounded hover:bg-theme-surface"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-500" />
              <span className="text-emerald-500 font-sans text-[11px]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span className="font-sans text-[11px]">Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto font-mono text-xs leading-relaxed text-theme-text custom-scrollbar">
        <code>{code}</code>
      </pre>
    </div>
  );
};

const TextBlock: React.FC<{
  text: string;
  onCitationClick?: (citationId: string) => void;
}> = ({ text, onCitationClick }) => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inList = false;
  let listItems: string[] = [];
  let isOrderedList = false;
  let inTable = false;
  let tableRows: string[] = [];

  const flushList = () => {
    if (inList && listItems.length > 0) {
      if (isOrderedList) {
        elements.push(
          <ol key={`ol-${elements.length}`} className="list-decimal list-outside pl-5 space-y-1 my-2">
            {listItems.map((item, i) => (
              <li key={i}>{renderInline(item, onCitationClick)}</li>
            ))}
          </ol>,
        );
      } else {
        elements.push(
          <ul key={`ul-${elements.length}`} className="list-disc list-outside pl-5 space-y-1 my-2">
            {listItems.map((item, i) => (
              <li key={i}>{renderInline(item, onCitationClick)}</li>
            ))}
          </ul>,
        );
      }
      listItems = [];
      inList = false;
    }
  };

  const flushTable = () => {
    if (inTable && tableRows.length > 0) {
      const headerRow = tableRows[0];
      const dataRows = tableRows.slice(1).filter((r) => !r.trim().match(/^\|?[-:\s|]+\|?$/));

      const parseCells = (row: string) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());

      const headers = parseCells(headerRow);

      elements.push(
        <div key={`table-${elements.length}`} className="my-3 overflow-x-auto rounded-xl border border-theme-border">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-theme-surface-secondary text-theme-text border-b border-theme-border font-medium">
              <tr>
                {headers.map((h, i) => (
                  <th key={i} className="px-3 py-2">
                    {renderInline(h, onCitationClick)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-theme-border/40 text-theme-text-secondary">
              {dataRows.map((row, rIdx) => {
                const cells = parseCells(row);
                return (
                  <tr key={rIdx} className="hover:bg-theme-surface-secondary/40 transition-colors">
                    {cells.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-2">
                        {renderInline(cell, onCitationClick)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>,
      );
      tableRows = [];
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Table detection
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushList();
      inTable = true;
      tableRows.push(trimmed);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h3 key={i} className="text-sm font-semibold text-theme-text tracking-tight mt-3 mb-1">
          {renderInline(trimmed.replace('### ', ''), onCitationClick)}
        </h3>,
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h2 key={i} className="text-base font-semibold text-theme-text tracking-tight mt-4 mb-1.5">
          {renderInline(trimmed.replace('## ', ''), onCitationClick)}
        </h2>,
      );
      continue;
    }
    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <h1 key={i} className="text-lg font-bold text-theme-text tracking-tight mt-4 mb-2">
          {renderInline(trimmed.replace('# ', ''), onCitationClick)}
        </h1>,
      );
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      flushList();
      elements.push(
        <blockquote
          key={i}
          className="border-l-2 border-theme-accent/60 pl-3.5 my-2 italic text-theme-text-secondary"
        >
          {renderInline(trimmed.replace('> ', ''), onCitationClick)}
        </blockquote>,
      );
      continue;
    }

    // Unordered List (- or *)
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (ulMatch) {
      if (inList && isOrderedList) flushList();
      inList = true;
      isOrderedList = false;
      listItems.push(ulMatch[2]);
      continue;
    }

    // Ordered List (1. 2.)
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      if (inList && !isOrderedList) flushList();
      inList = true;
      isOrderedList = true;
      listItems.push(olMatch[2]);
      continue;
    }

    // Non-list line
    flushList();

    if (trimmed === '') {
      continue;
    }

    // Paragraph
    elements.push(
      <p key={i} className="my-1.5 leading-relaxed">
        {renderInline(line, onCitationClick)}
      </p>,
    );
  }

  flushList();
  flushTable();

  return <>{elements}</>;
};

/**
 * Parses inline formatting:
 * - Clickable citation tags: [S1], [S2]
 * - Inline code: `code`
 * - Bold: **text**
 * - Italic: *text*
 */
function renderInline(text: string, onCitationClick?: (id: string) => void): React.ReactNode {
  if (!text) return null;

  // Split on inline code and citations
  const parts = text.split(/(\[S\d+\]|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);

  return parts.map((part, index) => {
    // 1. Citation tag [S1]
    const citationMatch = part.match(/^\[S(\d+)\]$/);
    if (citationMatch) {
      return (
        <button
          key={index}
          type="button"
          onClick={() => onCitationClick && onCitationClick(part)}
          className="inline-flex items-center mx-1 px-1.5 py-0.2 text-[11px] font-mono font-semibold rounded-md bg-theme-accent/15 text-theme-accent border border-theme-accent/30 hover:bg-theme-accent/25 hover:border-theme-accent/50 transition-all cursor-pointer"
          title={`View source evidence ${part}`}
        >
          {part}
        </button>
      );
    }

    // 2. Inline Code `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={index}
          className="font-mono text-xs px-1.5 py-0.5 rounded bg-theme-surface-secondary text-theme-accent border border-theme-border/60 mx-0.5"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // 3. Bold **text**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={index} className="font-semibold text-theme-text">
          {part.slice(2, -2)}
        </strong>
      );
    }

    // 4. Italic *text*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={index} className="italic text-theme-text-secondary">
          {part.slice(1, -1)}
        </em>
      );
    }

    return part;
  });
}
