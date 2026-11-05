import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { useHeaderHeightReporter, useMeasuredWidth, layerTransform, layerBoxShadow, layerScrimOpacity, DEFAULT_HEADER_HEIGHT, CARD_WIDTH, CARD_HEIGHT, trafficLightZone } from './layerGeometry';
import TrafficLight from './TrafficLight';
import { showInfoPlaque } from './InfoPlaque';
import EmailConfirmationPending from './EmailConfirmationPending';
import { useTranslation } from '../i18n/LanguageContext';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface ChangeEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  zIndex: number;
  offsetX: number;
  offsetY: number;
  isTop: boolean;
  depth: number;
  onHeaderHeight?: (px: number) => void;
}

const ChangeEmailModal = ({ isOpen, onClose, zIndex, offsetX, offsetY, isTop, depth, onHeaderHeight }: ChangeEmailModalProps) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  // Текущий подтверждённый email (null - не привязан)
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeightReporter(headerRef, onHeaderHeight);
  const [showTrafficLight, setShowTrafficLight] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleWidth = useMeasuredWidth(titleRef);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsVisible(true), 50);
      api.getProfile().then(p => setCurrentEmail(p.email)).catch(() => {});
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setNewEmail('');
      setPassword('');
      setPendingEmail(null);
    }
  }, [isOpen]);

  const isLinking = !currentEmail;
  const title = isLinking ? t('Привязать email') : t('Сменить email');

  // Пока открыт экран ожидания, опрашиваем /profile
  useEffect(() => {
    if (!pendingEmail) return;
    const wasLinking = isLinking;
    const interval = setInterval(async () => {
      const profile = await api.getProfile().catch(() => null);
      if (profile && !profile.pending_email && profile.email === pendingEmail) {
        clearInterval(interval);
        showInfoPlaque(wasLinking ? t('Email привязан к аккаунту') : t('Email сменён'), 'success');
        onClose();
      }
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newEmail.trim();
    if (!trimmed || !password) {
      showInfoPlaque(t('Заполните все поля'), 'error');
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      showInfoPlaque(t('Введите корректный email'), 'error');
      return;
    }

    const result = await api.changeEmail(trimmed, password);
    if (result.success && result.email) {
      setPendingEmail(result.email);
    } else if (!result.success) {
      const isConflict = result.error.includes('уже используется');
      showInfoPlaque(t(result.error), isConflict ? 'warning' : 'error');
    }
  };

  const handleResend = () => api.resendVerification();

  const handleChangeEmail = async (email: string) => {
    if (!EMAIL_RE.test(email)) {
      return { success: false, error: 'Введите корректный email' };
    }
    const result = await api.resendVerification(email);
    if (result.success && result.email) {
      setPendingEmail(result.email);
    }
    return result;
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Модальное окно */}
      <div
        className="fixed inset-0 flex items-center justify-center transition-opacity duration-300"
        style={{ opacity: isVisible ? 1 : 0, zIndex, pointerEvents: 'none' }}
      >
        <div
          className="pp-modal relative bg-white rounded-2xl flex flex-col overflow-hidden"
          style={{
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
            style={{ height: DEFAULT_HEADER_HEIGHT }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setShowTrafficLight(e.clientX - rect.left <= trafficLightZone(24, titleWidth));
            }}
            onMouseLeave={() => setShowTrafficLight(false)}
          >
            <div
              className="absolute inset-0 flex items-center pl-6 pr-6 transition-opacity duration-150"
              style={{ opacity: showTrafficLight ? 0 : 1, transitionDelay: showTrafficLight ? '0ms' : '150ms' }}
            >
              <h2 ref={titleRef} className="text-xl font-semibold text-gray-800">{title}</h2>
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
          </div>

          <div className="flex-1 overflow-y-auto p-8 flex items-center justify-center">
            {/* 16px вместо 14px без ветвления (iOS-зум) */}
            {pendingEmail ? (
              <EmailConfirmationPending
                email={pendingEmail}
                variant="change"
                onResend={handleResend}
                onChangeEmail={handleChangeEmail}
              />
            ) : (
              <form onSubmit={handleSubmit} className="w-full max-w-md space-y-5">
                {currentEmail && (
                  <div>
                    <label className="block text-sm text-gray-500 mb-1.5">{t('Текущий email')}</label>
                    <div className="inline-flex items-center h-6 px-4 bg-gray-50 border border-gray-200 rounded-full text-sm text-gray-800">
                      {currentEmail}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {t('Новый email')}
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder={t('Введите email')}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base transition-all placeholder:text-gray-400"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {t('Пароль')}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('Введите пароль для подтверждения')}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base transition-all placeholder:text-gray-400"
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
            )}
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

export default ChangeEmailModal;
