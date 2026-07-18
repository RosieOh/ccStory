import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Renders assistant/plan Markdown with Tailwind styling. react-markdown does not
 * emit raw HTML, so untrusted content can't inject markup — safe for indexed logs.
 */
const components: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-semibold text-white">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-3 text-sm font-semibold text-white">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold text-zinc-100">{children}</h3>,
  p: ({ children }) => <p className="mb-2 leading-relaxed text-zinc-200">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 text-zinc-200">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 text-zinc-200">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} className="text-sky-400 underline underline-offset-2" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-zinc-700 pl-3 text-zinc-400">{children}</blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = /language-/.test(className ?? '')
    if (isBlock) {
      return (
        <code className="block overflow-x-auto rounded bg-black/50 p-2 font-mono text-[11px] text-zinc-200">
          {children}
        </code>
      )
    }
    return <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-amber-200">{children}</code>
  },
  pre: ({ children }) => <pre className="mb-2 overflow-x-auto">{children}</pre>,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs text-zinc-200">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-zinc-700 px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-zinc-800 px-2 py-1">{children}</td>,
  hr: () => <hr className="my-3 border-zinc-800" />,
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-xs [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
