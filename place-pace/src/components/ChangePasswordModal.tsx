import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { api } from '../api/client';
import { useHeaderHeightReporter, useMeasuredWidth, layerTransform, layerBoxShadow, layerScrimOpacity, DEFAULT_HEADER_HEIGHT, CARD_WIDTH, CARD_HEIGHT, trafficLightZone } from './layerGeometry';
import TrafficLight from './TrafficLight';
import { showInfoPlaque } from './InfoPlaque';
import { useTranslation } from '../i18n/LanguageContext';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  zIndex: number;
  offsetX: number;
  offsetY: number;
  isTop: boolean;
  depth: number;
  onHeaderHeight?: (px: number) => void;
}

// Inline-стиль полей пароля
const mobileFormFieldStyle: CSSProperties = {
  WebkitAppearance: 'none',
  appearance: 'none',
  fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
};

const ChangePasswordModal = ({ isOpen, onClose, zIndex, offsetX, offsetY, isTop, depth, onHeaderHeight }: ChangePasswordModalProps) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
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
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      showInfoPlaque(t('Заполните все поля'), 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showInfoPlaque(t('Пароли не совпадают'), 'error');
      return;
    }

    const result = await api.changePassword(currentPassword, newPassword);
    if (result.success) {
      showInfoPlaque(t('Пароль изменён'), 'success');
      onClose();
    } else {
      showInfoPlaque(t(result.error), 'error');
    }
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
              <h2 ref={titleRef} className="text-xl font-semibold text-gray-800">{t('Сменить пароль')}</h2>
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
            <form onSubmit={handleSubmit} className="w-full max-w-md space-y-5">
              {/* 16px вместо 14px (iOS-зум на фокусе) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t('Текущий пароль')}
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={t('Введите текущий пароль')}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base appearance-none transition-all placeholder:text-gray-400"
                  style={mobileFormFieldStyle}
                  required
                />
              </div>

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
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ zIndex: 40, backgroundColor: '#0f172a', opacity: layerScrimOpacity(depth), transition: 'opacity 0.3s ease' }}
          />
        </div>
      </div>
    </>
  );
};

export default ChangePasswordModal;
