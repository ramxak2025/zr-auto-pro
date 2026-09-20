import { Component, lazy, Suspense } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import type { MarkdownViewProps } from './MarkdownViewRich';

const MarkdownViewRich = lazy(() => import('./MarkdownViewRich'));

/**
 * Обёртка над markdown-рендером статей: держит тяжёлый react-markdown +
 * remark-gfm в ОТДЕЛЬНОМ чанке и гарантирует, что его отказ не уносит экран.
 *
 * Зачем: remark-gfm содержит regex-литерал с lookbehind, который Safari ниже
 * 16.4 не может даже разобрать — весь чанк падает с SyntaxError. Раньше он
 * лежал статическим импортом внутри чанка «Базы знаний», поэтому на старых
 * iPhone раздел не открывался: import() отклонялся навсегда, lazyWithRetry
 * дожимал до перезагрузки, и человек видел экран ошибки вместо статьи.
 *
 * Теперь отказ локализован: и ошибка загрузки чанка, и ошибка рендера внутри
 * него ловятся здесь же и деградируют до читаемого текста статьи. Никакой
 * автоперезагрузки — глобальный ErrorBoundary для chunk-ошибок её запускает,
 * а здесь она бессмысленна: на старом Safari чанк не соберётся и со второго
 * раза.
 */

/** Читаемый фолбэк: markdown как обычный текст, переносы сохранены. */
function PlainText({ children, className = '' }: MarkdownViewProps) {
  return (
    <div className={`text-[15px] leading-relaxed text-gray-800 ${className}`}>
      <div className="whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}

/** Скелет на время загрузки чанка — без мигания сырым markdown'ом. */
function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse space-y-2.5 ${className}`} aria-hidden>
      <div className="h-4 w-3/4 rounded bg-gray-200" />
      <div className="h-4 w-full rounded bg-gray-200" />
      <div className="h-4 w-5/6 rounded bg-gray-200" />
    </div>
  );
}

interface BoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

/**
 * Локальная граница — намеренно НЕ переиспользуем components/ErrorBoundary:
 * тот на chunk-ошибке перезагружает страницу, а нам нужна тихая деградация.
 */
class MarkdownBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('MarkdownView: рендер статьи деградирован до простого текста', error, info);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function MarkdownView({ children, className = '' }: MarkdownViewProps) {
  const plain = <PlainText className={className}>{children}</PlainText>;
  return (
    <MarkdownBoundary fallback={plain}>
      <Suspense fallback={<Skeleton className={className} />}>
        <MarkdownViewRich className={className}>{children}</MarkdownViewRich>
      </Suspense>
    </MarkdownBoundary>
  );
}
