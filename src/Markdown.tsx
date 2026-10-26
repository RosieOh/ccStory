import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Renders assistant/plan Markdown with Tailwind styling. react-markdown does not
 * emit raw HTML, so untrusted content can't inject markup — safe for indexed logs.
 */
const components: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-semibold text-ink-1">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-semibold text-ink-1">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold text-ink-1">{children}</h3>,
  p: ({ children }) => <p className="mb-2 leading-relaxed text-ink-1">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 text-ink-1">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 text-ink-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} className="text-brand-ink underline underline-offset-2" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-line-strong pl-3 text-ink-3">{children}</blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = /language-/.test(className ?? '')
    if (isBlock) {
      return (
        <code className="block overflow-x-auto rounded-xl bg-well p-3 font-mono text-[12.5px] text-ink-1">
          {children}
        </code>
      )
    }
    return <code className="rounded bg-well px-1 py-0.5 font-mono text-[12.5px] text-tone-orange">{children}</code>
  },
  pre: ({ children }) => <pre className="mb-2 overflow-x-auto">{children}</pre>,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse text-[14px] leading-relaxed text-ink-1">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-line-strong px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-line px-2 py-1">{children}</td>,
  hr: () => <hr className="my-3 border-line" />,
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[14px] leading-relaxed [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
