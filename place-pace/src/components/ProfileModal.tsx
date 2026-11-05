import { useState, useEffect, useRef } from 'react';
import { api, type Profile } from '../api/client';
import AddressAutocomplete from './AddressAutocomplete';
import { InfoCircleIcon, ChevronBackwardIcon } from './sfSymbols';
import { useHeaderHeightReporter, useMeasuredWidth, useTooltipEdgeOffset, layerTransform, layerBoxShadow, layerScrimOpacity, DEFAULT_HEADER_HEIGHT, CARD_WIDTH, CARD_HEIGHT, trafficLightZone } from './layerGeometry';
import TrafficLight from './TrafficLight';
import { useTranslation } from '../i18n/LanguageContext';
import { ONIT_BOTTOMBAR_HEIGHT } from '../onit/onitLayout';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  zIndex: number;
  offsetX: number;
  offsetY: number;
  isTop: boolean;
  depth: number;
  onHeaderHeight?: (px: number) => void;
  fullBleedMobile?: boolean;
  onLogout?: () => void;
}

const ProfileModal = ({ isOpen, onClose, zIndex, offsetX, offsetY, isTop, depth, onHeaderHeight, fullBleedMobile, onLogout }: ProfileModalProps) => {
  const { t, language } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [showHomeInfo, setShowHomeInfo] = useState(false);
  const { wrapRef: homeInfoTooltipRef, arrowOffset: homeInfoArrowOffset } = useTooltipEdgeOffset(showHomeInfo);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [homeAddress, setHomeAddress] = useState('');
  const [homeCoords, setHomeCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [originalHomeAddress, setOriginalHomeAddress] = useState('');
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
    if (isOpen) {
      api.getProfile().then((data) => {
        setProfile(data);
        setHomeAddress(data.home_address || '');
        setOriginalHomeAddress(data.home_address || '');
        setHomeCoords(data.home_lat != null && data.home_lon != null ? { lat: data.home_lat, lon: data.home_lon } : null);
      });
    } else {
      setProfile(null);
    }
  }, [isOpen]);

  const handleSave = async () => {
    await api.updateProfile({
      home_address: homeAddress.trim(),
      home_lat: homeAddress.trim() ? homeCoords?.lat : null,
      home_lon: homeAddress.trim() ? homeCoords?.lon : null,
    });
    onClose();
  };

  if (!isOpen) return null;

  const hasChanges = homeAddress.trim() !== originalHomeAddress.trim();
  // Пустой адрес допустим, непустой - только выбранный из подсказок
  const homeConfirmed = !homeAddress.trim() || !!homeCoords;

  // en-GB: порядок "день месяц год"
  const registeredDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(language === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

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
                <h2 className="text-lg font-semibold text-gray-800 truncate">{t('Личный кабинет')}</h2>
              </div>
            ) : (
              <>
            <div
              className="absolute inset-0 flex items-center pl-6 pr-6 transition-opacity duration-150"
              style={{ opacity: showTrafficLight ? 0 : 1, transitionDelay: showTrafficLight ? '0ms' : '150ms' }}
            >
              <h2 ref={titleRef} className="text-xl font-semibold text-gray-800">{t('Личный кабинет')}</h2>
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

          <div className="flex-1 overflow-y-auto p-8">
            {!profile ? (
              <div className="text-sm text-gray-400 text-center py-8">{t('Загрузка...')}</div>
            ) : (
              <div className="max-w-2xl mx-auto space-y-6">
                <div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium text-gray-700">{t('Логин')}</span>
                    <div className="flex items-center gap-2">
                      <div className="inline-flex items-center h-6 px-4 bg-gray-50 border border-gray-200 rounded-full text-sm text-gray-800">
                        {profile.username}
                      </div>
                      {profile.is_admin && (
                        <span className="inline-flex items-center h-6 px-4 bg-blue-500 text-white text-sm rounded-full whitespace-nowrap">
                          {t('Администратор')}
                        </span>
                      )}
                    </div>
                  </div>

                  {profile.email && (
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm font-medium text-gray-700">{t('Email')}</span>
                      <span className="text-sm text-gray-800">{profile.email}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium text-gray-700">{t('Фамилия')}</span>
                    <span className="text-sm text-gray-800">{profile.last_name}</span>
                  </div>

                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium text-gray-700">{t('Имя')}</span>
                    <span className="text-sm text-gray-800">{profile.first_name}</span>
                  </div>
                </div>

                <div className="h-px bg-gray-100" />

                <div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium text-gray-700">{t('Зарегистрирован:')}</span>
                    <span className="text-sm text-gray-800">{registeredDate}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium text-gray-700">{t('Создано маршрутов:')}</span>
                    <span className="text-sm text-gray-800">{profile.routes_count}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium text-gray-700">{t('Ваши маршруты в Избранном:')}</span>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-sm font-medium text-gray-800">
                        {profile.stars_total}
                        <svg className="w-6 h-6 text-yellow-400 pp-star-glow" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M 11.49 2.89 Q 12.00 1.50 12.51 2.89 L 14.06 7.08 Q 14.57 8.47 16.05 8.53 L 20.51 8.70 Q 21.99 8.76 20.82 9.68 L 17.32 12.43 Q 16.15 13.35 16.55 14.78 L 17.77 19.06 Q 18.17 20.49 16.94 19.67 L 13.23 17.19 Q 12.00 16.37 10.77 17.19 L 7.06 19.67 Q 5.83 20.49 6.23 19.06 L 7.45 14.78 Q 7.85 13.35 6.68 12.43 L 3.18 9.68 Q 2.01 8.76 3.49 8.70 L 7.95 8.53 Q 9.43 8.47 9.94 7.08 Z" />
                        </svg>
                      </span>
                      {profile.rank_label !== null && (
                        <span className="inline-flex items-center h-6 px-2.5 bg-blue-500 text-white text-sm rounded-full whitespace-nowrap">
                          {language === 'en' ? `top ${profile.rank_label}` : `${profile.rank_label} место`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="h-px bg-gray-100" />

                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-700 flex-shrink-0">
                    {t('Дом / Отель:')}
                  </span>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1">
                      <AddressAutocomplete
                        value={homeAddress}
                        onChange={setHomeAddress}
                        onResolve={(confirmed) => setHomeCoords(confirmed ? { lat: confirmed.lat, lon: confirmed.lon } : null)}
                        placeholder={t('Введите адрес')}
                      />
                    </div>
                    <div className="relative">
                      <button
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
                </div>

                <div className="h-px bg-gray-100" />

                <div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-sm font-medium text-gray-700">{t('Поддержка:')}</span>
                    <a href="mailto:support@placepace.space" className="text-sm text-blue-500">
                      support@placepace.space
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Место под кнопку "Сохранить" зарезервировано, меняется только видимость */}
          <div
            className={`border-t border-gray-100 flex items-center flex-shrink-0 ${fullBleedMobile ? 'px-6 justify-between' : 'p-6 justify-end'}`}
            style={fullBleedMobile ? { height: ONIT_BOTTOMBAR_HEIGHT, paddingBottom: 'env(safe-area-inset-bottom)', boxSizing: 'content-box' } : undefined}
          >
            {fullBleedMobile && (
              // Кнопка выхода: на тачскрине подложка постоянная
              <button
                type="button"
                onClick={onLogout}
                className="pp-plain px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-red-500 text-sm font-medium active:bg-red-100"
              >
                {t('Выйти из аккаунта')}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!hasChanges || !homeConfirmed}
              className={`px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium transition-opacity duration-200 ${
                hasChanges && homeConfirmed ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              {t('Сохранить')}
            </button>
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

export default ProfileModal;
