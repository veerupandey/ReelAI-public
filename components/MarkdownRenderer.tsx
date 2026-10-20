/**
 * Lightweight Markdown → React renderer for the General Agent.
 * Handles: headings, bold, italic, code blocks, inline code, links, images,
 * lists, tables, blockquotes, horizontal rules, JSON formatting.
 * No external deps.
 */

import React from 'react';

interface Props {
  content: string;
  className?: string;
}

// ── Inline parsing ───────────────────────────────────────────────────────────

function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Combined regex for inline elements
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|!\[([^\]]*)\]\(([^)]+)\)|(https?:\/\/[^\s"'<>,)}\]]+)|((?:\/[\w.-]+){2,}(?:\.\w+)?))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // ***bold italic***
      nodes.push(<strong key={match.index} className="font-bold italic">{match[2]}</strong>);
    } else if (match[3]) {
      // **bold**
      nodes.push(<strong key={match.index} className="font-semibold text-white">{match[3]}</strong>);
    } else if (match[4]) {
      // *italic*
      nodes.push(<em key={match.index} className="italic text-gray-300">{match[4]}</em>);
    } else if (match[5]) {
      // `inline code`
      nodes.push(
        <code key={match.index} className="px-1.5 py-0.5 rounded bg-white/[0.06] text-emerald-300 text-[11px] font-mono border border-white/[0.04]">
          {match[5]}
        </code>
      );
    } else if (match[8] !== undefined && match[9]) {
      // ![alt](url) — image
      nodes.push(
        <span key={match.index} className="inline-block my-1">
          <img src={match[9]} alt={match[8] || ''} className="max-w-[240px] max-h-[160px] rounded-lg border border-white/10 object-cover"
            loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </span>
      );
    } else if (match[6] && match[7]) {
      // [text](url) — link
      nodes.push(
        <a key={match.index} href={match[7]} target="_blank" rel="noopener noreferrer"
          className="text-teal-400 hover:text-teal-300 underline decoration-teal-500/30 hover:decoration-teal-400/60 transition">
          {match[6]}
        </a>
      );
    } else if (match[10]) {
      // bare URL
      nodes.push(
        <a key={match.index} href={match[10]} target="_blank" rel="noopener noreferrer"
          className="text-teal-400 hover:text-teal-300 underline decoration-teal-500/30 hover:decoration-teal-400/60 transition break-all">
          {match[10].length > 65 ? `${match[10].slice(0, 60)}…` : match[10]}
        </a>
      );
    } else if (match[11]) {
      // file path
      nodes.push(
        <span key={match.index}
          className="text-amber-400/80 font-mono text-[11px] bg-amber-500/5 px-1 rounded border border-amber-500/10 cursor-pointer hover:bg-amber-500/10 transition"
          onClick={() => { navigator.clipboard?.writeText(match![11]); }}
          title={`Copy: ${match[11]}`}>
          {match[11]}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}


// ── Code block rendering ─────────────────────────────────────────────────────

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Try to format JSON nicely
  let displayCode = code;
  if (language === 'json' || (!language && code.trim().startsWith('{'))) {
    try {
      displayCode = JSON.stringify(JSON.parse(code), null, 2);
    } catch { /* not valid JSON, keep as-is */ }
  }

  return (
    <div className="relative group rounded-lg border border-white/[0.06] bg-[#0d1117] my-2 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.04] bg-white/[0.02]">
        <span className="text-[10px] text-gray-500 font-mono">{language || 'code'}</span>
        <button onClick={handleCopy}
          className="text-[10px] text-gray-500 hover:text-gray-300 transition opacity-0 group-hover:opacity-100">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[11px] leading-relaxed font-mono text-gray-300">
        <code>{displayCode}</code>
      </pre>
    </div>
  );
}


// ── Table rendering ──────────────────────────────────────────────────────────

function parseTable(lines: string[]): React.ReactNode | null {
  if (lines.length < 2) return null;
  const headerCells = lines[0].split('|').map((c) => c.trim()).filter(Boolean);
  // Line 1 should be the separator (---|---|---)
  if (!lines[1].includes('---')) return null;
  const rows = lines.slice(2).map((l) => l.split('|').map((c) => c.trim()).filter(Boolean));

  return (
    <div className="overflow-x-auto my-2 rounded-lg border border-white/[0.06]">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-white/[0.03] border-b border-white/[0.06]">
            {headerCells.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left text-gray-400 font-semibold">{parseInline(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-white/[0.03] last:border-0">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5 text-gray-300">{parseInline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main block parser ────────────────────────────────────────────────────────

function parseBlocks(content: string): React.ReactNode[] {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block (``` ... ```)
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push(<CodeBlock key={key++} language={lang} code={codeLines.join('\n')} />);
      continue;
    }

    // Table (starts with |)
    if (line.trimStart().startsWith('|') && i + 1 < lines.length && lines[i + 1].includes('---')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const table = parseTable(tableLines);
      if (table) { blocks.push(<React.Fragment key={key++}>{table}</React.Fragment>); continue; }
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      const sizes: Record<number, string> = {
        1: 'text-[16px] font-bold text-white mt-4 mb-2',
        2: 'text-[14px] font-bold text-white mt-3 mb-1.5',
        3: 'text-[13px] font-semibold text-gray-200 mt-2.5 mb-1',
        4: 'text-[12px] font-semibold text-gray-300 mt-2 mb-1',
      };
      blocks.push(<Tag key={key++} className={sizes[level] || sizes[4]}>{parseInline(text)}</Tag>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="border-white/[0.06] my-3" />);
      i++;
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="border-l-2 border-emerald-500/30 pl-3 py-1 my-2 text-gray-400 italic text-[12px]">
          {quoteLines.map((ql, qi) => <span key={qi}>{parseInline(ql)}<br /></span>)}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-none space-y-1 my-1.5 pl-1">
          {listItems.map((item, li) => (
            <li key={li} className="flex gap-2 text-[12px] text-gray-300">
              <span className="text-emerald-500/60 mt-0.5 shrink-0">•</span>
              <span>{parseInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={key++} className="list-none space-y-1 my-1.5 pl-1">
          {listItems.map((item, li) => (
            <li key={li} className="flex gap-2 text-[12px] text-gray-300">
              <span className="text-gray-500 font-mono text-[10px] mt-0.5 shrink-0 w-4">{li + 1}.</span>
              <span>{parseInline(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line
    if (!line.trim()) {
      blocks.push(<div key={key++} className="h-2" />);
      i++;
      continue;
    }

    // Regular paragraph
    blocks.push(<p key={key++} className="text-[12px] text-gray-300 leading-relaxed">{parseInline(line)}</p>);
    i++;
  }

  return blocks;
}


// ── JSON detection & pretty display ─────────────────────────────────────────

function tryParseJson(text: string): object | null {
  const trimmed = text.trim();
  if ((!trimmed.startsWith('{') && !trimmed.startsWith('[')) || trimmed.length < 10) return null;
  try { return JSON.parse(trimmed); } catch { return null; }
}

// ── Main export ──────────────────────────────────────────────────────────────

const MarkdownRenderer: React.FC<Props> = ({ content, className }) => {
  if (!content) return null;

  // If the entire content is JSON, render as a formatted code block
  const jsonData = tryParseJson(content);
  if (jsonData) {
    return (
      <div className={className}>
        <CodeBlock language="json" code={JSON.stringify(jsonData, null, 2)} />
      </div>
    );
  }

  return <div className={className}>{parseBlocks(content)}</div>;
};

export default MarkdownRenderer;
