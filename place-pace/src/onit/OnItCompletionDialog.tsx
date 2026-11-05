// Диалог завершения маршрута (данные из ответа finish_walk_session)
import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import { hourWord, minuteWord, pointWord } from '../i18n/plurals';
import type { Language } from '../i18n/LanguageContext';
import type { WalkSessionStats } from '../api/client';
import { ChevronBackwardIcon } from '../components/sfSymbols';
import { DEFAULT_HEADER_HEIGHT } from '../components/layerGeometry';
import { ONIT_BOTTOMBAR_HEIGHT, ONIT_MODAL_Z } from './onitLayout';

interface OnItCompletionDialogProps {
  stats: WalkSessionStats;
  onFinish: () => void;
  // 'live' - сразу после финиша, 'history' - просмотр из "Пройденные"
  variant?: 'live' | 'history';
  // Только для variant='history' - см. OnItPastRoutes.tsx
  onBack?: () => void;
}

// Затраченное время из минут
function formatElapsed(totalMinutes: number, language: Language): string {
  if (totalMinutes < 60) return `${totalMinutes} ${minuteWord(totalMinutes, language)}`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (mins === 0) return `${hours} ${hourWord(hours, language)}`;
  return `${hours} ${hourWord(hours, language)} ${mins} ${minuteWord(mins, language)}`;
}

// Дата из ISO с 'Z' (иначе трактуется как локальная)
function formatDate(finishedAtIso: string, language: Language): string {
  return new Date(finishedAtIso).toLocaleDateString(language === 'en' ? 'en-GB' : 'ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

// Время "час:минута" из ISO
function formatTime(iso: string, language: Language): string {
  return new Date(iso).toLocaleTimeString(language === 'en' ? 'en-GB' : 'ru-RU', {
    hour: '2-digit', minute: '2-digit',
  });
}

// Ряд "подпись - значение" как в личном кабинете
const StatRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between gap-3 py-2">
    <span className="text-sm font-medium text-gray-700 flex-shrink-0">{label}</span>
    <span className="text-sm text-gray-800 text-right truncate">{value}</span>
  </div>
);

const OnItCompletionDialog = ({ stats, onFinish, variant = 'live', onBack }: OnItCompletionDialogProps) => {
  const { t, language } = useTranslation();
  const elapsedMinutes = Math.max(0, Math.round(stats.elapsed_seconds / 60));

  // Плавное появление
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className="fixed inset-0 bg-white flex flex-col transition-opacity duration-300"
      style={{ zIndex: ONIT_MODAL_Z + 10, opacity: isVisible ? 1 : 0 }}
    >
      {/* Шапка фиксированной высоты, как в ProfileModal */}
      <div
        className="border-b border-gray-100 flex-shrink-0 relative"
        style={{ height: DEFAULT_HEADER_HEIGHT, paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className={`absolute inset-0 flex items-center gap-3 pr-6 ${variant === 'history' ? 'pl-3' : 'pl-6'}`}>
          {variant === 'history' && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t('Закрыть')}
              className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center active:bg-gray-50 flex-shrink-0"
            >
              <ChevronBackwardIcon size={16} color="#000000" style={{ transform: 'translateX(-1.5px)' }} />
            </button>
          )}
          <h2 className="text-lg font-semibold text-gray-800 truncate">
            {variant === 'history' ? t('Маршрут пройден') : t('Маршрут пройден!')}
          </h2>
        </div>
      </div>

      {/* Содержимое как в ProfileModal */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            {/* Название маршрута может переноситься, id мелким под ним */}
            <div className="flex items-start justify-between gap-3 py-2">
              <span className="text-sm font-medium text-gray-700 flex-shrink-0">{t('Маршрут:')}</span>
              <div className="text-right min-w-0">
                <div className="text-sm text-gray-800 break-words">{stats.route_title}</div>
                {stats.route_id != null && (
                  <div className="text-xs text-gray-400 mt-0.5">@{stats.route_id}</div>
                )}
              </div>
            </div>
            <StatRow label={t('Пользователь:')} value={stats.username} />
            <StatRow label={t('Точек посещено:')} value={`${stats.stop_count} ${pointWord(stats.stop_count, language)}`} />
          </div>

          <div className="h-px bg-gray-100" />

          <div>
            <StatRow label={t('Дата прохождения:')} value={formatDate(stats.finished_at, language)} />
            <StatRow label={t('Время начала:')} value={formatTime(stats.started_at, language)} />
            <StatRow label={t('Время окончания:')} value={formatTime(stats.finished_at, language)} />
            <StatRow label={t('Затраченное время:')} value={formatElapsed(elapsedMinutes, language)} />
          </div>
        </div>
      </div>

      {/* Футер только у 'live' */}
      {/* Футер только у 'live' */}
      {variant === 'live' && (
        <div
          className="px-6 border-t border-gray-100 flex-shrink-0 flex items-center justify-end"
          style={{ height: ONIT_BOTTOMBAR_HEIGHT, paddingBottom: 'env(safe-area-inset-bottom)', boxSizing: 'content-box' }}
        >
          <button
            onClick={onFinish}
            className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium"
          >
            {t('Завершить маршрут')}
          </button>
        </div>
      )}
    </div>
  );
};

export default OnItCompletionDialog;
