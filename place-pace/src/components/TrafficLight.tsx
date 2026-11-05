// Светофор в стиле macOS (закрыть, свернуть, развернуть)
import { useTranslation } from '../i18n/LanguageContext';

interface TrafficLightProps {
  onClose: () => void;
  fullscreenAvailable: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const DOT_SIZE = 14;
const GAP = 9;
// Полная ширина трёх кружков с зазорами
export const TRAFFIC_LIGHT_WIDTH = DOT_SIZE * 3 + GAP * 2;

// Цвета - максимально близко к реальным macOS light-appearance значениям
const RED_FILL = '#FF5F57';
const RED_BORDER = '#E0443E';
const GRAY_FILL = '#DDDDDD';
const GRAY_BORDER = '#BFBFBF';
const GREEN_FILL = '#28C840';
const GREEN_BORDER = '#1AAB29';

const TrafficLight = ({ onClose, fullscreenAvailable, isFullscreen = false, onToggleFullscreen }: TrafficLightProps) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center" style={{ gap: GAP }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="rounded-full flex-shrink-0"
        style={{ width: DOT_SIZE, height: DOT_SIZE, backgroundColor: RED_FILL, border: `0.5px solid ${RED_BORDER}` }}
        aria-label={t('Закрыть')}
      />

      {/* Жёлтый - чисто декоративный, всегда серый, без onClick */}
      <div
        className="rounded-full flex-shrink-0"
        style={{ width: DOT_SIZE, height: DOT_SIZE, backgroundColor: GRAY_FILL, border: `0.5px solid ${GRAY_BORDER}`, cursor: 'default' }}
        aria-hidden="true"
      />

      <button
        type="button"
        disabled={!fullscreenAvailable}
        onClick={(e) => {
          e.stopPropagation();
          if (fullscreenAvailable) onToggleFullscreen?.();
        }}
        className="rounded-full flex-shrink-0"
        style={{
          width: DOT_SIZE,
          height: DOT_SIZE,
          backgroundColor: fullscreenAvailable ? GREEN_FILL : GRAY_FILL,
          border: `0.5px solid ${fullscreenAvailable ? GREEN_BORDER : GRAY_BORDER}`,
          cursor: fullscreenAvailable ? 'pointer' : 'default',
        }}
        aria-label={t(isFullscreen ? 'Свернуть' : 'На весь экран')}
      />
    </div>
  );
};

export default TrafficLight;
