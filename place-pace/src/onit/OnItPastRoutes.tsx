// Экран "Пройденные маршруты": завершённые прохождения пользователя
import { useEffect, useState } from 'react';
import { api, type WalkSessionStats } from '../api/client';
import { useTranslation } from '../i18n/LanguageContext';
import type { Language } from '../i18n/LanguageContext';
import { ChevronBackwardIcon } from '../components/sfSymbols';
import { DEFAULT_HEADER_HEIGHT } from '../components/layerGeometry';
import { ONIT_MODAL_Z } from './onitLayout';
import OnItCompletionDialog from './OnItCompletionDialog';

interface OnItPastRoutesProps {
  onClose: () => void;
}

// Дата завершения (момент из ISO с 'Z', без явной timeZone)
function formatCompletedDate(finishedAtIso: string, language: Language): string {
  return new Date(finishedAtIso).toLocaleDateString(language === 'en' ? 'en-GB' : 'ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

const OnItPastRoutes = ({ onClose }: OnItPastRoutesProps) => {
  const { t, language } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  // null - загрузка, [] - пусто
  const [sessions, setSessions] = useState<WalkSessionStats[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Открытое прохождение показывается диалогом поверх списка
  const [selectedSession, setSelectedSession] = useState<WalkSessionStats | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const load = () => {
    setLoadError(false);
    api.listWalkSessions().then((result) => {
      if ('error' in result) setLoadError(true);
      else setSessions(result);
    }).catch(() => setLoadError(true));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Диалог выше списка по z-index
  if (selectedSession) {
    // variant="history": без кнопки "Завершить", с обычной "Назад"
    return (
      <OnItCompletionDialog
        stats={selectedSession}
        variant="history"
        onBack={() => setSelectedSession(null)}
        onFinish={() => setSelectedSession(null)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 bg-white flex flex-col transition-opacity duration-300"
      style={{ zIndex: ONIT_MODAL_Z, opacity: isVisible ? 1 : 0 }}
    >
      {/* Шапка как в ProfileModal */}
      <div
        className="border-b border-gray-100 flex-shrink-0 relative"
        style={{ height: DEFAULT_HEADER_HEIGHT, paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="absolute inset-0 flex items-center gap-3 pl-3 pr-6">
          {/* Кнопка "Назад" */}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Закрыть')}
            className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center active:bg-gray-50 flex-shrink-0"
          >
            <ChevronBackwardIcon size={16} color="#000000" style={{ transform: 'translateX(-1.5px)' }} />
          </button>
          <h2 className="text-lg font-semibold text-gray-800 truncate">{t('Пройденные маршруты')}</h2>
        </div>
      </div>

      {/* Содержимое: ряды "название - дата" */}
      <div
        className="flex-1 overflow-y-auto p-8"
        style={{ paddingBottom: 'calc(32px + env(safe-area-inset-bottom))' }}
      >
        <div className="max-w-2xl mx-auto">
          {sessions === null ? (
            <div className="text-sm text-gray-400 text-center py-8">
              {loadError ? (
                <>
                  <div className="mb-4">{t('Не удалось загрузить пройденные маршруты')}</div>
                  <button
                    onClick={load}
                    className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium"
                  >
                    {t('Повторить')}
                  </button>
                </>
              ) : t('Загрузка...')}
            </div>
          ) : sessions.filter((s) => s.route_title !== null).length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-8">
              {t('Пока нет пройденных маршрутов')}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {/* Прохождения удалённых маршрутов не показываем */}
              {sessions.filter((s) => s.route_title !== null).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSession(s)}
                  className="pp-plain w-full flex items-center justify-between gap-3 py-3 text-left active:bg-gray-50"
                >
                  <span className="text-sm font-medium text-gray-700 truncate">{s.route_title}</span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm text-gray-800">{formatCompletedDate(s.finished_at, language)}</span>
                    <ChevronBackwardIcon size={12} color="#9CA3AF" rotate={180} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnItPastRoutes;
