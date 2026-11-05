// Кнопка "звезда + счётчик" (RouteBar и "Просмотр")
interface StarButtonProps {
  starsCount: number;
  isFavorite: boolean;
  // Блокирует клик (в т.ч. пока запрос toggleRouteStar в полёте)
  disabled: boolean;
  // Курсор и hover не зависят от disabled
  interactive: boolean;
  onToggle: () => void;
  // Разовая анимация (увеличение + вспышка) сразу после простановки звезды
  justActivated?: boolean;
  idleColorClassName?: string;
  countClassName?: string;
  // Затемнение на hover (в "Просмотре" кнопка уже получает общий hover модалок)
  hoverEffect?: boolean;
  // Размер звезды в px
  size?: number;
}

export const StarButton = ({
  starsCount,
  isFavorite,
  disabled,
  interactive,
  onToggle,
  justActivated = false,
  idleColorClassName = 'text-white/60',
  countClassName = 'text-base font-semibold text-white drop-shadow-md',
  hoverEffect = true,
  size = 24,
}: StarButtonProps) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
    disabled={disabled}
    className={`pp-plain flex items-center gap-1.5 transition-opacity ${
      interactive ? `cursor-pointer ${hoverEffect ? 'hover:opacity-70' : ''}` : 'cursor-not-allowed'
    }`}
  >
    <svg
      className={`transition-colors ${isFavorite ? 'text-yellow-400' : idleColorClassName} ${
        isFavorite && !justActivated ? 'pp-star-glow' : ''
      } ${justActivated ? 'animate-star-activate' : ''}`}
      style={{ width: size, height: size, flexShrink: 0 }}
      fill={isFavorite ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={isFavorite ? 0 : 1.5}
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <path d="M 11.49 2.89 Q 12.00 1.50 12.51 2.89 L 14.06 7.08 Q 14.57 8.47 16.05 8.53 L 20.51 8.70 Q 21.99 8.76 20.82 9.68 L 17.32 12.43 Q 16.15 13.35 16.55 14.78 L 17.77 19.06 Q 18.17 20.49 16.94 19.67 L 13.23 17.19 Q 12.00 16.37 10.77 17.19 L 7.06 19.67 Q 5.83 20.49 6.23 19.06 L 7.45 14.78 Q 7.85 13.35 6.68 12.43 L 3.18 9.68 Q 2.01 8.76 3.49 8.70 L 7.95 8.53 Q 9.43 8.47 9.94 7.08 Z" />
    </svg>
    <span className={countClassName}>{starsCount}</span>
  </button>
);
