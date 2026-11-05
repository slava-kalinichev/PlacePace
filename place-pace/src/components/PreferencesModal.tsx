import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { InfoCircleIcon, EyeSlashFillIcon, CarRearFillIcon, ChevronBackwardIcon } from './sfSymbols';
import { useHeaderHeightReporter, useMeasuredWidth, useTooltipEdgeOffset, layerTransform, layerBoxShadow, layerScrimOpacity, DEFAULT_HEADER_HEIGHT, CARD_WIDTH, CARD_HEIGHT, trafficLightZone } from './layerGeometry';
import TrafficLight from './TrafficLight';
import { useTranslation } from '../i18n/LanguageContext';
import { showInfoPlaque } from './InfoPlaque';
import { ONIT_BOTTOMBAR_HEIGHT } from '../onit/onitLayout';

interface PreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  isLoggedIn: boolean;
  language: 'Русский' | 'English';
  onLanguageChange: (language: 'Русский' | 'English') => void;
  onLanguageSync: (language: 'Русский' | 'English') => void;
  privateTerminal: boolean;
  onPrivateTerminalChange: (value: boolean) => void;
  defaultTaxiTariff: 'economy' | 'comfort' | 'business';
  onDefaultTaxiTariffChange: (tariff: 'economy' | 'comfort' | 'business') => void;
  walkDistanceLimitM: number;
  onWalkDistanceLimitMChange: (meters: number) => void;
  onOpenChangePassword: () => void;
  onOpenChangeEmail: () => void;
  zIndex: number;
  offsetX: number;
  offsetY: number;
  isTop: boolean;
  depth: number;
  onHeaderHeight?: (px: number) => void;
  fullBleedMobile?: boolean;
}

const PreferencesModal = ({
  isOpen,
  onClose,
  isLoggedIn,
  language,
  onLanguageChange,
  onLanguageSync,
  privateTerminal,
  onPrivateTerminalChange,
  defaultTaxiTariff,
  onDefaultTaxiTariffChange,
  walkDistanceLimitM,
  onWalkDistanceLimitMChange,
  onOpenChangePassword,
  onOpenChangeEmail,
  zIndex,
  offsetX,
  offsetY,
  isTop,
  depth,
  onHeaderHeight,
  fullBleedMobile,
}: PreferencesModalProps) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  // Тултип "Private Terminal"
  const { wrapRef: infoTooltipRef, arrowOffset: infoArrowOffset } = useTooltipEdgeOffset(showInfo);
  // Тот же паттерн - тултип "Прогулочного лимита" (только для админов)
  const [showWalkLimitInfo, setShowWalkLimitInfo] = useState(false);
  const { wrapRef: walkLimitTooltipRef, arrowOffset: walkLimitArrowOffset } = useTooltipEdgeOffset(showWalkLimitInfo);
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeightReporter(headerRef, onHeaderHeight);
  const [showTrafficLight, setShowTrafficLight] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleWidth = useMeasuredWidth(titleRef);

  // Админ ли пользователь
  const [isAdmin, setIsAdmin] = useState(false);
  const [mapEnabled, setMapEnabled] = useState<boolean | null>(null);
  // Тумблер мини-карты маршрута
  const [routeMiniMapEnabled, setRouteMiniMapEnabled] = useState<boolean | null>(null);
  // Тумблер обязательности email
  const [requireEmailVerification, setRequireEmailVerification] = useState<boolean | null>(null);
  // Email аккаунта
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [walkLimitDraft, setWalkLimitDraft] = useState<string | undefined>(undefined);
  const [baseline, setBaseline] = useState<{
    privateTerminal: boolean;
    defaultTaxiTariff: 'economy' | 'comfort' | 'business';
    walkDistanceLimitM: number;
  } | null>(null);
  const [adminBaseline, setAdminBaseline] = useState<{
    mapEnabled: boolean;
    routeMiniMapEnabled: boolean;
    requireEmailVerification: boolean;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsVisible(true), 50);
      // У вошедшего пользователя значения берём с бэкенда
      if (isLoggedIn) {
        api.getProfile().then(p => {
          onPrivateTerminalChange(p.private_terminal_enabled);
          onLanguageSync(p.language === 'en' ? 'English' : 'Русский');
          setIsAdmin(p.is_admin);
          setAccountEmail(p.email);
          // Синхронизируем тариф и лимит с App.tsx
          onDefaultTaxiTariffChange(p.default_taxi_tariff);
          onWalkDistanceLimitMChange(p.walk_distance_limit_m);
          setBaseline({
            privateTerminal: p.private_terminal_enabled,
            defaultTaxiTariff: p.default_taxi_tariff,
            walkDistanceLimitM: p.walk_distance_limit_m,
          });
          if (p.is_admin) {
            api.getAppSettings().then(s => {
              const routeMiniMap = s.route_mini_map_enabled !== false;
              setMapEnabled(s.map_enabled);
              setRouteMiniMapEnabled(routeMiniMap);
              setRequireEmailVerification(s.require_email_verification);
              setAdminBaseline({
                mapEnabled: s.map_enabled,
                routeMiniMapEnabled: routeMiniMap,
                requireEmailVerification: s.require_email_verification,
              });
            }).catch(() => {});
          }
        }).catch(() => {});
      } else {
        setIsAdmin(false);
        setAccountEmail(null);
        setBaseline({ privateTerminal, defaultTaxiTariff, walkDistanceLimitM });
      }
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
      setBaseline(null);
      setAdminBaseline(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isLoggedIn]);

  // Админские тумблеры - черновик, на сервер уходят по "Сохранить"
  const toggleMapEnabled = () => {
    if (mapEnabled === null) return;
    setMapEnabled(!mapEnabled);
  };

  const toggleRouteMiniMapEnabled = () => {
    if (routeMiniMapEnabled === null) return;
    setRouteMiniMapEnabled(!routeMiniMapEnabled);
  };

  const toggleRequireEmailVerification = () => {
    if (requireEmailVerification === null) return;
    setRequireEmailVerification(!requireEmailVerification);
  };

  // Лимит по времени считается на бэкенде в пропорции 800 м:15 мин
  const walkLimitMinutes = (meters: number) => Math.round(meters * 15 / 800);

  const commitWalkLimit = (meters: number) => {
    onWalkDistanceLimitMChange(Math.min(1500, Math.max(100, meters)));
  };

  // Язык сохраняется сразу по клику
  const toggleLanguage = () => {
    const next = language === 'Русский' ? 'English' : 'Русский';
    onLanguageChange(next);
    onLanguageSync(next);
    if (isLoggedIn) {
      api.updateProfile({ language: next === 'English' ? 'en' : 'ru' }).catch(() => {});
    }
  };

  const profileChanged =
    baseline !== null &&
    (privateTerminal !== baseline.privateTerminal ||
      defaultTaxiTariff !== baseline.defaultTaxiTariff ||
      walkDistanceLimitM !== baseline.walkDistanceLimitM);

  // На сервер уходят только изменённые админские тумблеры
  const adminPatch: { map_enabled?: boolean; route_mini_map_enabled?: boolean; require_email_verification?: boolean } = {};
  if (adminBaseline !== null) {
    if (mapEnabled !== null && mapEnabled !== adminBaseline.mapEnabled) adminPatch.map_enabled = mapEnabled;
    if (routeMiniMapEnabled !== null && routeMiniMapEnabled !== adminBaseline.routeMiniMapEnabled) adminPatch.route_mini_map_enabled = routeMiniMapEnabled;
    if (requireEmailVerification !== null && requireEmailVerification !== adminBaseline.requireEmailVerification) adminPatch.require_email_verification = requireEmailVerification;
  }
  const adminChanged = Object.keys(adminPatch).length > 0;

  const hasChanges = profileChanged || adminChanged;

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
          {/* Заголовок фиксированной высоты (зона светофора как в LoginModal) */}
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
                <h2 className="text-lg font-semibold text-gray-800 truncate">{t('Настройки')}</h2>
              </div>
            ) : (
              <>
            <div
              className="absolute inset-0 flex items-center pl-6 pr-6 transition-opacity duration-150"
              style={{ opacity: showTrafficLight ? 0 : 1, transitionDelay: showTrafficLight ? '0ms' : '150ms' }}
            >
              <h2 ref={titleRef} className="text-xl font-semibold text-gray-800">{t('Настройки')}</h2>
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

          {/* Контент */}
          <div className="flex-1 overflow-y-auto p-8">
            <div className="max-w-2xl mx-auto space-y-6">

              {/* 1. Язык */}
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  {t('Язык')}
                </span>
                <button
                  onClick={toggleLanguage}
                  className="pp-plain text-sm text-blue-500 hover:text-blue-600 font-medium transition-colors"
                >
                  {language}
                </button>
              </div>

              {/* 2. Private Terminal */}
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    Private Terminal
                  </span>
                  <div className="relative">
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
                        className="pp-tooltip-wrap absolute top-full mt-2 left-1/2 z-10 w-72"
                        style={{ transform: `translateX(calc(-50% + ${infoArrowOffset}px))` }}
                      >
                        <div className="pp-tooltip flex items-start gap-1.5">
                          <EyeSlashFillIcon size={14} color="#6B7280" className="flex-shrink-0 mt-0.5" />
                          {t('Скрыть введенные адреса начальной и конечной точек при сохранении готового маршрута в открытый доступ')}
                        </div>
                        <div
                          className="pp-tooltip-arrow pp-tooltip-arrow--top"
                          style={{ left: `calc(50% - ${infoArrowOffset}px)` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onPrivateTerminalChange(!privateTerminal)}
                  className={`relative w-[3.15rem] h-[1.434375rem] rounded-full transition-colors flex-shrink-0 ${
                    privateTerminal ? 'bg-[#007AFF]' : 'bg-gray-300'
                  }`}
                >
                  <div className={`
                    absolute top-[0.140625rem] w-[1.8rem] h-[1.153125rem] bg-white rounded-full shadow-sm transition-all
                    ${privateTerminal ? 'left-[1.19375rem]' : 'left-[0.15625rem]'}
                  `} />
                </button>
              </div>

              {/* Тариф такси по умолчанию (индивидуальная настройка аккаунта, виден и гостю) */}
              {!fullBleedMobile && (
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <span className="text-sm font-medium text-gray-700">
                  {t('Тариф такси по умолчанию')}
                </span>
                <div className="flex gap-1 p-1 bg-gray-100 rounded-lg flex-shrink-0">
                  {(['economy', 'comfort', 'business'] as const).map(tariff => {
                    const active = defaultTaxiTariff === tariff;
                    const activeColor = tariff === 'economy' ? '#F59E0B' : tariff === 'comfort' ? '#B0B8C1' : '#000000';
                    const label = tariff === 'economy' ? t('Эконом') : tariff === 'comfort' ? t('Комфорт') : t('Бизнес');
                    return (
                      <button
                        key={tariff}
                        onClick={() => onDefaultTaxiTariffChange(tariff)}
                        className={`w-[5.75rem] flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors select-none ${
                          active ? 'bg-white ring-1 ring-blue-400' : 'hover:bg-gray-200/70'
                        }`}
                      >
                        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                          <CarRearFillIcon color={active ? activeColor : '#9CA3AF'} size={16} />
                        </div>
                        <span className={`text-xs font-medium ${active ? 'text-blue-600' : 'text-gray-700'}`}>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              )}

              {/* Прогулочный лимит (индивидуальная настройка аккаунта, виден и гостю) */}
              {!fullBleedMobile && (() => {
                const displayValue = walkDistanceLimitM;
                const percent = (displayValue - 100) / (1500 - 100) * 100;
                const trackBackground = percent >= 50
                  ? `linear-gradient(to right, #007AFF 0%, #007AFF ${percent}%, #E5E7EB ${percent}%, #E5E7EB 100%)`
                  : `linear-gradient(to right, #007AFF 0%, #007AFF ${percent}%, #BFDBFE ${percent}%, #BFDBFE 50%, #E5E7EB 50%, #E5E7EB 100%)`;
                return (
                  <div className="flex items-center justify-between py-3 border-b border-gray-100 gap-6">
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-medium text-gray-700">
                        {t('Прогулочный лимит')}
                      </span>
                      <div className="relative">
                        <button
                          onMouseEnter={() => setShowWalkLimitInfo(true)}
                          onMouseLeave={() => setShowWalkLimitInfo(false)}
                          className="w-5 h-5 rounded-full text-gray-400 flex items-center justify-center"
                        >
                          <InfoCircleIcon size={18} />
                        </button>
                        {showWalkLimitInfo && (
                          <div
                            ref={walkLimitTooltipRef}
                            className="pp-tooltip-wrap absolute top-full mt-2 left-1/2 z-10 w-64"
                            style={{ transform: `translateX(calc(-50% + ${walkLimitArrowOffset}px))` }}
                          >
                            <div className="pp-tooltip">
                              {t('Для расстояний, меньше данного, система не будет использовать транспорт при оптимизации.')}
                            </div>
                            <div
                              className="pp-tooltip-arrow pp-tooltip-arrow--top"
                              style={{ left: `calc(50% - ${walkLimitArrowOffset}px)` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-1 max-w-xs">
                      <input
                        type="range"
                        min={100}
                        max={1500}
                        step={20}
                        value={displayValue}
                        onChange={(e) => commitWalkLimit(parseInt(e.target.value, 10))}
                        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        style={{ background: trackBackground }}
                      />
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <input
                          type="number"
                          value={walkLimitDraft !== undefined ? walkLimitDraft : displayValue}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setWalkLimitDraft(e.target.value)}
                          onBlur={() => {
                            if (walkLimitDraft !== undefined && walkLimitDraft !== '') {
                              const parsed = parseInt(walkLimitDraft, 10);
                              if (!isNaN(parsed)) commitWalkLimit(parsed);
                            }
                            setWalkLimitDraft(undefined);
                          }}
                          min={100}
                          max={1500}
                          className={`w-16 px-2 py-1 border border-gray-200 rounded-lg text-center ${fullBleedMobile ? 'text-base' : 'text-sm'}`}
                        />
                        <span className="text-sm text-gray-500">{t('м')}</span>
                      </div>
                      {/* Производный лимит по времени (только отображение) */}
                      <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                        ≈{walkLimitMinutes(displayValue)} {t('мин')}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Отображение карты на главной (только админы) */}
              {isAdmin && (
                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <span className="text-sm font-medium text-gray-700">
                    {t('Отображение карты на главной странице')}
                  </span>
                  <button
                    onClick={toggleMapEnabled}
                    disabled={mapEnabled === null}
                    className={`relative w-[3.15rem] h-[1.434375rem] rounded-full transition-colors flex-shrink-0 ${
                      mapEnabled ? 'bg-[#007AFF]' : 'bg-gray-300'
                    }`}
                  >
                    <div className={`
                      absolute top-[0.140625rem] w-[1.8rem] h-[1.153125rem] bg-white rounded-full shadow-sm transition-all
                      ${mapEnabled ? 'left-[1.19375rem]' : 'left-[0.15625rem]'}
                    `} />
                  </button>
                </div>
              )}

              {/* Отображение мини-карты маршрута (только админы) */}
              {isAdmin && (
                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <span className="text-sm font-medium text-gray-700">
                    {t('Отображение миникарты маршрута')}
                  </span>
                  <button
                    onClick={toggleRouteMiniMapEnabled}
                    disabled={routeMiniMapEnabled === null}
                    className={`relative w-[3.15rem] h-[1.434375rem] rounded-full transition-colors flex-shrink-0 ${
                      routeMiniMapEnabled ? 'bg-[#007AFF]' : 'bg-gray-300'
                    }`}
                  >
                    <div className={`
                      absolute top-[0.140625rem] w-[1.8rem] h-[1.153125rem] bg-white rounded-full shadow-sm transition-all
                      ${routeMiniMapEnabled ? 'left-[1.19375rem]' : 'left-[0.15625rem]'}
                    `} />
                  </button>
                </div>
              )}

              {/* Требование email при регистрации (только админы) */}
              {isAdmin && (
                <div className="flex items-center justify-between py-3 border-b border-gray-100">
                  <span className="text-sm font-medium text-gray-700">
                    {fullBleedMobile
                      ? t('Требование email при регистрации')
                      : t('Требование указания email при регистрации')}
                  </span>
                  <button
                    onClick={toggleRequireEmailVerification}
                    disabled={requireEmailVerification === null}
                    className={`relative w-[3.15rem] h-[1.434375rem] rounded-full transition-colors flex-shrink-0 ${
                      requireEmailVerification ? 'bg-[#007AFF]' : 'bg-gray-300'
                    }`}
                  >
                    <div className={`
                      absolute top-[0.140625rem] w-[1.8rem] h-[1.153125rem] bg-white rounded-full shadow-sm transition-all
                      ${requireEmailVerification ? 'left-[1.19375rem]' : 'left-[0.15625rem]'}
                    `} />
                  </button>
                </div>
              )}

              {/* Сменить пароль, сменить или привязать email */}
              <div className="flex items-center justify-between py-3 border-b border-gray-100">
                <span
                  className="text-sm text-blue-500 hover:text-blue-600 cursor-pointer transition-colors"
                  onClick={onOpenChangePassword}
                >
                  {t('Сменить пароль')}
                </span>
                <span
                  className="text-sm text-blue-500 hover:text-blue-600 cursor-pointer transition-colors"
                  onClick={onOpenChangeEmail}
                >
                  {accountEmail ? t('Сменить email') : t('Привязать email')}
                </span>
              </div>

            </div>
          </div>

          {(!fullBleedMobile || hasChanges) && (
          <div
            className={`border-t border-gray-100 flex flex-shrink-0 items-center ${fullBleedMobile ? 'px-6 justify-end' : 'p-6 justify-between'}`}
            style={fullBleedMobile ? { height: ONIT_BOTTOMBAR_HEIGHT, paddingBottom: 'env(safe-area-inset-bottom)', boxSizing: 'content-box' } : undefined}
          >
            {!fullBleedMobile && (
            <button
              onClick={onClose}
              className="pp-btn-white px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-medium"
            >
              {t('Назад')}
            </button>
            )}
            {hasChanges && (
            <button
              onClick={async () => {
                if (isLoggedIn) {
                  await api.updateProfile({
                    private_terminal_enabled: privateTerminal,
                    language: language === 'English' ? 'en' : 'ru',
                    default_taxi_tariff: defaultTaxiTariff,
                    walk_distance_limit_m: walkDistanceLimitM,
                  }).catch(() => {});
                }
                // Админские тумблеры уходят одним запросом; при ошибке окно не закрываем
                if (adminChanged) {
                  const saved = await api.updateAppSettings(adminPatch).then(() => true).catch(() => false);
                  if (!saved) {
                    showInfoPlaque(t('Не удалось сохранить настройки. Попробуйте снова.'), 'error');
                    return;
                  }
                }
                // Язык фиксируем до onClose(), чтобы откат ничего не менял
                onLanguageSync(language);
                onClose();
              }}
              className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium"
            >
              {t('Сохранить')}
            </button>
            )}
          </div>
          )}

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

export default PreferencesModal;