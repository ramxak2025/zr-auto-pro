/** @type {import('tailwindcss').Config} */

// Семантические цвета админки живут в CSS-переменных (index.css, :root) в виде
// каналов «R G B», чтобы работали модификаторы прозрачности (`bg-accent/25`).
const token = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // hover:-стили только на устройствах с настоящим hover (@media (hover: hover)):
  // на таче hover-эффекты не «залипают» после первого тапа. Функциональность от
  // hover нигде не зависит — hover-подсказки (ImageUpload/EquipmentPage) чисто
  // визуальные, клик обрабатывает родительская кнопка.
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      fontFamily: {
        // Onest — единый шрифт и лендинга, и админки (self-hosted, см. index.css).
        // 'Onest Fallback' — метрически подогнанный local(Arial) против CLS при swap.
        sans: ['Onest', 'Onest Fallback', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Onest', 'Onest Fallback', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        // Минимальный кегль подписей в админке — 11 px. 9–10 px не используем.
        '2xs': ['0.6875rem', { lineHeight: '0.875rem' }],
        // Заголовок карточки/секции.
        md: ['0.9375rem', { lineHeight: '1.375rem' }],
        // Заголовок страницы (PageHeader).
        title: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em', fontWeight: '600' }],
      },
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        // ── Семантические токены админки (docs/web-redesign/DESIGN_SYSTEM.md) ──
        canvas: token('--c-canvas'),
        surface: { DEFAULT: token('--c-surface'), 2: token('--c-surface-2'), 3: token('--c-surface-3') },
        line: { DEFAULT: token('--c-line'), strong: token('--c-line-strong') },
        ink: { DEFAULT: token('--c-ink'), 2: token('--c-ink-2'), 3: token('--c-ink-3'), 4: token('--c-ink-4') },
        accent: {
          DEFAULT: token('--c-accent'),
          hover: token('--c-accent-hover'),
          soft: token('--c-accent-soft'),
          'soft-2': token('--c-accent-soft-2'),
          text: token('--c-accent-text'),
        },
        ok: { DEFAULT: token('--c-ok'), soft: token('--c-ok-soft'), text: token('--c-ok-text') },
        warn: { DEFAULT: token('--c-warn'), soft: token('--c-warn-soft'), text: token('--c-warn-text') },
        bad: { DEFAULT: token('--c-bad'), soft: token('--c-bad-soft'), text: token('--c-bad-text') },
        info: { DEFAULT: token('--c-info'), soft: token('--c-info-soft'), text: token('--c-info-text') },
        // Тёмная боковая панель.
        rail: {
          DEFAULT: token('--c-rail'),
          2: token('--c-rail-2'),
          text: token('--c-rail-text'),
          muted: token('--c-rail-muted'),
        },
      },
      boxShadow: {
        // Два уровня: покой (card) и всплытие (pop). Тени мягкие и холодные.
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.03)',
        pop: '0 8px 24px -8px rgb(15 23 42 / 0.18), 0 2px 6px rgb(15 23 42 / 0.06)',
        drawer: '-12px 0 32px -12px rgb(15 23 42 / 0.25)',
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-down': {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-left': {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        // Деликатная пульсация emerald-свечения бейджа-якоря в hero лендинга:
        // shadow 0→6px, очень subtle. Только box-shadow маленького элемента —
        // paint-область крошечная, 60fps не страдает. Использовать строго
        // через motion-safe: (reduced-motion выключает).
        'badge-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(16 185 129 / 0)' },
          '50%': { boxShadow: '0 0 6px 2px rgb(16 185 129 / 0.28)' },
        },
        // Админка: появление меню/поповера (transform + opacity, ≤ 150 мс).
        'pop-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'tip-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.6s ease-out both',
        'fade-in-up': 'fade-in-up 0.6s ease-out both',
        'fade-in-down': 'fade-in-down 0.5s ease-out both',
        'scale-in': 'scale-in 0.5s ease-out both',
        'slide-in-left': 'slide-in-left 0.5s ease-out both',
        float: 'float 3s ease-in-out infinite',
        shimmer: 'shimmer 2.5s ease-in-out infinite',
        'badge-glow': 'badge-glow 3s ease-in-out infinite',
        'pop-in': 'pop-in 140ms cubic-bezier(0.25, 1, 0.5, 1) both',
        'tip-in': 'tip-in 120ms ease-out both',
      },
    },
  },
  plugins: [],
};
