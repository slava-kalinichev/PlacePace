// Диалог выбора при конфликте часов работы после сдвига времени
import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n/LanguageContext';
import type { WalkShiftConflict } from '../api/client';
import { ONIT_MODAL_Z } from './onitLayout';
import { minutesToTime } from './routeTimeShift';

export type ShiftResolution = 'auto_adjust' | 'cancel' | { exclude: (string | number)[] };

// Длительность входа, мс
const ENTER_MS = 320;

interface ShiftConflictDialogProps {
  conflicts: WalkShiftConflict[];
  // null - подгонка невозможна, кнопка скрыта
  maxFitEndMinutes: number | null;
  onResolve: (resolution: ShiftResolution) => void;
}

const ShiftConflictDialog = ({ conflicts, maxFitEndMinutes, onResolve }: ShiftConflictDialogProps) => {
  const { t } = useTranslation();

  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="fixed inset-0 bg-white flex flex-col" style={{ zIndex: ONIT_MODAL_Z +10 }}>
      <div
        className="flex-1 flex flex-col px-6 overflow-hidden"
        style={{
          paddingTop: 'calc(28px + env(safe-area-inset-top))',
          paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(16px)',
          transition: `opacity ${ENTER_MS}ms ease, transform ${ENTER_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
        }}
      >
        <h2 className="text-xl font-semibold text-gray-800 mb-2">{t('Конфликт часов работы')}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {t('При таком сдвиге вы не успеете попасть в часы работы следующих точек:')}
        </p>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {conflicts.map(conflict => (
            <div key={conflict.item_id} className="text-sm text-gray-700 py-1.5 border-b border-gray-100 last:border-0">
              {conflict.reason}
            </div>
          ))}
        </div>

        {/* Кнопки действий */}
        <div className="mt-5 flex flex-col items-center gap-2 flex-shrink-0">
          {maxFitEndMinutes != null && (
            <div className="w-full flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => onResolve('auto_adjust')}
                className="w-full px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium active:bg-blue-600"
              >
                {t('Сократить визит')}
              </button>
              {/* Пояснение: итоговое время при подгонке */}
              <p className="text-xs text-gray-400 text-center px-2">
                {t('Визит закончится в')} {minutesToTime(maxFitEndMinutes)} {t('— ровно чтобы вы успели попасть в часы работы следующих точек.')}
              </p>
            </div>
          )}
          <div className="w-full flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => onResolve({ exclude: conflicts.map(c => c.item_id) })}
              className="w-full px-4 py-2 rounded-xl bg-gray-100 text-gray-800 text-sm font-medium active:bg-gray-200"
            >
              {t('Исключить эти точки')}
            </button>
            {/* Пояснение: что произойдёт при исключении точек */}
            <p className="text-xs text-gray-400 text-center px-2">
              {conflicts.length === 1
                ? t('Точка будет полностью убрана из маршрута вместе с переходом к ней, а точки до и после неё соединит новый прямой переход.')
                : t('Эти точки будут полностью убраны из маршрута вместе с переходами к ним, а точки вокруг них соединит новый прямой переход.')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onResolve('cancel')}
            className="px-4 py-2 rounded-xl text-gray-500 text-sm font-medium active:bg-gray-50"
          >
            {t('Отмена')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShiftConflictDialog;
