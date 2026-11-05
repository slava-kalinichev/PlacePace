// src/api/client.ts
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5001/api';
let apiLanguage: 'ru' | 'en' = 'ru';
export function setApiLanguage(language: 'ru' | 'en') {
  apiLanguage = language;
}

const nativeFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(API_BASE_URL)) return nativeFetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('X-Lang', apiLanguage);
  return nativeFetch(input, { ...init, headers });
};

export interface Place {
  id: number;
  name: string;
  description: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  work_time: string | null;
  ticket_price: number;
  recommended_duration: number;
  image_url: string | null;
  schedule?: PlaceSchedule | null;
}

type PlaceSchedule = Record<string, { from: string; to: string } | string>;

export interface Category {
  name: string;
  count: number;
  // Для категории живой поиск 2GIS (/places/live)
  live?: boolean;
}

interface LivePlacesPage {
  items: Place[];
  has_more: boolean;
}

// Админские настройки
interface AppSettings {
  // Показывать ли карту-подложку
  map_enabled: boolean;
  // Показывать ли мини-карту маршрута
  route_mini_map_enabled?: boolean;
  // Обязателен ли email при регистрации
  require_email_verification: boolean;
}

export interface AuthUser {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
}

type LoginResult =
  | ({ success: true } & AuthUser)
  | { success: false; error: string; needs_confirmation?: true; email?: string };

// Исходы регистрации: нужно подтверждение, аккаунт активен сразу, ошибка
type RegisterResult =
  | { success: true; pending_email_confirmation: true; email: string }
  | ({ success: true; immediate: true } & AuthUser)
  | { success: false; error: string; field?: 'username' | 'email' };

type VerifyEmailResult =
  | ({ success: true; purpose: 'register' } & AuthUser)
  | ({ success: true; purpose: 'change_email'; message_variant: 'changed' | 'linked' } & AuthUser)
  | { success: false; error: string };

type SimpleResult = { success: true } | { success: false; error: string; field?: 'username' | 'email' };

// Статус подтверждения регистрации
type RegistrationStatusResult =
  | ({ confirmed: true } & AuthUser)
  | { confirmed: false };

export interface Profile extends AuthUser {
  created_at: string;
  routes_count: number;
  stars_total: number;
  rank_label: string | null;
  email: string | null;
  pending_email: string | null;
  home_address: string | null;
  home_lat: number | null;
  home_lon: number | null;
  private_terminal_enabled: boolean;
  language: 'ru' | 'en';
  is_admin: boolean;
  default_taxi_tariff: 'economy' | 'comfort' | 'business';
  walk_distance_limit_m: number;
}

export interface RouteCard {
  id: number;
  title: string;
  description: string | null;
  points: number;
  duration: number | null;
  cost_per_person: number | null;
  people_count: number | null;
  // null - маршрут приватный или "Рекомендованный"
  stars_count: number | null;
  is_favorite: boolean;
  image: string | null;
  image_version?: string | null;
  is_owner: boolean;
  is_public: boolean;
  is_recommended: boolean;
  display_mode: 'full' | 'points_only' | null;
  cost_excludes_transport: boolean;
  // Логин админа-создателя - приходит только если сам смотрящий тоже админ
  admin_username: string | null;
  popular_rank: 1 | 2 | 3 | null;
}

export interface RouteDetail {
  id: number;
  public_id: string | null;
  // title/description - с переводом на язык зрителя, *_original - как ввёл автор
  title: string;
  description: string | null;
  title_original?: string;
  description_original?: string | null;
  cover_image: string | null;
  is_owner: boolean;
  is_public: boolean;
  is_recommended: boolean;
  display_mode: 'full' | 'points_only';
  creator_username: string | null;
  people_count: number;
  stars_count: number | null;
  is_favorite: boolean;
  total_cost: number | null;
  total_duration: number | null;
  cost_excludes_transport: boolean;
  created_at: string | null;
  updated_at: string | null;
  route_data: any[];
  start_point: string | null;
  end_point: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  // Состояние автонастройки транспорта, с которым построен маршрут
  transport_options: any | null;
}

interface CreateRoutePayload {
  public_id: string;
  title: string;
  description: string | null;
  cover_image: string | null;
  start_point: string | null;
  end_point: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  people_count: number;
  total_duration: number | null;
  total_cost: number | null;
  total_duration_public: number | null;
  total_cost_public: number | null;
  is_public: boolean;
  display_mode: 'full' | 'points_only';
  is_recommended: boolean;
  route_data: any[];
  route_data_public: any[] | null;
  transport_options?: any | null;
}

// Маршрут гостя (хранится только в памяти сессии)
export interface GuestRoute {
  card: RouteCard;
  payload: CreateRoutePayload;
}

export interface RouteSection {
  key: string;
  label: string | null;
  routes: RouteCard[];
}

export const api = {
  async getPlaces(category?: string): Promise<Place[]> {
    const url = category
      ? `${API_BASE_URL}/places?category=${encodeURIComponent(category)}`
      : `${API_BASE_URL}/places`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch places');
    return response.json();
  },

  // Живой поиск 2GIS; при ошибке пустой результат
  async getLivePlaces(params: { category?: string; q?: string; page?: number }): Promise<LivePlacesPage> {
    const search = new URLSearchParams();
    if (params.category) search.set('category', params.category);
    if (params.q) search.set('q', params.q);
    search.set('page', String(params.page ?? 1));
    try {
      const response = await fetch(`${API_BASE_URL}/places/live?${search.toString()}`);
      if (!response.ok) return { items: [], has_more: false };
      return await response.json();
    } catch {
      return { items: [], has_more: false };
    }
  },

  // Расписание ручных точек из 2GIS
  async getPlaceSchedules(places: { id: number; name: string; latitude: number; longitude: number }[]): Promise<Record<string, PlaceSchedule | null>> {
    try {
      const response = await fetch(`${API_BASE_URL}/places/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ places }),
      });
      if (!response.ok) return {};
      const data = await response.json();
      return data.schedules ?? {};
    } catch {
      return {};
    }
  },

  async getPlace(id: number): Promise<Place> {
    const response = await fetch(`${API_BASE_URL}/places/${id}`);
    if (!response.ok) throw new Error('Failed to fetch place');
    return response.json();
  },

  async getCategories(): Promise<Category[]> {
    const response = await fetch(`${API_BASE_URL}/categories`);
    if (!response.ok) throw new Error('Failed to fetch categories');
    return response.json();
  },

  async getAppSettings(): Promise<AppSettings> {
    const response = await fetch(`${API_BASE_URL}/app-settings`);
    if (!response.ok) throw new Error('Failed to fetch app settings');
    return response.json();
  },

  async updateAppSettings(data: Partial<AppSettings>): Promise<AppSettings> {
    const response = await fetch(`${API_BASE_URL}/app-settings`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update app settings');
    return response.json();
  },

  async register(data: {
    first_name: string; last_name: string; username: string; password: string;
    email?: string; home_address?: string; home_lat?: number | null; home_lon?: number | null;
  }): Promise<RegisterResult> {
    const response = await fetch(`${API_BASE_URL}/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  async login(login: string, password: string): Promise<LoginResult> {
    const response = await fetch(`${API_BASE_URL}/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    });
    return response.json();
  },

  async logout(): Promise<void> {
    await fetch(`${API_BASE_URL}/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  },

  async verifyEmail(token: string): Promise<VerifyEmailResult> {
    const response = await fetch(`${API_BASE_URL}/verify-email`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return response.json();
  },

  // Повторная отправка письма; получатель определяется по сессии
  async resendVerification(newEmail?: string): Promise<SimpleResult & { email?: string }> {
    const response = await fetch(`${API_BASE_URL}/resend-verification`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_email: newEmail }),
    });
    return response.json();
  },

  async getRegistrationStatus(): Promise<RegistrationStatusResult> {
    const response = await fetch(`${API_BASE_URL}/registration-status`, {
      credentials: 'include',
    });
    return response.json();
  },

  async changeEmail(newEmail: string, password: string): Promise<SimpleResult & { email?: string }> {
    const response = await fetch(`${API_BASE_URL}/profile/change-email`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_email: newEmail, password }),
    });
    return response.json();
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<SimpleResult> {
    const response = await fetch(`${API_BASE_URL}/profile/change-password`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    return response.json();
  },

  // Всегда success: true (не раскрывает наличие email)
  async requestPasswordReset(email: string): Promise<{ success: true }> {
    const response = await fetch(`${API_BASE_URL}/request-password-reset`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return response.json();
  },

  async resetPassword(token: string, newPassword: string): Promise<
    ({ success: true } & AuthUser) | { success: false; error: string }
  > {
    const response = await fetch(`${API_BASE_URL}/reset-password`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password: newPassword }),
    });
    return response.json();
  },

  async me(): Promise<{ authenticated: boolean } & Partial<AuthUser>> {
    const response = await fetch(`${API_BASE_URL}/me`, {
      credentials: 'include',
    });
    return response.json();
  },

  async getProfile(): Promise<Profile> {
    const response = await fetch(`${API_BASE_URL}/profile`, {
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Failed to fetch profile');
    return response.json();
  },

  async updateProfile(data: {
    home_address?: string; home_lat?: number | null; home_lon?: number | null;
    private_terminal_enabled?: boolean; language?: 'ru' | 'en';
    // Индивидуальные настройки аккаунта, доступны любому вошедшему
    default_taxi_tariff?: 'economy' | 'comfort' | 'business'; walk_distance_limit_m?: number;
  }): Promise<{
    success: boolean;
    home_address: string | null;
    home_lat: number | null;
    home_lon: number | null;
    private_terminal_enabled: boolean;
    language: 'ru' | 'en';
    default_taxi_tariff: 'economy' | 'comfort' | 'business';
    walk_distance_limit_m: number;
  }> {
    const response = await fetch(`${API_BASE_URL}/profile`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update profile');
    return response.json();
  },

  async createRoute(payload: CreateRoutePayload): Promise<
    { success: true; id: number; public_id: string } | { error: string }
  > {
    const response = await fetch(`${API_BASE_URL}/routes`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return response.json();
  },

  async lookupRoute(publicId: string): Promise<
    { found: true; id: number } | { found: false }
  > {
    const response = await fetch(`${API_BASE_URL}/routes/lookup/${encodeURIComponent(publicId)}`, {
      credentials: 'include',
    });
    return response.json();
  },

  async getRoutes(params: { category?: 'all' | 'mine' | 'popular'; search?: string } = {}): Promise<
    { sections: RouteSection[] }
  > {
    const query = new URLSearchParams();
    if (params.search) {
      query.set('search', params.search);
    } else if (params.category) {
      query.set('category', params.category);
    }
    const response = await fetch(`${API_BASE_URL}/routes?${query.toString()}`, {
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Failed to fetch routes');
    const data: { sections: RouteSection[] } = await response.json();
    // Обложки грузятся по URL, не из JSON
    for (const section of data.sections) {
      for (const route of section.routes) {
        if (route.image_version) {
          route.image = `${API_BASE_URL}/routes/${route.id}/cover?v=${route.image_version}`;
        }
      }
    }
    return data;
  },

  async toggleRouteStar(routeId: number): Promise<{ success: true; is_favorite: boolean; stars_count: number } | { error: string }> {
    const response = await fetch(`${API_BASE_URL}/routes/${routeId}/toggle-star`, {
      method: 'POST',
      credentials: 'include',
    });
    return response.json();
  },

  async getRouteDetail(routeId: number): Promise<RouteDetail | { error: string }> {
    const response = await fetch(`${API_BASE_URL}/routes/${routeId}`, {
      credentials: 'include',
    });
    return response.json();
  },

  async updateRoute(routeId: number, data: {
    is_public?: boolean;
    display_mode?: 'full' | 'points_only';
    // Поля для "Обновить текущий" (полное обновление маршрута)
    title?: string;
    description?: string | null;
    cover_image?: string | null;
    start_point?: string | null;
    end_point?: string | null;
    date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    people_count?: number;
    total_duration?: number | null;
    total_cost?: number | null;
    total_duration_public?: number | null;
    total_cost_public?: number | null;
    route_data?: any[];
    route_data_public?: any[] | null;
    transport_options?: any | null;
  }): Promise<
    { success: true; is_public: boolean; display_mode: string } | { error: string }
  > {
    const response = await fetch(`${API_BASE_URL}/routes/${routeId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return response.json();
  },

  async deleteRoute(routeId: number): Promise<{ success: true } | { error: string }> {
    const response = await fetch(`${API_BASE_URL}/routes/${routeId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return response.json();
  },

  // On It: прохождение маршрута

  async startWalkSession(routeId: number): Promise<{ id: number; started_at: string } | { error: string }> {
    const response = await fetch(`${API_BASE_URL}/routes/${routeId}/walk-sessions`, {
      method: 'POST',
      credentials: 'include',
    });
    return response.json();
  },

  async finishWalkSession(sessionId: number, routeData: any[]): Promise<WalkSessionStats | { error: string }> {
    const response = await fetch(`${API_BASE_URL}/walk-sessions/${sessionId}/finish`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route_data: routeData }),
    });
    return response.json();
  },

  // Завершённые прохождения пользователя
  async listWalkSessions(): Promise<WalkSessionStats[] | { error: string }> {
    const response = await fetch(`${API_BASE_URL}/walk-sessions`, {
      credentials: 'include',
    });
    return response.json();
  },

  // resolution передаётся только на втором вызове после конфликта
  async shiftStopTime(routeId: number, payload: {
    route_data: any[];
    stop_item_id: string | number;
    new_start_minutes: number;
    new_end_minutes: number;
    resolution?: 'auto_adjust' | 'cancel' | { exclude: (string | number)[] };
  }): Promise<WalkShiftResult> {
    const response = await fetch(`${API_BASE_URL}/routes/${routeId}/walk/shift`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return response.json();
  },
};
// Статистика завершённого прохождения
export interface WalkSessionStats {
  id: number;
  username: string;
  route_title: string | null;
  route_id: number | null;
  stop_count: number;
  started_at: string;
  finished_at: string;
  elapsed_seconds: number;
}

// Конфликт часов работы у точки ниже по маршруту
export interface WalkShiftConflict {
  item_id: string | number;
  name: string;
  reason: string;}

// Результат сдвига: успех или конфликты (ok: false - не сетевая ошибка)
type WalkShiftResult =
  | { ok: true; route_data: any[] }
  | { ok: false; conflicts: WalkShiftConflict[]; max_fit_end_minutes: number | null }
  | { ok: false; error: string };