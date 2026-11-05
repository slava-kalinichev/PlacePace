import { showInfoPlaque } from '../InfoPlaque';
import { api, type GuestRoute } from '../../api/client';
import { type TransportModeToggles } from './transportModeTypes';
import React from 'react';

export interface HandleSaveContext {
  accessLevel: "private" | "public";
  appliedTransportToggles: TransportModeToggles;
  beginLinkRecopy: () => ((saved: boolean) => void);
  computePublicRouteData: (data: any[], forceTrim?: boolean) => any[];
  coverImage: string | null;
  displayMode: "full" | "points_only";
  endPoint: string;
  endPointToggle: boolean;
  endTime: string;
  endWithStartPoint: boolean;
  getRouteAggregates: (data: any[]) => { duration: number; cost: number; };
  isAdmin: boolean;
  isLoggedIn: boolean;
  onClose: () => void;
  onGuestRouteSaved: (route: GuestRoute) => void;
  onRouteSaved: (id: number, targetTab: "mine" | "all") => void;
  peopleCount: number;
  publicId: `${string}-${string}-${string}-${string}-${string}`;
  routeData: any[];
  routeDate: string;
  routeDescription: string;
  routeTitle: string;
  saveAsPersonal: boolean;
  setIsVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setTitleError: React.Dispatch<React.SetStateAction<boolean>>;
  startPoint: string;
  startPointToggle: boolean;
  startTime: string;
  t: (ru: string) => string;
}

export const handleSave = async (ctx: HandleSaveContext) => {
  const { accessLevel, appliedTransportToggles, beginLinkRecopy, computePublicRouteData, coverImage, displayMode, endPoint, endPointToggle, endTime, endWithStartPoint, getRouteAggregates, isAdmin, isLoggedIn, onClose, onGuestRouteSaved, onRouteSaved, peopleCount, publicId, routeData, routeDate, routeDescription, routeTitle, saveAsPersonal, setIsVisible, setTitleError, startPoint, startPointToggle, startTime, t } = ctx;
  if (!routeTitle.trim()) {
    setTitleError(true);
    return;
  }

  const isRecommended = isAdmin && !saveAsPersonal;

  if (!isRecommended && accessLevel === 'public' && !isLoggedIn) {
    showInfoPlaque(t('Войдите в аккаунт, чтобы сохранять открытые маршруты'), 'error');
    return;
  }

  const { duration: totalDuration, cost: totalCostPerPerson } = getRouteAggregates(routeData);
  // Рекомендованный маршрут: публичный и без терминалов
  const isPublic = isRecommended || accessLevel === 'public';
  const publicData = isPublic ? computePublicRouteData(routeData, isRecommended) : null;
  const publicAggregates = publicData ? getRouteAggregates(publicData) : null;

  if (isRecommended) {
    const recopyLink = beginLinkRecopy();
    const result = await api.createRoute({
      public_id: publicId,
      title: routeTitle,
      description: routeDescription || null,
      cover_image: coverImage,
      start_point: startPointToggle ? null : (startPoint || null),
      end_point: endPointToggle || endWithStartPoint ? null : (endPoint || null),
      date: routeDate || null,
      start_time: startTime || null,
      end_time: endTime || null,
      people_count: 1,
      total_duration: totalDuration,
      total_cost: totalCostPerPerson,
      total_duration_public: publicAggregates?.duration ?? null,
      total_cost_public: publicAggregates?.cost ?? null,
      is_public: true,
      display_mode: 'full',
      is_recommended: true,
      route_data: routeData,
      route_data_public: publicData,
      transport_options: appliedTransportToggles,
    }).catch(() => null);

    if (!result || !('success' in result)) {
      recopyLink(false);
      showInfoPlaque(t('Не удалось сохранить маршрут. Попробуйте снова.'), 'error');
      return;
    }
    recopyLink(true);

    // Админ-создатель не видит такой маршрут в "Мои": открываем "Все"
    setIsVisible(false);
    setTimeout(() => {
      showInfoPlaque(t('Маршрут создан'), 'success');
      onRouteSaved(result.id, 'all');
      setTimeout(onClose, 1500);
    }, 300);
    return;
  }

  if (!isLoggedIn) {
    // Гость: маршрут приватный, хранится только в памяти
    const guestRouteId = Date.now();
    onGuestRouteSaved({
      card: {
        id: guestRouteId,
        title: routeTitle,
        description: routeDescription || null,
        points: routeData.filter(item => item.type === 'attraction' || item.type === 'food').length,
        duration: totalDuration,
        cost_per_person: totalCostPerPerson,
        people_count: peopleCount,
        stars_count: null,
        is_favorite: false,
        image: coverImage,
        is_owner: true,
        is_public: false,
        is_recommended: false,
        display_mode: 'full',
        cost_excludes_transport: false,
        admin_username: null,
        popular_rank: null,
      },
      payload: {
        public_id: publicId,
        title: routeTitle,
        description: routeDescription || null,
        cover_image: coverImage,
        start_point: startPointToggle ? null : (startPoint || null),
        end_point: endPointToggle || endWithStartPoint ? null : (endPoint || null),
        date: routeDate || null,
        start_time: startTime || null,
        end_time: endTime || null,
        people_count: peopleCount,
        total_duration: totalDuration,
        total_cost: totalCostPerPerson,
        total_duration_public: null,
        total_cost_public: null,
        is_public: false,
        display_mode: 'full',
        is_recommended: false,
        route_data: routeData,
        route_data_public: null,
        transport_options: appliedTransportToggles,
      },
    });
    setIsVisible(false);
    setTimeout(() => {
      showInfoPlaque(t('Маршрут сохранён для сессии — войдите, чтобы не потерять его'), 'warning');
      onRouteSaved(guestRouteId, 'mine');
      setTimeout(onClose, 1500);
    }, 300);
    return;
  }

  const recopyLink = beginLinkRecopy();
  const result = await api.createRoute({
    public_id: publicId,
    title: routeTitle,
    description: routeDescription || null,
    cover_image: coverImage,
    start_point: startPointToggle ? null : (startPoint || null),
    end_point: endPointToggle || endWithStartPoint ? null : (endPoint || null),
    date: routeDate || null,
    start_time: startTime || null,
    end_time: endTime || null,
    people_count: peopleCount,
    total_duration: totalDuration,
    total_cost: totalCostPerPerson,
    total_duration_public: publicAggregates?.duration ?? null,
    total_cost_public: publicAggregates?.cost ?? null,
    is_public: isPublic,
    display_mode: displayMode,
    is_recommended: false,
    route_data: routeData,
    route_data_public: publicData,
    transport_options: appliedTransportToggles,
  }).catch(() => null);

  if (!result || !('success' in result)) {
    recopyLink(false);
    showInfoPlaque(t('Не удалось сохранить маршрут. Попробуйте снова.'), 'error');
    return;
  }
  recopyLink(true);

  setIsVisible(false);
  setTimeout(() => {
    showInfoPlaque(t('Маршрут создан'), 'success');
    onRouteSaved(result.id, 'mine');
    setTimeout(onClose, 1500);
  }, 300);
};
