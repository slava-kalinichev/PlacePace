import React, { useState, useEffect, useRef } from 'react';
import { api, type AuthUser } from '../api/client';
import { InfoCircleIcon, HouseFillIcon, ChevronBackwardIcon } from './sfSymbols';
import { useHeaderHeightReporter, useMeasuredWidth, useTooltipEdgeOffset, layerTransform, layerBoxShadow, layerScrimOpacity, DEFAULT_HEADER_HEIGHT, CARD_WIDTH, CARD_HEIGHT, trafficLightZone } from './layerGeometry';
import TrafficLight from './TrafficLight';
import { showInfoPlaque } from './InfoPlaque';
import EmailConfirmationPending from './EmailConfirmationPending';
import AddressAutocomplete from './AddressAutocomplete';
import { useTranslation } from '../i18n/LanguageContext';

const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Стиль полей формы; на мобильном шрифт 16px (iOS)
const registerInputClass =
  'w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm transition-all placeholder:text-gray-400';
const registerInputClassMobile = registerInputClass.replace('text-sm', 'text-base') + ' appearance-none';

const mobileFormFieldStyle: React.CSSProperties = {
  WebkitAppearance: 'none',
  appearance: 'none',
  fontFamily: "'SF Pro Text', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
};

interface RegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImmediateLogin: (user: AuthUser) => void;
  zIndex: number;
  offsetX: number;
  offsetY: number;
  isTop: boolean;
  depth: number;
  onHeaderHeight?: (px: number) => void;
  // true - слой закрыт и ждёт окна отмены, но остаётся смонтированным
  suspended?: boolean;
  onEmptyChange?: (empty: boolean) => void;
  // Вызывается, когда регистрация ждёт подтверждения почты
  onPendingConfirmation?: () => void;
  fullBleedMobile?: boolean;
}

const RegisterModal = ({ isOpen, onClose, onImmediateLogin, zIndex, offsetX, offsetY, isTop, depth, onHeaderHeight, suspended, onEmptyChange, onPendingConfirmation, fullBleedMobile }: RegisterModalProps) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const { wrapRef: infoTooltipRef, arrowOffset: infoArrowOffset } = useTooltipEdgeOffset(showInfo);
  const [showLoginInfo, setShowLoginInfo] = useState(false);
  const { wrapRef: loginInfoTooltipRef, arrowOffset: loginInfoArrowOffset } = useTooltipEdgeOffset(showLoginInfo);
  const [showEmailInfo, setShowEmailInfo] = useState(false);
  const { wrapRef: emailInfoTooltipRef, arrowOffset: emailInfoArrowOffset } = useTooltipEdgeOffset(showEmailInfo);
  const [showHomeInfo, setShowHomeInfo] = useState(false);
  const { wrapRef: homeInfoTooltipRef, arrowOffset: homeInfoArrowOffset } = useTooltipEdgeOffset(showHomeInfo);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [login, setLogin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [homeAddress, setHomeAddress] = useState('');
  const [homeCoords, setHomeCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [requireEmail, setRequireEmail] = useState(true);
  // Пока не null - показываем экран ожидания подтверждения вместо формы
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeightReporter(headerRef, onHeaderHeight);
  const [showTrafficLight, setShowTrafficLight] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleWidth = useMeasuredWidth(titleRef);
  const infoIconRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsVisible(true), 50);
      api.getAppSettings().then(s => setRequireEmail(s.require_email_verification)).catch(() => {});
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setFirstName('');
      setLastName('');
      setLogin('');
      setEmail('');
      setPassword('');
      setHomeAddress('');
      setHomeCoords(null);
      setPendingEmail(null);
    }
  }, [isOpen]);

  useEffect(() => {
    onEmptyChange?.(!firstName && !lastName && !login && !email && !password && !homeAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName, lastName, login, email, password, homeAddress]);

  // Пока открыт экран ожидания, опрашиваем подтверждение (оно может пройти в другой вкладке)
  useEffect(() => {
    if (!pendingEmail) return;
    const interval = setInterval(async () => {
      const result = await api.getRegistrationStatus();
      if (result.confirmed) {
        clearInterval(interval);
        onImmediateLogin(result);
        showInfoPlaque(`${t('Добро пожаловать в Place Pace,')} ${result.first_name}!`, 'success');
        onClose();
      }
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEmail]);

  const homeConfirmed = !homeAddress.trim() || !!homeCoords;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!firstName.trim() || !lastName.trim() || !login.trim() || !password) {
      showInfoPlaque(t('Заполните все поля'), 'error');
      return;
    }
    if (!USERNAME_RE.test(login.trim())) {
      showInfoPlaque(t('Логин может содержать только латинские буквы, цифры и нижнее подчёркивание, от 3 до 30 символов'), 'error');
      return;
    }
    const trimmedEmail = email.trim();
    if (requireEmail && !trimmedEmail) {
      showInfoPlaque(t('Укажите email'), 'error');
      return;
    }
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      showInfoPlaque(t('Введите корректный email'), 'error');
      return;
    }
    if (homeAddress.trim() && !homeConfirmed) {
      showInfoPlaque(t('Выберите адрес из списка предложенных'), 'error');
      return;
    }

    const result = await api.register({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      username: login.trim(),
      password,
      email: trimmedEmail || undefined,
      home_address: homeAddress.trim() || undefined,
      home_lat: homeAddress.trim() ? homeCoords?.lat : undefined,
      home_lon: homeAddress.trim() ? homeCoords?.lon : undefined,
    });

    if (!result.success) {
      const isConflict = result.error.includes('уже существует') || result.error.includes('уже используется');
      showInfoPlaque(t(result.error), isConflict ? 'warning' : 'error');
      return;
    }

    if ('pending_email_confirmation' in result) {
      onPendingConfirmation?.();
      setPendingEmail(result.email);
    } else {
      // Без email аккаунт активен сразу
      onImmediateLogin(result);
      showInfoPlaque(`${t('Добро пожаловать в Place Pace,')} ${result.first_name}!`, 'success');
      onClose();
    }
  };

  const handleResend = () => api.resendVerification();

  const handleChangeEmail = async (newEmail: string) => {
    if (!EMAIL_RE.test(newEmail)) {
      // Перевод выполняет EmailConfirmationPending
      return { success: false, error: 'Введите корректный email' };
    }
    const result = await api.resendVerification(newEmail);
    if (result.success && result.email) {
      setEmail(result.email);
      setPendingEmail(result.email);
    }
    return result;
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
            pointerEvents: suspended ? 'none' : (isTop ? 'auto' : 'none'),
            width: '100%',
            height: '100dvh',
            position: 'fixed',
            top: 0,
            left: 0,
            borderRadius: 0,
            opacity: suspended ? 0 : (isVisible ? 1 : 0),
            boxShadow: 'none',
            transition: 'opacity 0.3s ease',
          } : {
            pointerEvents: suspended ? 'none' : (isTop ? 'auto' : 'none'),
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: layerTransform(offsetX, offsetY, isVisible ? 1 : 0.95),
            opacity: suspended ? 0 : (isVisible ? 1 : 0),
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
              let zone = trafficLightZone(24, titleWidth);
              if (infoIconRef.current) {
                const iconLeft = infoIconRef.current.getBoundingClientRect().left - rect.left;
                zone = Math.min(zone, iconLeft - 4);
              }
              setShowTrafficLight(e.clientX - rect.left <= zone);
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
                <h2 className="text-lg font-semibold text-gray-800 truncate">{t('Регистрация')}</h2>
              </div>
            ) : (
              <>
            <div
              className="absolute inset-0 flex items-center gap-2 pl-6 pr-6 transition-opacity duration-150"
              style={{ opacity: showTrafficLight ? 0 : 1, transitionDelay: showTrafficLight ? '0ms' : '150ms' }}
            >
              <h2 ref={titleRef} className="text-xl font-semibold text-gray-800 flex-shrink-0">{t('Регистрация')}</h2>
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

          <div className="flex-1 overflow-y-auto py-5 px-8 flex items-center justify-center">
            {pendingEmail ? (
              <EmailConfirmationPending
                email={pendingEmail}
                variant="register"
                onResend={handleResend}
                onChangeEmail={handleChangeEmail}
              />
            ) : (
              <form onSubmit={handleSubmit} className="w-full max-w-md space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('Имя')}
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder={t('Введите имя')}
                    className={fullBleedMobile ? registerInputClassMobile : registerInputClass}
                    style={fullBleedMobile ? mobileFormFieldStyle : undefined}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('Фамилия')}
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder={t('Введите фамилию')}
                    className={fullBleedMobile ? registerInputClassMobile : registerInputClass}
                    style={fullBleedMobile ? mobileFormFieldStyle : undefined}
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <label className="block text-sm font-medium text-gray-700">
                      {t('Логин')}
                    </label>
                    <div className="relative">
                      <button
                        type="button"
                        onMouseEnter={() => setShowLoginInfo(true)}
                        onMouseLeave={() => setShowLoginInfo(false)}
                        className="w-5 h-5 rounded-full text-gray-400 flex items-center justify-center"
                      >
                        <InfoCircleIcon size={18} />
                      </button>
                      {showLoginInfo && (
                        <div
                          ref={loginInfoTooltipRef}
                          className="pp-tooltip-wrap absolute top-full mt-2 left-1/2 z-10 w-64"
                          style={{ transform: `translateX(calc(-50% + ${loginInfoArrowOffset}px))` }}
                        >
                          <div className="pp-tooltip">
                            <ul className="list-disc list-inside space-y-1 text-left">
                              <li>{t('Уникальное публичное имя на платформе')}</li>
                              <li>{t('Только латиница, цифры и нижнее подчеркивание _')}</li>
                              <li>{t('От 3 до 30 символов')}</li>
                              <li>{t('Нельзя изменить впоследствии')}</li>
                            </ul>
                          </div>
                          <div
                            className="pp-tooltip-arrow pp-tooltip-arrow--top"
                            style={{ left: `calc(50% - ${loginInfoArrowOffset}px)` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    placeholder={t('Введите логин')}
                    className={fullBleedMobile ? registerInputClassMobile : registerInputClass}
                    style={fullBleedMobile ? mobileFormFieldStyle : undefined}
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <label className={`block text-sm font-medium ${requireEmail || email.trim() ? 'text-gray-700' : 'text-gray-400'}`}>
                      {t('Email')}
                    </label>
                    <div className="relative">
                      <button
                        type="button"
                        onMouseEnter={() => setShowEmailInfo(true)}
                        onMouseLeave={() => setShowEmailInfo(false)}
                        className="w-5 h-5 rounded-full text-gray-400 flex items-center justify-center"
                      >
                        <InfoCircleIcon size={18} />
                      </button>
                      {showEmailInfo && (
                        <div
                          ref={emailInfoTooltipRef}
                          className="pp-tooltip-wrap absolute top-full mt-2 left-1/2 z-10 w-64"
                          style={{ transform: `translateX(calc(-50% + ${emailInfoArrowOffset}px))` }}
                        >
                          <div className="pp-tooltip">
                            <ul className="list-disc list-inside space-y-1 text-left">
                              <li>{t('Вход в аккаунт')}</li>
                              <li>{t('Восстановление пароля')}</li>
                              <li>{t('Скрыт от других пользователей')}</li>
                            </ul>
                          </div>
                          <div
                            className="pp-tooltip-arrow pp-tooltip-arrow--top"
                            style={{ left: `calc(50% - ${emailInfoArrowOffset}px)` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={requireEmail ? t('Введите email') : t('Необязательно')}
                    className={`w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${fullBleedMobile ? 'text-base appearance-none' : 'text-sm'} transition-all placeholder:text-gray-400 ${
                      requireEmail || email.trim() ? 'text-gray-800' : 'text-gray-400'
                    }`}
                    style={fullBleedMobile ? mobileFormFieldStyle : undefined}
                    required={requireEmail}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('Пароль')}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('Введите пароль')}
                    className={fullBleedMobile ? registerInputClassMobile : registerInputClass}
                    style={fullBleedMobile ? mobileFormFieldStyle : undefined}
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="h-px flex-1 bg-gray-100" />
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={`flex items-center gap-1.5 text-sm font-medium whitespace-nowrap ${homeAddress.trim() ? 'text-gray-700' : 'text-gray-400'}`}>
                        <HouseFillIcon size={fullBleedMobile ? 17 : 14} />
                        {t('Дом / Отель')}
                        <span className="text-xs font-normal text-gray-400">{t('(опционально)')}</span>
                      </span>
                      <div className="relative">
                        <button
                          type="button"
                          onMouseEnter={() => setShowHomeInfo(true)}
                          onMouseLeave={() => setShowHomeInfo(false)}
                          className="w-5 h-5 rounded-full text-gray-400 flex items-center justify-center"
                        >
                          <InfoCircleIcon size={18} />
                        </button>
                        {showHomeInfo && (
                          <div
                            ref={homeInfoTooltipRef}
                            className="pp-tooltip-wrap absolute top-full mt-2 left-1/2 z-10 w-64"
                            style={{ transform: `translateX(calc(-50% + ${homeInfoArrowOffset}px))` }}
                          >
                            <div className="pp-tooltip">
                              {t('Данный адрес будет автоматически подставлен в поле ввода адреса при нажатии Enter')}
                            </div>
                            <div
                              className="pp-tooltip-arrow pp-tooltip-arrow--top"
                              style={{ left: `calc(50% - ${homeInfoArrowOffset}px)` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="h-px flex-1 bg-gray-100" />
                  </div>
                  <AddressAutocomplete
                    value={homeAddress}
                    onChange={setHomeAddress}
                    onResolve={(confirmed) => setHomeCoords(confirmed ? { lat: confirmed.lat, lon: confirmed.lon } : null)}
                    placeholder={t('Введите адрес')}
                    fullBleedMobile={fullBleedMobile}
                  />
                </div>

                <div className="space-y-2 pt-1">
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl bg-blue-500 text-white text-sm font-medium"
                  >
                    {t('Зарегистрироваться')}
                  </button>
                  <p className="text-xs text-gray-400 text-center">
                    {t('Place Pace заботится о вашей конфиденциальности. Данные не передаются третьим лицам.')}
                  </p>
                </div>
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

export default RegisterModal;
