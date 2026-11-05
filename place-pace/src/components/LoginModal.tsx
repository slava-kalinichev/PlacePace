import React, { useState, useEffect, useRef } from 'react';
import { api, type AuthUser } from '../api/client';
import { useHeaderHeightReporter, useMeasuredWidth, useTooltipEdgeOffset, layerTransform, layerBoxShadow, layerScrimOpacity, DEFAULT_HEADER_HEIGHT, CARD_WIDTH, CARD_HEIGHT, trafficLightZone } from './layerGeometry';
import { InfoCircleIcon, ChevronBackwardIcon } from './sfSymbols';
import TrafficLight from './TrafficLight';
import { showInfoPlaque } from './InfoPlaque';
import AnimatedAccountLogo from './AnimatedAccountLogo';
import { useTranslation } from '../i18n/LanguageContext';

const RESET_COOLDOWN_SECONDS = 120;

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (user: AuthUser) => void;
  onOpenRegister: () => void;
  zIndex: number;
  offsetX: number;
  offsetY: number;
  isTop: boolean;
  depth: number;
  onHeaderHeight?: (px: number) => void;
  // true - окно на весь экран (мобильный On It)
  fullBleedMobile?: boolean;
  // true - без кнопки "Назад" (входной экран On It)
  hideBackButton?: boolean;
}

// Плавающий лейбл поля (Tailwind peer)
const floatingLabelClass =
  'absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400 transition-all duration-200 pointer-events-none ' +
  'peer-focus:top-2.5 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-gray-500 ' +
  'peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-xs peer-[:not(:placeholder-shown)]:text-gray-500';

// Несимметричные отступы: текст ближе к нижней границе
const floatingInputClass =
  'peer w-full pt-6 pb-1 px-4 bg-transparent text-sm text-gray-800 focus:outline-none placeholder:text-transparent';

// Мобильный вариант: шрифт 16px, чтобы iOS не зумила страницу
const floatingInputClassMobile = floatingInputClass.replace('text-sm', 'text-base') + ' appearance-none';

// Явный font-family и appearance для полей на iOS
const mobileFormFieldStyle: React.CSSProperties = {
  WebkitAppearance: 'none',
  appearance: 'none',
  fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
};

type View = 'login' | 'forgot-form' | 'forgot-sent';

const LoginModal = ({ isOpen, onClose, onLogin, onOpenRegister, zIndex, offsetX, offsetY, isTop, depth, onHeaderHeight, fullBleedMobile, hideBackButton }: LoginModalProps) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const { wrapRef: infoTooltipRef, arrowOffset: infoArrowOffset } = useTooltipEdgeOffset(showInfo);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [view, setView] = useState<View>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetSending, setResetSending] = useState(false);
  const [resetAvailableAt, setResetAvailableAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeightReporter(headerRef, onHeaderHeight);
  // Светофор вместо заголовка при наведении
  const [showTrafficLight, setShowTrafficLight] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleWidth = useMeasuredWidth(titleRef);
  const infoIconRef = useRef<HTMLDivElement>(null);

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
      setLogin('');
      setPassword('');
      setView('login');
      setResetEmail('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (view !== 'forgot-sent') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [view]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password) return;

    const result = await api.login(login.trim(), password);
    if (result.success) {
      onLogin(result);
      onClose();
    } else if (result.needs_confirmation) {
      // Пароль верный, но почта не подтверждена: бэкенд уже переотправил письмо
      showInfoPlaque(`${t(result.error)} ${result.email ?? ''}`.trim(), 'warning');
    } else {
      showInfoPlaque(t(result.error), 'error');
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim() || resetSending) return;
    setResetSending(true);
    await api.requestPasswordReset(resetEmail.trim());
    setResetSending(false);
    setResetAvailableAt(Date.now() + RESET_COOLDOWN_SECONDS * 1000);
    setView('forgot-sent');
  };

  const handleResendReset = async () => {
    if (now < resetAvailableAt || resetSending) return;
    setResetSending(true);
    await api.requestPasswordReset(resetEmail.trim());
    setResetSending(false);
    setResetAvailableAt(Date.now() + RESET_COOLDOWN_SECONDS * 1000);
    showInfoPlaque(t('Письмо отправлено повторно'), 'info');
  };

  if (!isOpen) return null;

  const remainingSeconds = Math.max(0, Math.ceil((resetAvailableAt - now) / 1000));
  const canResendReset = remainingSeconds <= 0 && !resetSending;
  const resetMinutes = Math.floor(remainingSeconds / 60);
  const resetSeconds = remainingSeconds % 60;

  return (
    <>
      {/* Модальное окно */}
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
          {/* Заголовок фиксированной высоты; зона светофора - от края окна до конца заголовка */}
          <div
            ref={headerRef}
            className="border-b border-gray-100 flex-shrink-0 relative"
            style={{ height: DEFAULT_HEADER_HEIGHT, paddingTop: fullBleedMobile ? 'env(safe-area-inset-top)' : undefined }}
            onMouseMove={(e) => {
              if (fullBleedMobile) return;
              const rect = e.currentTarget.getBoundingClientRect();
              // Зона не уже самого светофора
              let zone = trafficLightZone(24, titleWidth);
              // ...и не перекрывает значок "i"
              if (infoIconRef.current) {
                const iconLeft = infoIconRef.current.getBoundingClientRect().left - rect.left;
                zone = Math.min(zone, iconLeft - 4);
              }
              setShowTrafficLight(e.clientX - rect.left <= zone);
            }}
            onMouseLeave={() => { if (!fullBleedMobile) setShowTrafficLight(false); }}
          >
            {fullBleedMobile ? (
              <div className={`absolute inset-0 flex items-center gap-3 pr-6 ${hideBackButton ? 'pl-6' : 'pl-3'}`}>
                {!hideBackButton && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label={t('Закрыть')}
                    className="pp-plain w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center active:bg-gray-50 flex-shrink-0"
                  >
                    <ChevronBackwardIcon size={16} color="#000000" style={{ transform: 'translateX(-1.5px)' }} />
                  </button>
                )}
                <h2 className="text-lg font-semibold text-gray-800 truncate">{t('Вход в аккаунт')}</h2>
              </div>
            ) : (
              <>
            <div
              className="absolute inset-0 flex items-center gap-2 pl-6 pr-6 transition-opacity duration-150"
              style={{ opacity: showTrafficLight ? 0 : 1, transitionDelay: showTrafficLight ? '0ms' : '150ms' }}
            >
              <h2 ref={titleRef} className="text-xl font-semibold text-gray-800 flex-shrink-0">{t('Вход в аккаунт')}</h2>
              <div ref={infoIconRef} className="relative">
                <button
                  onMouseEnter={() => setShowInfo(true)}
                  onMouseLeave={() => setShowInfo(false)}
                  className="w-5 h-5 rounded-full text-gray-400 flex items-center justify-center"
                >
                  <InfoCircleIcon size={18} />
                </button>
                {showInfo && (
                  <div
                    ref={infoTooltipRef}
                    className="pp-tooltip-wrap absolute top-full mt-2 left-1/2 z-10 w-64"
                    style={{ transform: `translateX(calc(-50% + ${infoArrowOffset}px))` }}
                  >
                    <div className="pp-tooltip">
                      {t('Все изменения текущей сессии сохраняются при входе в аккаунт')}
                    </div>
                    <div
                      className="pp-tooltip-arrow pp-tooltip-arrow--top"
                      style={{ left: `calc(50% - ${infoArrowOffset}px)` }}
                    />
                  </div>
                )}
              </div>
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

          {/* Форма */}
          <div className="flex-1 overflow-y-auto p-8 flex items-center justify-center">
            <div className="w-full max-w-sm flex flex-col items-center">
              {isVisible && <AnimatedAccountLogo />}
              <h1 className="mt-5 text-2xl font-semibold text-gray-900">{t('Place Pace Аккаунт')}</h1>
              <p className="mt-1.5 text-sm text-gray-400 text-center">{t('За пределами карты. Внутри города.')}</p>

              {view !== 'forgot-sent' && (
                <div className="w-full mt-8">
                  {/* Форма входа задаёт высоту, форма восстановления лежит поверх */}
                  <div className="relative">
                    <form
                      id="pp-login-form"
                      onSubmit={handleSubmit}
                      className="space-y-3"
                      style={{
                        opacity: view === 'login' ? 1 : 0,
                        visibility: view === 'login' ? 'visible' : 'hidden',
                        pointerEvents: view === 'login' ? 'auto' : 'none',
                        transform: view === 'login' ? 'translateY(0)' : 'translateY(-8px)',
                        transition: 'opacity 350ms cubic-bezier(0.4, 0, 0.2, 1), transform 350ms cubic-bezier(0.4, 0, 0.2, 1), visibility 350ms',
                      }}
                    >
                      <div className="rounded-2xl border border-gray-200 overflow-hidden">
                        <div className="relative border-b border-gray-100">
                          <input
                            id="pp-login-identifier"
                            type="text"
                            value={login}
                            onChange={(e) => setLogin(e.target.value)}
                            placeholder=" "
                            className={fullBleedMobile ? floatingInputClassMobile : floatingInputClass}
                            style={fullBleedMobile ? mobileFormFieldStyle : undefined}
                            required={view === 'login'}
                          />
                          <label htmlFor="pp-login-identifier" className={floatingLabelClass}>
                            {t('Email или логин')}
                          </label>
                        </div>
                        <div className="relative">
                          <input
                            id="pp-login-password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder=" "
                            className={fullBleedMobile ? floatingInputClassMobile : floatingInputClass}
                            style={fullBleedMobile ? mobileFormFieldStyle : undefined}
                            required={view === 'login'}
                          />
                          <label htmlFor="pp-login-password" className={floatingLabelClass}>
                            {t('Пароль')}
                          </label>
                        </div>
                      </div>

                      <div className="text-right">
                        <button
                          type="button"
                          tabIndex={view === 'login' ? 0 : -1}
                          onClick={() => { setResetEmail(login.includes('@') ? login : ''); setView('forgot-form'); }}
                          className="pp-plain text-sm text-blue-500 hover:text-blue-600 cursor-pointer transition-colors"
                        >
                          {t('Забыли пароль?')}
                        </button>
                      </div>
                    </form>

                    <form
                      id="pp-forgot-form"
                      onSubmit={handleRequestReset}
                      className="absolute inset-0"
                      style={{
                        opacity: view === 'forgot-form' ? 1 : 0,
                        visibility: view === 'forgot-form' ? 'visible' : 'hidden',
                        pointerEvents: view === 'forgot-form' ? 'auto' : 'none',
                        transform: view === 'forgot-form' ? 'translateY(0)' : 'translateY(8px)',
                        transition: 'opacity 350ms cubic-bezier(0.4, 0, 0.2, 1), transform 350ms cubic-bezier(0.4, 0, 0.2, 1), visibility 350ms',
                      }}
                    >
                      <div className="rounded-2xl border border-gray-200 overflow-hidden">
                        <div className="relative">
                          <input
                            id="pp-reset-email"
                            type="email"
                            value={resetEmail}
                            onChange={(e) => setResetEmail(e.target.value)}
                            placeholder=" "
                            className={fullBleedMobile ? floatingInputClassMobile : floatingInputClass}
                            style={fullBleedMobile ? mobileFormFieldStyle : undefined}
                            required={view === 'forgot-form'}
                            tabIndex={view === 'forgot-form' ? 0 : -1}
                          />
                          <label htmlFor="pp-reset-email" className={floatingLabelClass}>
                            {t('Email')}
                          </label>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 text-center px-2 mt-3">
                        {t('Укажите email, привязанный к аккаунту, — мы отправим на него ссылку для сброса пароля')}
                      </p>
                    </form>
                  </div>

                  <button
                    type="submit"
                    form={view === 'login' ? 'pp-login-form' : 'pp-forgot-form'}
                    disabled={view === 'forgot-form' && resetSending}
                    className="w-full py-2.5 rounded-xl bg-blue-500 text-white text-sm font-medium disabled:opacity-60 mt-3"
                  >
                    {view === 'login' ? t('Войти') : t('Отправить')}
                  </button>

                  <div className="text-center pt-4">
                    {view === 'login' ? (
                      <span
                        className="text-sm text-gray-800 hover:text-gray-600 cursor-pointer transition-colors"
                        onClick={onOpenRegister}
                      >
                        {t('Регистрация')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setView('login')}
                        className="pp-plain text-sm text-gray-500 hover:text-gray-600 cursor-pointer transition-colors"
                      >
                        {t('Назад ко входу')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {view === 'forgot-sent' && (
                <div className="w-full mt-8 flex flex-col items-center text-center">
                  <p className="text-sm text-gray-500 leading-relaxed">
                    {t('Если аккаунт с таким email существует, мы отправили на него письмо со ссылкой для сброса пароля')}
                  </p>
                  <p className="text-sm font-medium text-gray-800 mt-2 mb-6 break-all">{resetEmail}</p>
                  <button
                    type="button"
                    onClick={handleResendReset}
                    disabled={!canResendReset}
                    className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      canResendReset ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {canResendReset
                      ? t('Отправить письмо повторно')
                      : `${t('Отправить повторно через')} ${resetMinutes}:${resetSeconds.toString().padStart(2, '0')}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('login')}
                    className="pp-plain text-sm text-gray-500 hover:text-gray-600 cursor-pointer transition-colors mt-4"
                  >
                    {t('Назад ко входу')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Затемнение слоёв глубже верхнего */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ zIndex: 40, backgroundColor: '#0f172a', opacity: layerScrimOpacity(depth), transition: 'opacity 0.3s ease' }}
          />
        </div>
      </div>
    </>
  );
};

export default LoginModal;
