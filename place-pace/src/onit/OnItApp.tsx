// Корень мобильной ветки On It (отдельное дерево от App.tsx)
import React, { useEffect, useRef, useState, type RefObject } from 'react';
import { api, type AuthUser, type RouteCard } from '../api/client';
import { LanguageProvider, useTranslation, type Language } from '../i18n/LanguageContext';
import LoginModal from '../components/LoginModal';
import RegisterModal from '../components/RegisterModal';
import PreferencesModal from '../components/PreferencesModal';
import ChangePasswordModal from '../components/ChangePasswordModal';
import ChangeEmailModal from '../components/ChangeEmailModal';
import ResetPasswordModal from '../components/ResetPasswordModal';
import ProfileModal from '../components/ProfileModal';
import RouteBar from '../components/RouteBar';
import OnItRouteView from './OnItRouteView';
import OnItWalkthrough from './OnItWalkthrough';
import OnItPastRoutes from './OnItPastRoutes';
import { GearIcon } from '../components/sfSymbols';
import { ONIT_CHROME_Z, ONIT_MODAL_Z, ONIT_TOPBAR_HEIGHT, ONIT_BOTTOMBAR_HEIGHT } from './onitLayout';
import type { OnItScreen } from './onitTypes';

// Стабильная ссылка для зависимостей эффекта RouteBar
const EMPTY_ROUTES: RouteCard[] = [];

function OnItApp() {
  // Язык: черновик и снимок для отката в настройках
  const [language, setLanguage] = useState<'Русский' | 'English'>('Русский');
  const committedLanguageRef = useRef<'Русский' | 'English'>('Русский');
  const toLanguageCode = (value: 'Русский' | 'English'): Language => (value === 'English' ? 'en' : 'ru');

  // Результат перехода по ссылке из письма (простой баннер вместо плашек)
  const [notice, setNotice] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <LanguageProvider language={toLanguageCode(language)}>
      <OnItShell
        language={language}
        onLanguageChange={setLanguage}
        committedLanguageRef={committedLanguageRef}
        onNotice={(text, kind) => setNotice({ text, kind })}
      />
      {notice && (
        <div
          className="fixed left-1/2 -translate-x-1/2 px-4 py-2 rounded-2xl bg-white shadow-lg text-sm text-center pointer-events-none"
          style={{
            top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
            zIndex: ONIT_MODAL_Z + 100,
            maxWidth: 'calc(100vw - 32px)',
            color: notice.kind === 'error' ? '#EF4444' : '#007AFF',
          }}
        >
          {notice.text}
        </div>
      )}
    </LanguageProvider>
  );
}

interface OnItShellProps {
  language: 'Русский' | 'English';
  onLanguageChange: (language: 'Русский' | 'English') => void;
  committedLanguageRef: RefObject<'Русский' | 'English'>;
  onNotice: (text: string, kind: 'success' | 'error') => void;
}

function OnItShell({ language, onLanguageChange, committedLanguageRef, onNotice }: OnItShellProps) {
  const { t } = useTranslation();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userName, setUserName] = useState('');
  // Вход или регистрация
  const [authView, setAuthView] = useState<'login' | 'register'>('login');

  const [screen, setScreen] = useState<OnItScreen>('home');
  const [selectedRoute, setSelectedRoute] = useState<RouteCard | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changeEmailOpen, setChangeEmailOpen] = useState(false);
  // Личный кабинет
  const [profileOpen, setProfileOpen] = useState(false);
  // Экран "Пройденные"
  const [pastRoutesOpen, setPastRoutesOpen] = useState(false);

  // Индивидуальные настройки аккаунта для PreferencesModal
  const [privateTerminal, setPrivateTerminal] = useState(true);
  const [defaultTaxiTariff, setDefaultTaxiTariff] = useState<'economy' | 'comfort' | 'business'>('economy');
  const [walkDistanceLimitM, setWalkDistanceLimitM] = useState(800);

  const onLanguageSync = (value: 'Русский' | 'English') => {
    committedLanguageRef.current = value;
    onLanguageChange(value);
  };

  const syncProfile = () => {
    api.getProfile().then(p => {
      onLanguageSync(p.language === 'en' ? 'English' : 'Русский');
      setPrivateTerminal(p.private_terminal_enabled);
      setDefaultTaxiTariff(p.default_taxi_tariff);
      setWalkDistanceLimitM(p.walk_distance_limit_m);
    }).catch(() => {});
  };

  // Восстановление сессии при обновлении страницы
  useEffect(() => {
    api.me().then((result) => {
      if (result.authenticated && result.first_name && result.last_name) {
        setIsLoggedIn(true);
        setUserName(`${result.first_name.charAt(0)}. ${result.last_name}`);
        syncProfile();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = (user: AuthUser) => {
    setIsLoggedIn(true);
    setUserName(`${user.first_name.charAt(0)}. ${user.last_name}`);
    syncProfile();
  };

  // Подтверждение email по ссылке ?verify_token=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('verify_token');
    if (!token) return;

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('verify_token');
    window.history.replaceState({}, '', cleanUrl.toString());

    api.verifyEmail(token).then((result) => {
      if (!result.success) {
        onNotice(t(result.error), 'error');
        return;
      }
      if (result.purpose === 'register') {
        handleLogin(result);
        onNotice(`${t('Добро пожаловать в Place Pace,')} ${result.first_name}!`, 'success');
      } else {
        onNotice(
          result.message_variant === 'changed' ? t('Email сменён') : t('Email привязан к аккаунту'),
          'success',
        );
      }
    }).catch(() => {
      onNotice(t('Не удалось подтвердить email'), 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Сброс пароля по ссылке ?reset_token=
  const [resetToken, setResetToken] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('reset_token'),
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('reset_token')) return;
    url.searchParams.delete('reset_token');
    window.history.replaceState({}, '', url.toString());
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setIsLoggedIn(false);
    setUserName('');
    setScreen('home');
    setSelectedRoute(null);
    // Закрываем ЛК при выходе
    setProfileOpen(false);
  };

  const handleRouteClick = (route: RouteCard) => {
    setSelectedRoute(route);
    setScreen('view');
  };

  const handleCloseRouteView = () => {
    setScreen('home');
    setSelectedRoute(null);
  };

  // "Пройти маршрут" -> экран прохождения
  const handleWalk = () => setScreen('walkthrough');

  // "Выйти" из прохождения возвращает на экран просмотра
  const handleExitWalkthrough = () => setScreen('view');

  // Прогресс сворачивания шапки при скролле (0 - видна, 1 - скрыта)
  const [collapseProgress, setCollapseProgress] = useState(0); // 0 = шапка полностью видна, 1 = полностью схлопнута
  // Ref текста шапки для измерения высоты с учётом safe-area
  const topBarTextRef = useRef<HTMLSpanElement>(null);
  const [topBarContentBottom, setTopBarContentBottom] = useState(ONIT_TOPBAR_HEIGHT);
  useEffect(() => {
    const el = topBarTextRef.current;
    if (!el) return;
    const measure = () => setTopBarContentBottom(el.getBoundingClientRect().bottom);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('orientationchange', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', measure);
    };
  }, []);
  // Сворачивание зависит от направления скролла
  const lastScrollTopRef = useRef(0);
  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = (e.target as HTMLElement).scrollTop;
    const delta = top - lastScrollTopRef.current;
    lastScrollTopRef.current = top;
    // У верха списка шапка всегда видна
    if (top <= 0) {
      setCollapseProgress(0);
      return;
    }
    const distance = topBarContentBottom || ONIT_TOPBAR_HEIGHT;
    setCollapseProgress(prev => Math.min(1, Math.max(0, prev + delta / distance)));
  };

  // Pull-to-refresh: порог и состояние жеста
  const PULL_REFRESH_THRESHOLD = 70;
  const PULL_MAX = 120;
  // Callback-ref контейнера (домашний экран монтируется условно)
  const [pullWrapEl, setPullWrapEl] = useState<HTMLDivElement | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  // true на время settle-анимации после отпускания
  const [pullReleasing, setPullReleasing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pullTouchStartYRef = useRef(0);
  const pullDraggingRef = useRef(false);

  useEffect(() => {
    const el = pullWrapEl;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (refreshing) return;
      pullTouchStartYRef.current = e.touches[0].clientY;
      pullDraggingRef.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (refreshing) return;
      const deltaY = e.touches[0].clientY - pullTouchStartYRef.current;
      if (!pullDraggingRef.current) {
        // Жест включаем, только если список у верха и палец тянет вниз
        if (lastScrollTopRef.current > 0 || deltaY <= 0) return;
        pullDraggingRef.current = true;
      }
      if (deltaY <= 0) {
        pullDraggingRef.current = false;
        setPullDistance(0);
        return;
      }
      // Резиновое сопротивление
      const next = PULL_MAX * (1 - Math.exp(-deltaY / PULL_MAX));
      e.preventDefault();
      setPullDistance(next);
    };

    const handleTouchEnd = () => {
      if (!pullDraggingRef.current) return;
      pullDraggingRef.current = false;
      setPullReleasing(true);
      setPullDistance((current) => {
        if (current >= PULL_REFRESH_THRESHOLD) {
          setRefreshing(true);
          // Настоящая перезагрузка страницы
          requestAnimationFrame(() => requestAnimationFrame(() => window.location.reload()));
          return PULL_REFRESH_THRESHOLD * 0.7;
        }
        window.setTimeout(() => setPullReleasing(false), 320);
        return 0;
      });
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pullWrapEl, refreshing]);

  // Форма нового пароля поверх любого состояния
  if (resetToken) {
    return (
      <div className="fixed inset-0 bg-white pp-onit-no-select">
        <ResetPasswordModal
          isOpen
          token={resetToken}
          onClose={() => setResetToken(null)}
          onReset={handleLogin}
          onNotice={onNotice}
          zIndex={ONIT_MODAL_Z}
          offsetX={0}
          offsetY={0}
          isTop
          depth={0}
          fullBleedMobile
        />
      </div>
    );
  }

  // Шлюз входа: без входа остального UI нет
  if (!isLoggedIn) {
    return (
      // Запрет выделения текста долгим тапом
      <div className="fixed inset-0 bg-white pp-onit-no-select">
        <LoginModal
          isOpen={authView === 'login'}
          // onClose пустой: закрывать некуда; кнопки "Назад" нет
          onClose={() => {}}
          onLogin={handleLogin}
          onOpenRegister={() => setAuthView('register')}
          zIndex={ONIT_MODAL_Z}
          offsetX={0}
          offsetY={0}
          isTop
          depth={0}
          fullBleedMobile
          hideBackButton
        />
        <RegisterModal
          isOpen={authView === 'register'}
          onClose={() => setAuthView('login')}
          onImmediateLogin={handleLogin}
          zIndex={ONIT_MODAL_Z}
          offsetX={0}
          offsetY={0}
          isTop
          depth={0}
          fullBleedMobile
        />
      </div>
    );
  }

  if (screen === 'view' && selectedRoute) {
    return (
      <OnItRouteView
        route={selectedRoute}
        isLoggedIn={isLoggedIn}
        onClose={handleCloseRouteView}
        onWalk={handleWalk}
      />
    );
  }

  if (screen === 'walkthrough' && selectedRoute) {
    return (
      <OnItWalkthrough
        route={selectedRoute}
        onExit={handleExitWalkthrough}
        // "Завершить маршрут" - сброс на домашний экран
        onFinish={handleCloseRouteView}
      />
    );
  }

  return (
    // Запрет выделения текста долгим тапом
    <div className="fixed inset-0 bg-white overflow-hidden pp-onit-no-select">
      {/* Шапка с вордмарком (прячется при скролле) */}
      <div
        className="fixed top-0 inset-x-0 flex items-center justify-center gap-2 bg-white/95 backdrop-blur-md border-b border-gray-200/50"
        style={{
          zIndex: ONIT_CHROME_Z,
          height: ONIT_TOPBAR_HEIGHT,
          paddingTop: 'env(safe-area-inset-top)',
          // Прозрачность пропорциональна прогрессу скролла
          opacity: 1 - collapseProgress,
          transform: `translateY(${-collapseProgress * 100}%)`,
          pointerEvents: collapseProgress >= 1 ? 'none' : 'auto',
        }}
      >
        {/* Заголовок как "Place Pace Аккаунт" на экране входа */}
        <span ref={topBarTextRef} className="text-2xl font-semibold text-gray-900 whitespace-nowrap">Place Pace: On It</span>
      </div>

      {/* Список маршрутов (RouteBar в режиме On It) */}
      {/* Контейнер списка и pull-to-refresh */}
      <div ref={setPullWrapEl} className="absolute inset-0 overflow-hidden" style={{ paddingBottom: `calc(${ONIT_BOTTOMBAR_HEIGHT}px + env(safe-area-inset-bottom))` }}>
        {/* Индикатор pull-to-refresh */}
        <div
          className="absolute left-0 right-0 flex items-center justify-center"
          style={{ top: -40, height: 40, transform: `translateY(${pullDistance}px)` }}
        >
          <div
            className="w-6 h-6 rounded-full border-2 border-gray-200"
            style={{
              borderTopColor: '#007AFF',
              opacity: Math.min(1, pullDistance / PULL_REFRESH_THRESHOLD),
              transform: refreshing ? undefined : `rotate(${(pullDistance / PULL_REFRESH_THRESHOLD) * 360}deg)`,
              animation: refreshing ? 'pp-onit-pull-spin 0.7s linear infinite' : undefined,
            }}
          />
        </div>
        <div
          className="h-full"
          style={{
            // Сдвиг списка вместо пересчёта раскладки
            transform: `translateY(${(1 - collapseProgress) * topBarContentBottom + pullDistance}px)`,
            transition: pullReleasing ? 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
            willChange: 'transform',
          }}
        >
          <div className="h-full" onScrollCapture={handleListScroll}>
            <RouteBar
            isHovered
            isAdapterMode={false}
            isAnyModalOpen={false}
            previewLocked={false}
            isLoggedIn={isLoggedIn}
            authActionNonce={0}
            guestRoutes={EMPTY_ROUTES}
            justCreatedRouteId={null}
            justCreatedTab="mine"
            deletedRouteId={null}
            refreshKey={0}
            searchTrigger={0}
            pendingUserSearch={null}
            cancelUserSearchTrigger={0}
            onRouteClick={handleRouteClick}
            onCreateNew={() => {}}
            onAdaptRoute={() => {}}
            lockedTab="mine"
            hideFooterActions
            // Избранное в On It не переключается
            hideFavoriteToggle
            // Общий мобильный флаг RouteBar
            mobileMode
          />
          </div>
        </div>
      </div>

      {/* Нижняя панель: "Пройденные", аккаунт и настройки */}
      <div
        className="fixed bottom-0 inset-x-0 flex items-center justify-between px-4 bg-white/95 backdrop-blur-md border-t border-gray-200/50"
        style={{
          zIndex: ONIT_CHROME_Z,
          height: ONIT_BOTTOMBAR_HEIGHT,
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxSizing: 'content-box',
        }}
      >
        <button
          onClick={() => setPastRoutesOpen(true)}
          className="px-4 h-10 rounded-xl bg-blue-500 flex items-center justify-center text-sm font-medium text-white active:bg-blue-600"
        >
          {t('Пройденные')}
        </button>
        <div className="flex items-center gap-2">
          {/* Тап по плашке аккаунта открывает ЛК */}
          {/* Высота кнопки задана inline */}
          <button
            onClick={() => setProfileOpen(true)}
            className="px-4 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-sm font-medium text-gray-700 active:bg-gray-50"
            style={{ height: 40, boxSizing: 'border-box' }}
          >
            {userName}
          </button>
          <button
            onClick={() => setPreferencesOpen(true)}
            className="w-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center flex-shrink-0 active:bg-gray-50"
            style={{ height: 40, boxSizing: 'border-box' }}
          >
            <GearIcon size={20} color="#374151" />
          </button>
        </div>
      </div>

      {/* "Пройденные" монтируются условно */}
      {pastRoutesOpen && <OnItPastRoutes onClose={() => setPastRoutesOpen(false)} />}

      {/* Личный кабинет (fullBleedMobile) */}
      <ProfileModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        onLogout={handleLogout}
        zIndex={ONIT_MODAL_Z}
        offsetX={0}
        offsetY={0}
        isTop
        depth={0}
        fullBleedMobile
      />

      <PreferencesModal
        isOpen={preferencesOpen}
        onClose={() => {
          onLanguageChange(committedLanguageRef.current);
          setPreferencesOpen(false);
        }}
        isLoggedIn={isLoggedIn}
        language={language}
        onLanguageChange={onLanguageChange}
        onLanguageSync={onLanguageSync}
        privateTerminal={privateTerminal}
        onPrivateTerminalChange={setPrivateTerminal}
        defaultTaxiTariff={defaultTaxiTariff}
        onDefaultTaxiTariffChange={setDefaultTaxiTariff}
        walkDistanceLimitM={walkDistanceLimitM}
        onWalkDistanceLimitMChange={setWalkDistanceLimitM}
        onOpenChangePassword={() => setChangePasswordOpen(true)}
        onOpenChangeEmail={() => setChangeEmailOpen(true)}
        zIndex={ONIT_MODAL_Z}
        offsetX={0}
        offsetY={0}
        isTop={!changePasswordOpen && !changeEmailOpen}
        depth={0}
        fullBleedMobile
      />

      {/* Смена пароля и email поверх настроек (десктопная карточка) */}
      <ChangePasswordModal
        isOpen={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
        zIndex={ONIT_MODAL_Z + 10}
        offsetX={0}
        offsetY={0}
        isTop
        depth={0}
      />
      <ChangeEmailModal
        isOpen={changeEmailOpen}
        onClose={() => setChangeEmailOpen(false)}
        zIndex={ONIT_MODAL_Z + 10}
        offsetX={0}
        offsetY={0}
        isTop
        depth={0}
      />
    </div>
  );
}

export default OnItApp;
