import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import RouteBar from './components/RouteBar';
import CreateRouteModal from './components/CreateRouteModal';
import Preview from './components/Preview';
import LoginModal from './components/LoginModal';
import RegisterModal from './components/RegisterModal';
import ProfileModal from './components/ProfileModal';
import PreferencesModal from './components/PreferencesModal';
import ChangePasswordModal from './components/ChangePasswordModal';
import ChangeEmailModal from './components/ChangeEmailModal';
import ResetPasswordModal from './components/ResetPasswordModal';
import YandexMap from './components/YandexMap';
import { LanguageProvider, type Language } from './i18n/LanguageContext';
import { DICTIONARY } from './i18n/dictionary';
import { api, setApiLanguage, type AuthUser, type GuestRoute, type RouteCard, type RouteDetail } from './api/client';
import { GearIcon } from './components/sfSymbols';
import { CHROME_Z, BACKDROP_Z, LAYER_Z_BASE, LAYER_Z_STEP, DEFAULT_HEADER_HEIGHT, DEFAULT_CAP_HEADER_HEIGHT } from './components/layerGeometry';
import { InfoPlaqueHost, showInfoPlaque, showCancelPlaque, showBlockingConfirmPlaque } from './components/InfoPlaque';
import { claimGuestSnapshot, saveGuestSnapshot } from './utils/guestTransfer';

// Стек слоёв модальных окон: до 3 окон, интерактивно только верхнее
type Layer =
  // instanceKey - React key для CreateRouteModal
  | { type: 'cap'; adaptFrom: { detail: RouteDetail; mode: 'adapt' | 'personalize' } | null; fullscreen: boolean; instanceKey: number }
  | { type: 'preview'; route: RouteCard; fullscreen: boolean }
  | { type: 'auth'; mode: 'login' | 'register'; fullscreen: boolean }
  | { type: 'profile'; fullscreen: boolean }
  | { type: 'preferences'; fullscreen: boolean }
  | { type: 'change-password'; fullscreen: boolean }
  | { type: 'change-email'; fullscreen: boolean }
  // Открывается по ссылке из письма (?reset_token=); токен хранится в слое
  | { type: 'reset-password'; token: string; fullscreen: boolean };

type LayerType = Layer['type'];
function layerTitle(layer: Layer): string {
  switch (layer.type) {
    case 'cap': return 'Создание маршрута';
    case 'preview': return 'Просмотр';
    case 'auth': return layer.mode === 'login' ? 'Вход в аккаунт' : 'Регистрация';
    case 'profile': return 'Личный кабинет';
    case 'preferences': return 'Настройки';
    case 'change-password': return 'Сменить пароль';
    case 'change-email': return 'Сменить email';
    case 'reset-password': return 'Восстановление пароля';
  }
}

function App() {
  // Карта-подложка
  const [mapEnabled, setMapEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    api.getAppSettings().then(s => setMapEnabled(s.map_enabled)).catch(() => setMapEnabled(false));
  }, []);

  const [isRouteBarHovered, setIsRouteBarHovered] = useState(false);
  // Счётчик Cmd/Ctrl+F: RouteBar раскрывает поиск
  const [searchTrigger, setSearchTrigger] = useState(0);
  // Поиск по логину создателя из "Просмотра"
  const [pendingUserSearch, setPendingUserSearch] = useState<{ query: string; nonce: number } | null>(null);
  // Повторный клик по иконке возвращает RouteBar на прежний раздел
  const [cancelUserSearchTrigger, setCancelUserSearchTrigger] = useState(0);
  // Режим "Адаптировать готовый"
  const [isAdapterMode, setIsAdapterMode] = useState(false);
  const [layers, setLayers] = useState<Layer[]>([]);
  // Счётчик для Layer['cap'].instanceKey
  const capInstanceCounterRef = useRef(0);
  const nextCapInstanceKey = () => ++capInstanceCounterRef.current;
  // Слой, закрытый кликом по backdrop и ожидающий окна отмены (остаётся в layers)
  const [suspendedType, setSuspendedType] = useState<LayerType | null>(null);
  const suspendFinalizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Несохранённые изменения в "Просмотре"
  const [previewDirty, setPreviewDirty] = useState(false);
  // Этап 1 создания маршрута ещё пуст
  const [capEmptyFirstStep, setCapEmptyFirstStep] = useState(true);
  // Тот же приём для формы регистрации
  const [registerFormEmpty, setRegisterFormEmpty] = useState(true);
  // слои без приостановленного (для расчётов позиций и backdrop)
  const effectiveLayers = suspendedType ? layers.filter(l => l.type !== suspendedType) : layers;
  // Измеренные высоты шапок слоёв (для каскада)
  const [headerHeights, setHeaderHeights] = useState<Record<LayerType, number>>({
    cap: DEFAULT_CAP_HEADER_HEIGHT,
    preview: DEFAULT_HEADER_HEIGHT,
    auth: DEFAULT_HEADER_HEIGHT,
    profile: DEFAULT_HEADER_HEIGHT,
    preferences: DEFAULT_HEADER_HEIGHT,
    'change-password': DEFAULT_HEADER_HEIGHT,
    'change-email': DEFAULT_HEADER_HEIGHT,
    'reset-password': DEFAULT_HEADER_HEIGHT,
  });
  const reportHeaderHeight = useCallback((type: LayerType, px: number) => {
    setHeaderHeights(prev => (prev[type] === px ? prev : { ...prev, [type]: px }));
  }, []);

  // Счётчик для тихого обновления RouteBar после изменений
  const [routesRefreshKey, setRoutesRefreshKey] = useState(0);
  // Id удалённого маршрута (запускает анимацию исчезновения карточки)
  const [deletedRouteId, setDeletedRouteId] = useState<number | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // Счётчик действий входа и выхода (не восстановления сессии)
  const [authActionNonce, setAuthActionNonce] = useState(0);
  const [userName, setUserName] = useState('');
  const [loginAnimationKey, setLoginAnimationKey] = useState(0);
  const [isAccountHovered, setIsAccountHovered] = useState(false);
  // Раскрытие капсулы аккаунта: на время анимации overflow:hidden
  const [isAccountRevealed, setIsAccountRevealed] = useState(false);
  // Гостевые маршруты (только в памяти, при входе переносятся на аккаунт)
  const [guestRoutes, setGuestRoutes] = useState<GuestRoute[]>([]);
  // Мемоизированные карточки гостевых маршрутов
  const guestRouteCards = useMemo(() => guestRoutes.map(g => g.card), [guestRoutes]);
  // Настройки гостя (переносятся на аккаунт при входе)
  const [guestPreferences, setGuestPreferences] = useState<{
    language: 'Русский' | 'English';
    privateTerminal: boolean;
    defaultTaxiTariff: 'economy' | 'comfort' | 'business';
    walkDistanceLimitM: number;
  }>({
    language: 'Русский',
    privateTerminal: true,
    defaultTaxiTariff: 'economy',
    walkDistanceLimitM: 800,
  });
  const [guestPreferencesTouched, setGuestPreferencesTouched] = useState(false);
  // true - регистрация ждёт подтверждения почты, гостевые данные лежат в снимке
  const registrationPendingRef = useRef(false);
  // 'Русский'/'English' -> код языка
  const toLanguageCode = (value: 'Русский' | 'English'): Language => (value === 'English' ? 'en' : 'ru');
  //Сохранённый язык
  const committedLanguageRef = useRef<'Русский' | 'English'>(guestPreferences.language);
  const onLanguageSync = (language: 'Русский' | 'English') => {
    committedLanguageRef.current = language;
    setGuestPreferences(prev => ({ ...prev, language }));
  };
  // t() для самого App (он сам LanguageProvider)
  const t = (ru: string): string => (toLanguageCode(guestPreferences.language) === 'en' ? (DICTIONARY[ru] ?? ru) : ru);
  // Язык для заголовка X-Lang
  setApiLanguage(toLanguageCode(guestPreferences.language));
  // Id только что созданного маршрута (подсветка карточки)
  const [justCreatedRouteId, setJustCreatedRouteId] = useState<number | null>(null);
  const [justCreatedTab, setJustCreatedTab] = useState<'mine' | 'all'>('mine');
  const [justCreatedSkipScroll, setJustCreatedSkipScroll] = useState(false);
  const [adaptTransition, setAdaptTransition] = useState<RouteCard | null>(null);

  useEffect(() => {
    if (isAccountHovered) {
      const timer = setTimeout(() => setIsAccountRevealed(true), 500);
      return () => clearTimeout(timer);
    } else {
      setIsAccountRevealed(false);
    }
  }, [isAccountHovered]);

  // Cmd/Ctrl+F раскрывает routebar с поиском
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsRouteBarHovered(true);
        setSearchTrigger(prev => prev + 1);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Предупреждение гостю при обновлении страницы (маршруты хранятся только в памяти)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isRefreshShortcut = e.key === 'F5' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r');
      if (!isRefreshShortcut || isLoggedIn || guestRoutes.length === 0) return;
      e.preventDefault();
      showBlockingConfirmPlaque(
        t('При обновлении страницы доступ к созданным маршрутам будет потерян. Подтвердить обновление?'),
        () => window.location.reload(),
        () => {},
      );
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLoggedIn, guestRoutes]);

  // Запасное предупреждение при закрытии вкладки
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isLoggedIn || guestRoutes.length === 0) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isLoggedIn, guestRoutes]);

  // Восстановление входа при обновлении страницы
  useEffect(() => {
    api.me().then((result) => {
      if (result.authenticated && result.first_name && result.last_name) {
        setIsLoggedIn(true);
        setUserName(`${result.first_name.charAt(0)}. ${result.last_name}`);
        // Язык аккаунта применяется сразу после загрузки профиля
        api.getProfile().then(p => {
          onLanguageSync(p.language === 'en' ? 'English' : 'Русский');
          setGuestPreferences(prev => ({
            ...prev,
            defaultTaxiTariff: p.default_taxi_tariff,
            walkDistanceLimitM: p.walk_distance_limit_m,
          }));
        }).catch(() => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ссылка ?route=<publicId> открывает "Просмотр" маршрута
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const publicId = params.get('route');
    if (!publicId) return;

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('route');
    window.history.replaceState({}, '', cleanUrl.toString());

    api.lookupRoute(publicId).then((lookupResult) => {
      if (!lookupResult.found) {
        showInfoPlaque(t('Маршрут не найден'), 'error');
        return;
      }
      api.getRouteDetail(lookupResult.id).then((detail) => {
        if ('error' in detail) {
          showInfoPlaque(t('Недостаточно прав для просмотра данного маршрута'), 'error');
          return;
        }
        const routeCard: RouteCard = {
          id: detail.id,
          title: detail.title,
          description: detail.description,
          points: detail.route_data.filter((i: any) => i.type === 'attraction' || i.type === 'food').length,
          duration: detail.total_duration,
          cost_per_person: detail.total_cost,
          people_count: detail.people_count,
          stars_count: detail.is_public ? detail.stars_count : null,
          is_favorite: false,
          image: detail.cover_image,
          is_owner: detail.is_owner,
          is_public: detail.is_public,
          is_recommended: detail.is_recommended,
          display_mode: detail.display_mode,
          cost_excludes_transport: detail.cost_excludes_transport,
          admin_username: null,
          popular_rank: null,
        };
        pushLayer({ type: 'preview', route: routeCard, fullscreen: false });
      }).catch(() => {
        showInfoPlaque(t('Не удалось загрузить маршрут'), 'error');
      });
    }).catch(() => {
      showInfoPlaque(t('Не удалось загрузить маршрут'), 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ссылка подтверждения email ?verify_token=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('verify_token');
    if (!token) return;

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('verify_token');
    window.history.replaceState({}, '', cleanUrl.toString());

    api.verifyEmail(token).then((result) => {
      if (!result.success) {
        showInfoPlaque(t(result.error), 'error');
        return;
      }
      if (result.purpose === 'register') {
        // Как после обычного входа: переносим гостевые маршруты и настройки
        handleLogin(result);
        showInfoPlaque(`${t('Добро пожаловать в Place Pace,')} ${result.first_name}!`, 'success');
      } else {
        showInfoPlaque(
          result.message_variant === 'changed' ? t('Email сменён') : t('Email привязан к аккаунту'),
          'success',
        );
      }
    }).catch(() => {
      showInfoPlaque(t('Не удалось подтвердить email'), 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ссылка сброса пароля ?reset_token= (открывает форму нового пароля)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset_token');
    if (!token) return;

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('reset_token');
    window.history.replaceState({}, '', cleanUrl.toString());

    pushLayer({ type: 'reset-password', token, fullscreen: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Добавляет слой в стек (САП - только первым, повтор типа на вершине игнорируется)
  const pushLayer = (layer: Layer) => {
    // Приостановленный слой считается фоновой деталью и удаляется
    if (suspendedType === layer.type) {
      if (layer.type === 'cap') {
        if (suspendFinalizeTimeoutRef.current) {
          clearTimeout(suspendFinalizeTimeoutRef.current);
          suspendFinalizeTimeoutRef.current = null;
        }
        setSuspendedType(null);
        closeLayerType('cap');
      } else {
        if (suspendFinalizeTimeoutRef.current) {
          clearTimeout(suspendFinalizeTimeoutRef.current);
          suspendFinalizeTimeoutRef.current = null;
        }
        setSuspendedType(null);
        return;
      }
    }
    setLayers(prev => {
      const effectivePrev = suspendedType ? prev.filter(l => l.type !== suspendedType) : prev;
      const top = effectivePrev[effectivePrev.length - 1];
      if (top?.type === layer.type) return prev;
      if (layer.type === 'cap' && effectivePrev.length > 0) return prev;
      if (effectivePrev.some(l => l.type === layer.type)) return prev;
      if (effectivePrev.length >= 3) {
        showInfoPlaque(
          t('Закройте "{title}" для открытия нового окна').replace('{title}', t(layerTitle(effectivePrev[effectivePrev.length - 1]))),
          'warning'
        );
        return prev;
      }
      return [...prev, layer];
    });
  };

  // Закрывает слой по типу
  const closeLayerType = (type: LayerType) => {
    setLayers(prev => {
      const closing = prev.find(l => l.type === type);
      if (closing?.fullscreen) {
        suppressRouteBarHoverUntilRef.current = Date.now() + 1000;
      }
      return prev.filter(l => l.type !== type);
    });
  };

  // Приостанавливает слой и показывает плашку отмены на 5 с
  const suspendLayerWithUndo = (type: LayerType, text: string) => {
    setSuspendedType(type);
    showCancelPlaque(text, () => {
      if (suspendFinalizeTimeoutRef.current) clearTimeout(suspendFinalizeTimeoutRef.current);
      suspendFinalizeTimeoutRef.current = null;
      setSuspendedType(null);
    });
    suspendFinalizeTimeoutRef.current = setTimeout(() => {
      suspendFinalizeTimeoutRef.current = null;
      setSuspendedType(null);
      closeLayerType(type);
    }, 5000);
  };

  // Клик по backdrop: предлагает отмену закрытия
  const handleBackdropClose = () => {
    const top = effectiveLayers[effectiveLayers.length - 1];
    if (!top) return;

    if (top.type === 'cap') {
      //Нечего отменять на пустом первом этапе
      if (capEmptyFirstStep) {
        closeLayerType('cap');
        return;
      }
      const mode = top.adaptFrom?.mode;
      const text = mode === 'adapt' ? t('Вернуться к адаптации маршрута')
        : mode === 'personalize' ? t('Вернуться к персонализации маршрута')
        : t('Вернуться к созданию маршрута');
      suspendLayerWithUndo('cap', text);
      return;
    }
    if (top.type === 'auth' && top.mode === 'register') {
      // Нечего отменять в пустой форме
      if (registerFormEmpty) {
        closeLayerType('auth');
        return;
      }
      suspendLayerWithUndo('auth', t('Вернуться к регистрации'));
      return;
    }
    if (top.type === 'preview' && previewDirty) {
      suspendLayerWithUndo('preview', t('Вернуться к просмотру'));
      return;
    }
    closeLayerType(top.type);
  };

  // Вход <-> регистрация: один слой, меняется mode
  const switchAuthMode = (mode: 'login' | 'register') => {
    setLayers(prev => prev.map(l => (l.type === 'auth' ? { ...l, mode } : l)));
  };

  // Подавление hover-раскрытия routebar после выхода из fullscreen
  const suppressRouteBarHoverUntilRef = useRef(0);
  const routeBarHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Переключает fullscreen для слоя этого типа
  const toggleFullscreen = (type: LayerType) => {
    setLayers(prev => prev.map(l => {
      if (l.type !== type) return l;
      if (l.fullscreen) {
        // При выходе из fullscreen подавляем hover routebar
        suppressRouteBarHoverUntilRef.current = Date.now() + 1000;
      }
      return { ...l, fullscreen: !l.fullscreen };
    }));
  };

  // Курсор над routebar
  const routeBarPointerInsideRef = useRef(false);

  const handleRouteBarMouseEnter = () => {
    routeBarPointerInsideRef.current = true;
    const remaining = suppressRouteBarHoverUntilRef.current - Date.now();
    if (remaining > 0) {
      routeBarHoverTimerRef.current = setTimeout(() => {
        routeBarHoverTimerRef.current = null;
        setIsRouteBarHovered(true);
      }, remaining);
    } else {
      setIsRouteBarHovered(true);
    }
  };

  const handleRouteBarMouseLeave = () => {
    routeBarPointerInsideRef.current = false;
    if (routeBarHoverTimerRef.current) {
      clearTimeout(routeBarHoverTimerRef.current);
      routeBarHoverTimerRef.current = null;
    }
    setIsRouteBarHovered(false);};

  // Половина полного каскада по числу окон (кэш по глубине)
  const stackCenterShiftCache = useRef<Record<number, number>>({});

  // Позиция слоя index встеке
  const layerPosition = (index: number) => {
    const isTop = index === effectiveLayers.length - 1;
    const depth = effectiveLayers.length - 1 - index;
    let rawOffset = 0;
    for (let k = index; k < effectiveLayers.length - 1; k++) {
      rawOffset += headerHeights[effectiveLayers[k].type];
    }

    const depthCount = effectiveLayers.length;
    let stackCenterShift = 0;
    if (depthCount > 1) {
      if (stackCenterShiftCache.current[depthCount] === undefined) {
        let fullCascade = 0;
        for (let k = 0; k < effectiveLayers.length - 1; k++) {
          fullCascade += headerHeights[effectiveLayers[k].type];
        }
        stackCenterShiftCache.current[depthCount] = fullCascade / 2;
      }
      stackCenterShift = stackCenterShiftCache.current[depthCount];
    }

    return {
      zIndex: LAYER_Z_BASE + index * LAYER_Z_STEP,
      offsetX: rawOffset / 3,
      offsetY: rawOffset - stackCenterShift,
      isTop,
      depth,
    };
  };

  const positionFor = (type: LayerType) => {
    const index = effectiveLayers.findIndex(l => l.type === type);
    if (index === -1) return { zIndex: 0, offsetX: 0, offsetY: 0, isTop: false, depth: 0 };
    return layerPosition(index);
  };

  const topLayerType = effectiveLayers.length > 0 ? effectiveLayers[effectiveLayers.length - 1].type : null;
  // Верхний слой развёрнут на весь экран
  const topLayerFullscreen = effectiveLayers.length > 0 && effectiveLayers[effectiveLayers.length - 1].fullscreen;
  // Стиль хрома: плавно прячется при fullscreen
  const chromeVisibility = {
    opacity: topLayerFullscreen ? 0 : 1,
    pointerEvents: (topLayerFullscreen ? 'none' : 'auto') as 'none' | 'auto',
  };
  // Слой открыт, но не наверху: кнопка в хроме отключена
  const isBuried = (type: LayerType) => layers.some(l => l.type === type) && topLayerType !== type;

  // Routebar активен, пока стек пуст и нет режима адаптации
  const routeBarModalOpen = effectiveLayers.length > 0 || isAdapterMode;

  const capIndex = layers.findIndex(l => l.type === 'cap');
  const capLayer = capIndex >= 0 ? (layers[capIndex] as Extract<Layer, { type: 'cap' }>) : null;
  const previewIndex = layers.findIndex(l => l.type === 'preview');
  const previewLayer = previewIndex >= 0 ? (layers[previewIndex] as Extract<Layer, { type: 'preview' }>) : null;
  const authLayer = layers.find((l): l is Extract<Layer, { type: 'auth' }> => l.type === 'auth') ?? null;

  const handleCancelAdapter = () => {
    setIsAdapterMode(false);
  };

  // Закрытие режима адаптации кликом вне routebar
  const routeBarWrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isAdapterMode) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (routeBarWrapperRef.current && !routeBarWrapperRef.current.contains(e.target as Node)) {
        handleCancelAdapter();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAdapterMode]);

  // Клик по карточке маршрута (в обычном режиме и в режиме адаптации одинаков)
  const handleRouteClick = (route: RouteCard) => {
    // После клика сворачиваем routebar и подавляем hover на секунду
    suppressRouteBarHoverUntilRef.current = Date.now() + 1000;
    setIsRouteBarHovered(false);
    if (routeBarHoverTimerRef.current) clearTimeout(routeBarHoverTimerRef.current);
    routeBarHoverTimerRef.current = routeBarPointerInsideRef.current
      ? setTimeout(() => {
          routeBarHoverTimerRef.current = null;
          if (routeBarPointerInsideRef.current) setIsRouteBarHovered(true);
        }, 1000)
      : null;
    setIsAdapterMode(false);
    if (topLayerType === 'preview') {
      closeLayerType('preview');
    }
    pushLayer({ type: 'preview', route, fullscreen: false });
  };

  const handleRouteDeleted = (routeId: number) => {
    closeLayerType('preview');
    setDeletedRouteId(routeId);
    setTimeout(() => setDeletedRouteId(current => (current === routeId ? null : current)), 500);
  };

  const handleRouteUpdated = () => {
    closeLayerType('preview');
    setRoutesRefreshKey(prev => prev + 1);
  };

  // Адаптировать/Персонализировать: заменяет стек единственным слоем САП
  const handleAdapt = (detail: RouteDetail, mode: 'adapt' | 'personalize') => {
    if (previewLayer) setAdaptTransition(previewLayer.route);
    setLayers([{ type: 'cap', adaptFrom: { detail, mode }, fullscreen: false, instanceKey: nextCapInstanceKey() }]);
    setTimeout(() => setAdaptTransition(null), 350);
  };

  const handleCreateNew = () => {
    setIsRouteBarHovered(false);
    pushLayer({ type: 'cap', adaptFrom: null, fullscreen: false, instanceKey: nextCapInstanceKey() });
  };

  const handleAdaptRoute = () => {
    if (routeBarModalOpen) return;
    setIsAdapterMode(true);
  };

  const handleGuestRouteSaved = (route: GuestRoute) => {
    setGuestRoutes(prev => [route, ...prev]);
  };

  const handleRouteSaved = (id: number, targetTab: 'mine' | 'all') => {
    // Обычное создание всегда скроллит
    setJustCreatedSkipScroll(false);
    setJustCreatedTab(targetTab);
    setJustCreatedRouteId(id);
    // Длительность совпадает с .animate-route-created в index.css
    setTimeout(() => {
      setJustCreatedRouteId(current => (current === id ? null : current));
    }, 1680);
  };

  // Обновить текущий: маршрут не новый, к началу списка не прыгает
  const handleRouteUpdatedInPlace = (id: number) => {
    setRoutesRefreshKey(prev => prev + 1);
    setJustCreatedSkipScroll(true);
    setJustCreatedTab('mine');
    setJustCreatedRouteId(id);
    setTimeout(() => {
      setJustCreatedRouteId(current => (current === id ? null : current));
    }, 1680);
  };

  // Регистрация ждёт подтверждения почты: сохраняем гостевые данные
  const handleRegistrationPending = () => {
    registrationPendingRef.current = true;
    if (guestRoutes.length === 0 && !guestPreferencesTouched) return;
    saveGuestSnapshot({ routes: guestRoutes, preferences: guestPreferences, preferencesTouched: guestPreferencesTouched });
  };

  const handleLogin = async (user: AuthUser) => {
    // Данные гостя: из снимка (подтверждение почты), иначе из памяти
    const snapshot = claimGuestSnapshot();
    let routes = guestRoutes;
    let preferences = guestPreferences;
    let preferencesTouched = guestPreferencesTouched;
    if (snapshot) {
      routes = snapshot.routes;
      preferences = snapshot.preferences;
      preferencesTouched = snapshot.preferencesTouched;
    } else if (registrationPendingRef.current) {
      // Снимок уже забрала другая вкладка, перенос выполнен там
      routes = [];
      preferencesTouched = false;
    }
    registrationPendingRef.current = false;

    // Гостевые маршруты приватные: переносим их на аккаунт, они появятся в Мои
    if (routes.length > 0) {
      const failed: GuestRoute[] = [];
      for (const route of [...routes].reverse()) {
        const result = await api.createRoute(route.payload).catch(() => null);
        if (!result || !('success' in result)) failed.push(route);
      }
      setGuestRoutes(failed);
      if (failed.length > 0) {
        // Непереданные маршруты сохраняем для следующей попытки
        saveGuestSnapshot({ routes: failed, preferences, preferencesTouched: false });
        showInfoPlaque(t('Не удалось перенести маршруты в аккаунт: {n}').replace('{n}', String(failed.length)), 'warning');
      }
    }

    // Изменённые гостем настройки переносятся на аккаунт
    if (preferencesTouched) {
      await api.updateProfile({
        private_terminal_enabled: preferences.privateTerminal,
        language: toLanguageCode(preferences.language),
        default_taxi_tariff: preferences.defaultTaxiTariff,
        walk_distance_limit_m: preferences.walkDistanceLimitM,
      }).catch(() => null);
      setGuestPreferences(prev => ({ ...prev, ...preferences }));
      onLanguageSync(preferences.language);
      setGuestPreferencesTouched(false);
    }

    setIsLoggedIn(true);
    setUserName(`${user.first_name.charAt(0)}. ${user.last_name}`);
    setLoginAnimationKey(prev => prev + 1);
    setAuthActionNonce(prev => prev + 1);
  };

  const handleLogout = async () => {
    await api.logout();
    setIsLoggedIn(false);
    setUserName('');
    setIsAccountHovered(false);
    // Сброс флага гостевых настроек при выходе
    setGuestPreferencesTouched(false);
    // Анимация появления кнопки "Войти"
    setLoginAnimationKey(prev => prev + 1);
    setAuthActionNonce(prev => prev + 1);
    // Выход закрывает все окна, кроме САП
    setLayers(prev => {
      const cap = prev.find(l => l.type === 'cap');
      return cap ? [cap] : [];
    });
  };

  const capPos = positionFor('cap');
  const previewPos = positionFor('preview');
  const authPos = positionFor('auth');
  const profilePos = positionFor('profile');
  const preferencesPos = positionFor('preferences');
  const changePasswordPos = positionFor('change-password');
  const changeEmailPos = positionFor('change-email');
  const resetPasswordPos = positionFor('reset-password');
  const chromeButtonClass = 'transition-all duration-300 hover:shadow-xl hover:scale-105 disabled:opacity-40 disabled:pointer-events-none';

  return (
    <LanguageProvider language={toLanguageCode(guestPreferences.language)}>
    <div className="relative w-screen h-screen overflow-hidden">
      {/* Карта-подложка */}
      <div className="absolute inset-0 z-0">
        {mapEnabled ? (
          <YandexMap />
        ) : (
          // Отступ равен ширине свёрнутого routebar
          <div
            className="w-full h-full flex items-center justify-center bg-gray-300"
            style={{ paddingLeft: '15vw' }}
          >
            <p className="text-center text-xl font-medium px-8" style={{ color: '#9CA3AF' }}>
              {t('За пределами карты. Внутри города.')}
            </p>
          </div>
        )}
      </div>

      {/* Общий backdrop на весь стек (затемняет только карту) */}
      <div
        className="fixed inset-0 transition-opacity duration-300"
        style={{
          zIndex: BACKDROP_Z,
          opacity: layers.length > 0 ? 1 : 0,
          pointerEvents: layers.length > 0 ? 'auto' : 'none',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
        }}
        onClick={handleBackdropClose}
      />

      <InfoPlaqueHost />

      {/* Логотип */}
      <div className="absolute top-10 right-4" style={{ zIndex: CHROME_Z, ...chromeVisibility, transition: 'opacity 0.3s ease' }}>
        <img
          src="/images/pp_logo.png"
          alt="Place Pace"
          className="w-[7.5rem] h-auto object-contain transition-transform duration-300 ease-out hover:scale-105"
        />
      </div>

      {/* RouteBar: в режиме адаптации закрывается кликом вне блока */}
      <div
        ref={routeBarWrapperRef}
        className={`absolute top-0 left-0 h-full transition-all duration-500 ease-in-out ${
          isRouteBarHovered ? 'w-[30%]' : 'w-[15%]'
        }`}
        style={{ zIndex: CHROME_Z, ...chromeVisibility }}
        onMouseEnter={handleRouteBarMouseEnter}
        onMouseLeave={handleRouteBarMouseLeave}
      >
        <RouteBar
          isHovered={isRouteBarHovered}
          isAdapterMode={isAdapterMode}
          isAnyModalOpen={routeBarModalOpen}
          // Клик по карточке блокируем, если "Просмотр" под другим слоем
          previewLocked={isBuried('preview')}
          isLoggedIn={isLoggedIn}
          authActionNonce={authActionNonce}
          guestRoutes={guestRouteCards}
          justCreatedRouteId={justCreatedRouteId}
          justCreatedTab={justCreatedTab}
          justCreatedSkipScroll={justCreatedSkipScroll}
          deletedRouteId={deletedRouteId}
          refreshKey={routesRefreshKey}
          searchTrigger={searchTrigger}
          pendingUserSearch={pendingUserSearch}
          cancelUserSearchTrigger={cancelUserSearchTrigger}
          onRouteClick={handleRouteClick}
          onCreateNew={handleCreateNew}
          onAdaptRoute={handleAdaptRoute}
        />
      </div>

      {/* Кнопка настроек */}
      <button
        onClick={() => pushLayer({ type: 'preferences', fullscreen: false })}
        disabled={isBuried('preferences')}
        style={{ zIndex: CHROME_Z, ...chromeVisibility }}
        className={`absolute bottom-3 right-3 w-12 h-12 rounded-xl bg-white shadow-lg border border-gray-200 flex items-center justify-center flex-shrink-0 ${chromeButtonClass}`}
      >
        <GearIcon
          size={24}
          color="#374151"
          style={{ opacity: isBuried('preferences') ? 0.4 : 1, transition: 'opacity 0.2s ease' }}
        />
      </button>
      {!isLoggedIn ? (
        <div
          key={loginAnimationKey}
          className="absolute bottom-3 right-[4.5rem] animate-pop-in"
          style={{ zIndex: CHROME_Z, ...chromeVisibility, transition: 'opacity 0.3s ease' }}
        >
          <button
            onClick={() => pushLayer({ type: 'auth', mode: 'login', fullscreen: false })}
            disabled={isBuried('auth')}
            className={`px-6 h-12 rounded-xl bg-white shadow-lg border border-gray-200 flex items-center justify-center flex-shrink-0 ${chromeButtonClass}`}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700 whitespace-nowrap">
              {t('Войти')}
            </span>
          </button>
        </div>
      ) : (
        <div
          key={loginAnimationKey}
          className="absolute bottom-3 right-[4.5rem] animate-pop-in"
          style={{ zIndex: CHROME_Z, ...chromeVisibility, transition: 'opacity 0.3s ease' }}
          onMouseEnter={() => setIsAccountHovered(true)}
          onMouseLeave={() => setIsAccountHovered(false)}
        >
          {/* Капсула аккаунта: в покое пилл с фамилией, при наведении "выдувает" капсулу "Выйти" */}
          <div
            className="rounded-xl bg-white border border-gray-200 flex flex-col"
            style={{
              overflow: isAccountRevealed ? 'visible' : 'hidden',
              height: isAccountHovered ? 102 : 48,
              boxShadow: isAccountHovered
                ? '0 22px 40px -14px rgba(15,23,42,0.22), 0 6px 16px -6px rgba(15,23,42,0.12)'
                : '0 6px 16px -6px rgba(15,23,42,0.14), 0 2px 6px -2px rgba(15,23,42,0.08)',
              transition: 'height 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {/* Верхняя капсула "Выйти" */}
            <div
              className="flex-shrink-0"
              style={{
                height: isAccountHovered ? 48 : 0,
                overflow: isAccountRevealed ? 'visible' : 'hidden',
                transition: 'height 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              <button
                onClick={handleLogout}
                className="w-full h-12 px-6 rounded-xl flex items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium text-red-500 hover:bg-red-50"
                style={{
                  opacity: isAccountHovered ? 1 : 0,
                  transform: isAccountHovered ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.82)',
                  transition: 'opacity 0.35s ease 0.12s, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.12s, background-color 0.2s ease',
                }}
              >
                {t('Выйти')}
              </button>
            </div>

            {/* Нижняя капсула с фамилией (кликабельна вся оставшаяся область) */}
            <button
              onClick={() => pushLayer({ type: 'profile', fullscreen: false })}
              disabled={isBuried('profile')}
              className="flex-1 flex flex-col items-stretch justify-end flex-shrink-0 disabled:opacity-40 disabled:pointer-events-none"
            >
              <span className="h-12 px-6 rounded-xl flex items-center justify-center gap-1.5 whitespace-nowrap hover:bg-gray-50 hover:scale-[1.03] transition-all duration-200">
                <span className="text-sm font-medium text-gray-700 whitespace-nowrap">{userName}</span>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* САП - всегда нижний слой */}
      {capLayer && (
        <CreateRouteModal
          key={capLayer.instanceKey}
          onClose={() => closeLayerType('cap')}
          onBackdropClose={handleBackdropClose}
          onEmptyFirstStepChange={setCapEmptyFirstStep}
          isLoggedIn={isLoggedIn}
          onGuestRouteSaved={handleGuestRouteSaved}
          onRouteSaved={handleRouteSaved}
          onRouteUpdatedInPlace={handleRouteUpdatedInPlace}
          adaptFrom={capLayer.adaptFrom}
          defaultTaxiTariff={guestPreferences.defaultTaxiTariff}
          zIndex={capPos.zIndex}
          offsetX={capPos.offsetX}
          offsetY={capPos.offsetY}
          isTop={capPos.isTop}
          depth={capPos.depth}
          isFullscreen={capLayer.fullscreen}
          onToggleFullscreen={() => toggleFullscreen('cap')}
          onHeaderHeight={(px) => reportHeaderHeight('cap', px)}
          suspended={suspendedType === 'cap'}
        />
      )}

      {previewLayer && (
        <Preview
          route={previewLayer.route}
          guestRoutes={guestRoutes}
          isLoggedIn={isLoggedIn}
          onClose={() => {
            // После удаления сбрасываем suspendedType
            setSuspendedType(prev => (prev === 'preview' ? null : prev));
            closeLayerType('preview');
          }}
          onRouteDeleted={handleRouteDeleted}
          onRouteUpdated={handleRouteUpdated}
          onAdapt={handleAdapt}
          hideAdaptButtons={layers.length !== 1}
          zIndex={previewPos.zIndex}
          offsetX={previewPos.offsetX}
          offsetY={previewPos.offsetY}
          isTop={previewPos.isTop}
          depth={previewPos.depth}
          isFullscreen={previewLayer.fullscreen}
          onToggleFullscreen={() => toggleFullscreen('preview')}
          onHeaderHeight={(px) => reportHeaderHeight('preview', px)}
          suspended={suspendedType === 'preview'}
          onDirtyChange={setPreviewDirty}
          onSearchByCreator={(username) => {
            setPendingUserSearch({ query: username, nonce: Date.now() });
          }}
          onCancelSearchByCreator={() => setCancelUserSearchTrigger(n => n + 1)}
          onDeleteBounced={() => setSuspendedType('preview')}
          onDeleteCanceled={() => setSuspendedType(null)}
        />
      )}

      {/* "Призрак" Просмотра на время перехода в САП*/}
      {adaptTransition && (
        <Preview
          route={adaptTransition}
          guestRoutes={guestRoutes}
          isLoggedIn={isLoggedIn}
          onClose={() => {}}
          onRouteDeleted={() => {}}
          onRouteUpdated={() => {}}
          onAdapt={() => {}}
          hideAdaptButtons
          zIndex={LAYER_Z_BASE + 90}
          offsetX={0}
          offsetY={0}
          isTop={false}
          depth={0}
          isFullscreen={false}
          onToggleFullscreen={() => {}}
          onSearchByCreator={() => {}}
          onCancelSearchByCreator={() => {}}
          onDeleteBounced={() => {}}
          onDeleteCanceled={() => {}}
        />
      )}

      {/* Вход и регистрация */}
      <LoginModal
        isOpen={authLayer?.mode === 'login'}
        onClose={() => closeLayerType('auth')}
        onLogin={handleLogin}
        onOpenRegister={() => switchAuthMode('register')}
        zIndex={authPos.zIndex}
        offsetX={authPos.offsetX}
        offsetY={authPos.offsetY}
        isTop={authPos.isTop}
        depth={authPos.depth}
        onHeaderHeight={(px) => reportHeaderHeight('auth', px)}
      />
      <RegisterModal
        isOpen={authLayer?.mode === 'register'}
        onClose={() => closeLayerType('auth')}
        onImmediateLogin={handleLogin}
        onPendingConfirmation={handleRegistrationPending}
        zIndex={authPos.zIndex}
        offsetX={authPos.offsetX}
        offsetY={authPos.offsetY}
        isTop={authPos.isTop}
        depth={authPos.depth}
        onHeaderHeight={(px) => reportHeaderHeight('auth', px)}
        suspended={suspendedType === 'auth'}
        onEmptyChange={setRegisterFormEmpty}
      />

      <ProfileModal
        isOpen={layers.some(l => l.type === 'profile')}
        onClose={() => closeLayerType('profile')}
        zIndex={profilePos.zIndex}
        offsetX={profilePos.offsetX}
        offsetY={profilePos.offsetY}
        isTop={profilePos.isTop}
        depth={profilePos.depth}
        onHeaderHeight={(px) => reportHeaderHeight('profile', px)}
      />
      <PreferencesModal
        isOpen={layers.some(l => l.type === 'preferences')}
        onClose={() => {
          // Несохранённый язык откатывается к сохранённому при закрытии
          setGuestPreferences(prev => ({ ...prev, language: committedLanguageRef.current }));
          closeLayerType('preferences');
        }}
        isLoggedIn={isLoggedIn}
        language={guestPreferences.language}
        onLanguageChange={(language) => {
          setGuestPreferences(prev => ({ ...prev, language }));
          // touched означает именно гостевой черновик
          if (!isLoggedIn) setGuestPreferencesTouched(true);
        }}
        onLanguageSync={onLanguageSync}
        privateTerminal={guestPreferences.privateTerminal}
        onPrivateTerminalChange={(value) => {
          setGuestPreferences(prev => ({ ...prev, privateTerminal: value }));
          // Перенос при входе только для гостевых изменений
          if (!isLoggedIn) setGuestPreferencesTouched(true);
        }}
        defaultTaxiTariff={guestPreferences.defaultTaxiTariff}
        onDefaultTaxiTariffChange={(tariff) => {
          setGuestPreferences(prev => ({ ...prev, defaultTaxiTariff: tariff }));
          if (!isLoggedIn) setGuestPreferencesTouched(true);
        }}
        walkDistanceLimitM={guestPreferences.walkDistanceLimitM}
        onWalkDistanceLimitMChange={(meters) => {
          setGuestPreferences(prev => ({ ...prev, walkDistanceLimitM: meters }));
          if (!isLoggedIn) setGuestPreferencesTouched(true);
        }}
        onOpenChangePassword={() => pushLayer({ type: 'change-password', fullscreen: false })}
        onOpenChangeEmail={() => pushLayer({ type: 'change-email', fullscreen: false })}
        zIndex={preferencesPos.zIndex}
        offsetX={preferencesPos.offsetX}
        offsetY={preferencesPos.offsetY}
        isTop={preferencesPos.isTop}
        depth={preferencesPos.depth}
        onHeaderHeight={(px) => reportHeaderHeight('preferences', px)}
      />

      <ChangePasswordModal
        isOpen={layers.some(l => l.type === 'change-password')}
        onClose={() => closeLayerType('change-password')}
        zIndex={changePasswordPos.zIndex}
        offsetX={changePasswordPos.offsetX}
        offsetY={changePasswordPos.offsetY}
        isTop={changePasswordPos.isTop}
        depth={changePasswordPos.depth}
        onHeaderHeight={(px) => reportHeaderHeight('change-password', px)}
      />

      <ChangeEmailModal
        isOpen={layers.some(l => l.type === 'change-email')}
        onClose={() => closeLayerType('change-email')}
        zIndex={changeEmailPos.zIndex}
        offsetX={changeEmailPos.offsetX}
        offsetY={changeEmailPos.offsetY}
        isTop={changeEmailPos.isTop}
        depth={changeEmailPos.depth}
        onHeaderHeight={(px) => reportHeaderHeight('change-email', px)}
      />

      <ResetPasswordModal
        isOpen={layers.some(l => l.type === 'reset-password')}
        token={layers.find((l): l is Extract<Layer, { type: 'reset-password' }> => l.type === 'reset-password')?.token ?? null}
        onClose={() => closeLayerType('reset-password')}
        onReset={handleLogin}
        zIndex={resetPasswordPos.zIndex}
        offsetX={resetPasswordPos.offsetX}
        offsetY={resetPasswordPos.offsetY}
        isTop={resetPasswordPos.isTop}
        depth={resetPasswordPos.depth}
        onHeaderHeight={(px) => reportHeaderHeight('reset-password', px)}
      />
    </div>
    </LanguageProvider>
  );
}

export default App;
