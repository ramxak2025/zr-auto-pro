import { useState } from 'react';

interface OptionalImageProps {
  src: string;
  alt: string;
  /** width/height обязательны — браузер резервирует место, нет CLS при загрузке. */
  width: number;
  height: number;
  className?: string;
}

/**
 * Слот под изображение, которого на сервере может ещё не быть: владелец
 * докладывает файлы в public/img/landing/ отдельно от кода. Пока файла нет,
 * onError прячет <img> целиком — на проде ни битой иконки, ни alt-текста.
 * Появился файл — картинка рендерится сама, менять код не нужно.
 *
 * Оба состояния привязаны к конкретному src, а не к инстансу компонента:
 * при переходе /f/cash → /f/schedule роутер меняет только params без
 * ремаунта страницы, и «залипший» failed от прошлого файла скрывал бы
 * новую картинку навсегда. И пока файл не загрузился (или пока сервер не
 * ответил 404), <img> держится invisible — посетитель не видит пустую
 * карточку с рамкой и тенью, а место под картинку остаётся зарезервированным
 * (нет CLS, когда файл существует).
 */
export default function OptionalImage({ src, alt, width, height, className }: OptionalImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  if (failedSrc === src) return null;
  const loaded = loadedSrc === src;
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={loaded ? className : `${className ?? ''} invisible`.trim()}
      onLoad={() => setLoadedSrc(src)}
      onError={() => setFailedSrc(src)}
    />
  );
}
