import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation } from "../lib/api";

const CITE_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/** Turn [1] and [1, 3] into links the renderer swaps for citation chips. */
function linkCitations(text: string, max: number): string {
  return text.replace(CITE_RE, (whole, nums: string) => {
    // Link the numbers that match an excerpt; drop any the model made up.
    const ns = nums.split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => n >= 1 && n <= max);
    if (!ns.length) return whole;
    return ns.map((n) => `[${n}](#cite-${n})`).join("");
  });
}

export function Markdown({ text, citations, onCite }: { text: string; citations?: Citation[]; onCite?: (c: Citation) => void }) {
  const source = citations?.length ? linkCitations(text, citations.length) : text;
  return (
    <div className="markdown answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("#cite-") && citations) {
              const c = citations[parseInt(href.slice(6), 10) - 1];
              return (
                <button type="button" className="cite" title={`${c.source_title}${c.page ? `, p. ${c.page}` : ""}`}
                  aria-label={`Citation ${c.n}: ${c.source_title}`} onClick={() => onCite?.(c)}>
                  {c.n}
                </button>
              );
            }
            return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
