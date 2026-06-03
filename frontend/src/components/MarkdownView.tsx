import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownViewProps {
  children: string;
  className?: string;
}

/**
 * Safe markdown renderer for Knowledge Base article bodies.
 *
 * react-markdown does NOT render raw HTML by default (no rehype-raw plugin),
 * so embedded <script>/<img onerror>/etc. in the markdown source are treated
 * as plain text — this is the sanitization the codebase relies on. We only
 * enable GitHub-flavoured markdown (tables, task lists, strikethrough,
 * autolinks). External links open in a new tab with noopener/noreferrer.
 *
 * No Tailwind `prose` plugin is installed, so each element is styled
 * explicitly via the `components` map to match the rest of the web app.
 */
export default function MarkdownView({ children, className = '' }: MarkdownViewProps) {
  return (
    <div className={`text-[15px] leading-relaxed text-gray-800 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node: _node, children, ...props }) => (
            <h1 className="mt-6 mb-3 text-2xl font-bold text-gray-900 first:mt-0" {...props}>
              {children}
            </h1>
          ),
          h2: ({ node: _node, children, ...props }) => (
            <h2 className="mt-6 mb-3 text-xl font-bold text-gray-900 first:mt-0" {...props}>
              {children}
            </h2>
          ),
          h3: ({ node: _node, children, ...props }) => (
            <h3 className="mt-5 mb-2 text-lg font-semibold text-gray-900 first:mt-0" {...props}>
              {children}
            </h3>
          ),
          h4: ({ node: _node, children, ...props }) => (
            <h4 className="mt-4 mb-2 text-base font-semibold text-gray-900 first:mt-0" {...props}>
              {children}
            </h4>
          ),
          p: ({ node: _node, ...props }) => <p className="my-3 first:mt-0 last:mb-0" {...props} />,
          a: ({ node: _node, href, children, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 underline underline-offset-2 hover:text-primary-700 break-words"
              {...props}
            >
              {children}
            </a>
          ),
          ul: ({ node: _node, ...props }) => (
            <ul className="my-3 list-disc space-y-1 pl-6" {...props} />
          ),
          ol: ({ node: _node, ...props }) => (
            <ol className="my-3 list-decimal space-y-1 pl-6" {...props} />
          ),
          li: ({ node: _node, ...props }) => <li className="pl-1" {...props} />,
          blockquote: ({ node: _node, ...props }) => (
            <blockquote
              className="my-4 border-l-4 border-primary-200 bg-primary-50/50 py-2 pl-4 pr-3 text-gray-700 italic rounded-r-lg"
              {...props}
            />
          ),
          hr: ({ node: _node, ...props }) => <hr className="my-6 border-gray-200" {...props} />,
          code: ({ node: _node, className: cls, children: codeChildren, ...props }) => {
            const isBlock = /\n/.test(String(codeChildren));
            if (isBlock) {
              return (
                <code
                  className={`block overflow-x-auto rounded-lg bg-gray-900 p-3 text-[13px] text-gray-100 ${cls || ''}`}
                  {...props}
                >
                  {codeChildren}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-gray-100 px-1.5 py-0.5 text-[13px] font-mono text-pink-700"
                {...props}
              >
                {codeChildren}
              </code>
            );
          },
          pre: ({ node: _node, ...props }) => <pre className="my-4" {...props} />,
          table: ({ node: _node, ...props }) => (
            <div className="my-4 overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm" {...props} />
            </div>
          ),
          th: ({ node: _node, ...props }) => (
            <th
              className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-600"
              {...props}
            />
          ),
          td: ({ node: _node, ...props }) => (
            <td className="border-b border-gray-100 px-3 py-2 text-gray-700" {...props} />
          ),
          img: ({ node: _node, ...props }) => (
            <img className="my-4 max-w-full rounded-lg" loading="lazy" alt="" {...props} />
          ),
          strong: ({ node: _node, ...props }) => (
            <strong className="font-semibold text-gray-900" {...props} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
