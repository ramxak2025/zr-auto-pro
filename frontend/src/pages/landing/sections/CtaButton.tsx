import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { getAccessContactUrl } from '../config';

/**
 * Primary-CTA по правилу конфига: есть контакт → «Получить доступ» (внешняя
 * ссылка), контактов нет → «Войти» (→ /login).
 */
export default function CtaButton({ className = '' }: { className?: string }) {
  const base =
    'inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-primary-600 px-8 text-base font-semibold text-white shadow-lg shadow-primary-600/25 transition-colors hover:bg-primary-500 active:bg-primary-700';
  const url = getAccessContactUrl();

  if (url) {
    const external = url.startsWith('http');
    return (
      <a
        href={url}
        target={external ? '_blank' : undefined}
        rel="noopener noreferrer"
        className={`${base} ${className}`}
      >
        Получить доступ
        <ArrowRight className="h-5 w-5" />
      </a>
    );
  }

  return (
    <Link to="/login" className={`${base} ${className}`}>
      Войти
      <ArrowRight className="h-5 w-5" />
    </Link>
  );
}
