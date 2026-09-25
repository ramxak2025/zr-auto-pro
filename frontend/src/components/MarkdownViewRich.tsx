import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../ui/cn';
import { articleType, headingClass, headingTag } from './knowledge/articleTypography';

export interface MarkdownViewProps {
  children: string;
  className?: string;
  /**
   * Семантический уровень тега для `#` в markdown. Заголовок самого материала
   * на странице — h2 (под h1 страницы), поэтому по умолчанию `#` → h3,
   * `##` → h4 и т. д. Визуальный размер задаёт глубина, не тег.
   */
  headingBase?: 3 | 4;
}

/**
 * Safe markdown renderer for Knowledge Base article bodies.
 *
 * ВНИМАНИЕ: этот модуль грузится ТОЛЬКО динамически, из MarkdownView.tsx.
 * Причина — remark-gfm тянет mdast-util-gfm-autolink-literal, а там регулярка
 * с lookbehind: /(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu.
 * Это литерал, а не new RegExp, поэтому он валидируется на этапе РАЗБОРА
 * скрипта: JSC до Safari 16.4 падает с SyntaxError и убивает весь чанк
 * целиком — ни одна строка не выполняется. Пока это жило статическим
 * импортом в чанке «Базы знаний», у владельцев старых iPhone (6s/7/SE1
 * заперты на iOS 15.8 навсегда) раздел не открывался вообще. Отдельный чанк
 * + локальный ErrorBoundary в обёртке превращают отказ в «статья показана
 * простым текстом» вместо «экран не открывается».
 *
 * react-markdown does NOT render raw HTML by default (no rehype-raw plugin),
 * so embedded <script>/<img onerror>/etc. in the markdown source are treated
 * as plain text — this is the sanitization the codebase relies on. We only
 * enable GitHub-flavoured markdown (tables, task lists, strikethrough,
 * autolinks). External links open in a new tab with noopener/noreferrer.
 *
 * Типографика — общая шкала components/knowledge/articleTypography.ts
 * (колонка чтения ≤ 70 символов, заголовки по шкале системы).
 */
export default function MarkdownViewRich({ children, className = '', headingBase = 3 }: MarkdownViewProps) {
  const heading = (depth: 0 | 1 | 2 | 3) => {
    const Tag = headingTag(headingBase + depth);
    const cls = headingClass(depth);
    return function MdHeading({ node: _node, children: kids, ...props }: any) {
      return (
        <Tag className={cls} {...props}>
          {kids}
        </Tag>
      );
    };
  };

  return (
    <div className={cn(articleType.body, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: heading(0),
          h2: heading(1),
          h3: heading(2),
          h4: heading(3),
          h5: heading(3),
          h6: heading(3),
          p: ({ node: _node, ...props }) => <p className={articleType.paragraph} {...props} />,
          a: ({ node: _node, href, children: kids, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className={articleType.link} {...props}>
              {kids}
            </a>
          ),
          ul: ({ node: _node, className: cls, ...props }) => (
            <ul
              className={cn(articleType.list, cls?.includes('contains-task-list') ? 'list-none pl-0' : 'list-disc')}
              {...props}
            />
          ),
          ol: ({ node: _node, ...props }) => <ol className={cn(articleType.list, 'list-decimal')} {...props} />,
          li: ({ node: _node, className: cls, ...props }) => (
            <li
              className={cn(articleType.listItem, cls?.includes('task-list-item') && 'flex items-start gap-2 pl-0')}
              {...props}
            />
          ),
          input: ({ node: _node, ...props }) => (
            <input
              {...props}
              className="mt-[5px] h-4 w-4 flex-shrink-0 rounded border-line-strong accent-accent"
              aria-label={props.checked ? 'Выполнено' : 'Не выполнено'}
            />
          ),
          blockquote: ({ node: _node, ...props }) => <blockquote className={articleType.blockquote} {...props} />,
          hr: ({ node: _node, ...props }) => <hr className={articleType.hr} {...props} />,
          code: ({ node: _node, className: cls, children: codeChildren, ...props }) => {
            const isBlock = /\n/.test(String(codeChildren));
            if (isBlock) {
              return (
                <code className={cn(articleType.codeBlock, cls)} {...props}>
                  {codeChildren}
                </code>
              );
            }
            return (
              <code className={articleType.codeInline} {...props}>
                {codeChildren}
              </code>
            );
          },
          pre: ({ node: _node, ...props }) => <pre className="my-5" {...props} />,
          table: ({ node: _node, ...props }) => (
            <div className={articleType.table}>
              <table className="w-full border-separate border-spacing-0" {...props} />
            </div>
          ),
          th: ({ node: _node, ...props }) => <th className={articleType.th} {...props} />,
          td: ({ node: _node, ...props }) => <td className={articleType.td} {...props} />,
          img: ({ node: _node, alt, ...props }) => (
            <img className={cn(articleType.image, 'my-5')} loading="lazy" alt={alt ?? ''} {...props} />
          ),
          strong: ({ node: _node, ...props }) => <strong className="font-semibold text-ink" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
