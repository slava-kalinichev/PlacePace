import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { api, type AuthUser } from '../api/client';
import { useHeaderHeightReporter, useMeasuredWidth, layerTransform, layerBoxShadow, layerScrimOpacity, DEFAULT_HEADER_HEIGHT, CARD_WIDTH, CARD_HEIGHT, trafficLightZone } from './layerGeometry';
import TrafficLight from './TrafficLight';
import { showInfoPlaque } from './InfoPlaque';
import AnimatedAccountLogo from './AnimatedAccountLogo';
import { ChevronBackwardIcon } from './sfSymbols';
import { useTranslation } from '../i18n/LanguageContext';

interface ResetPasswordModalProps {
  isOpen: boolean;
  token: string | null;
  onClose: () => void;
  onReset: (user: AuthUser) => void;
  zIndex: number;
  offsetX: number;
  offsetY: number;
  isTop: boolean;
  depth: number;
  onHeaderHeight?: (px: number) => void;
  fullBleedMobile?: boolean;
  // Колбэк для уведомлений там, где плашки не смонтированы
  onNotice?: (text: string, kind: 'success' | 'error') => void;
}

// iOS-фикс маски пароля и зума
const mobileFormFieldStyle: CSSProperties = {
  WebkitAppearance: 'none',
  appearance: 'none',
  fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
};

const ResetPasswordModal = ({ isOpen, token, onClose, onReset, zIndex, offsetX, offsetY, isTop, depth, onHeaderHeight, fullBleedMobile, onNotice }: ResetPasswordModalProps) => {
  const { t } = useTranslation();
  const notify = (text: string, kind: 'success' | 'error') => (onNotice ? onNotice(text, kind) : showInfoPlaque(text, kind));
  const [isVisible, setIsVisible] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeightReporter(headerRef, onHeaderHeight);
  const [showTrafficLight, setShowTrafficLight] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleWidth = useMeasuredWidth(titleRef);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (!newPassword || !confirmPassword) {
      notify(t('Заполните все поля'), 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      notify(t('Пароли не совпадают'), 'error');
      return;
    }

    const result = await api.resetPassword(token, newPassword);
    if (result.success) {
      onReset(result);
      notify(t('Пароль изменён'), 'success');
      onClose();
    } else {
      notify(t(result.error), 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 flex items-center justify-center transition-opacity duration-300"
        style={{ opacity: isVisible ? 1 : 0, zIndex, pointerEvents: 'none' }}
      >
        <div
          className="pp-modal relative bg-white rounded-2xl flex flex-col overflow-hidden"
          style={fullBleedMobile ? {
            pointerEvents: isTop ? 'auto' : 'none',
            width: '100%',
            height: '100dvh',
            position: 'fixed',
            top: 0,
            left: 0,
            borderRadius: 0,
            opacity: isVisible ? 1 : 0,
            boxShadow: 'none',
            transition: 'opacity 0.3s ease',
          } : {
            pointerEvents: isTop ? 'auto' : 'none',
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: layerTransform(offsetX, offsetY, isVisible ? 1 : 0.95),
            opacity: isVisible ? 1 : 0,
            boxShadow: layerBoxShadow(depth),
            transition: 'all 0.3s ease, box-shadow 0.3s ease',
          }}
        >
          <div
            ref={headerRef}
            className="border-b border-gray-100 flex-shrink-0 relative"
            style={{ height: DEFAULT_HEADER_HEIGHT, paddingTop: fullBleedMobile ? 'env(safe-area-inset-top)' : undefined }}
            onMouseMove={(e) => {
              if (fullBleedMobile) return;
              const rect = e.currentTarget.getBoundingClientRect();
              setShowTrafficLight(e.clientX - rect.left <= trafficLightZone(24, titleWidth));
            }}
            onMouseLeave={() => { if (!fullBleedMobile) setShowTrafficLight(false); }}
          >
            {fullBleedMobile ? (
              <div className="absolute inset-0 flex items-center gap-3 pl-3 pr-6">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t('Закрыть')}
                  className="pp-plain w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center active:bg-gray-50 flex-shrink-0"
                >
                  <ChevronBackwardIcon size={16} color="#000000" style={{ transform: 'translateX(-1.5px)' }} />
                </button>
                <h2 className="text-lg font-semibold text-gray-800 truncate">{t('Восстановление пароля')}</h2>
              </div>
            ) : (
              <>
            <div
              className="absolute inset-0 flex items-center pl-6 pr-6 transition-opacity duration-150"
              style={{ opacity: showTrafficLight ? 0 : 1, transitionDelay: showTrafficLight ? '0ms' : '150ms' }}
            >
              <h2 ref={titleRef} className="text-xl font-semibold text-gray-800">{t('Восстановление пароля')}</h2>
            </div>
            <div
              className="absolute inset-0 flex items-center pl-6 transition-opacity duration-150"
              style={{
                opacity: showTrafficLight ? 1 : 0,
                transitionDelay: showTrafficLight ? '150ms' : '0ms',
                pointerEvents: showTrafficLight ? 'auto' : 'none',
              }}
            >
              <TrafficLight onClose={onClose} fullscreenAvailable={false} />
            </div>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-8 flex items-center justify-center">
            <div className="w-full max-w-md flex flex-col items-center">
              {isVisible && <AnimatedAccountLogo />}
              <form onSubmit={handleSubmit} className="w-full mt-8 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t('Новый пароль')}
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('Введите новый пароль')}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base appearance-none transition-all placeholder:text-gray-400"
                  style={mobileFormFieldStyle}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t('Подтвердите новый пароль')}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('Введите новый пароль ещё раз')}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base appearance-none transition-all placeholder:text-gray-400"
                  style={mobileFormFieldStyle}
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-blue-500 text-white text-sm font-medium"
              >
                {t('Подтвердить')}
              </button>
              </form>
            </div>
          </div>

          <div
            className="absolute inset-0 pointer-events-none"
            style={{ zIndex: 40, backgroundColor: '#0f172a', opacity: layerScrimOpacity(depth), transition: 'opacity 0.3s ease' }}
          />
        </div>
      </div>
    </>
  );
};

export default ResetPasswordModal;
