"""Представление маршрутов для зрителя: карточки, обрезка терминалов, доступ"""

import math

from flask import request

from . import translation_service
from ..models import Route, Star
from .image_service import cover_version


def build_popular_rank_map():
    """id -> 1/2/3 для трёх самых популярных маршрутов"""
    top = Route.query.filter(
        Route.is_public.is_(True), Route.stars_count > 0
    ).order_by(Route.stars_count.desc(), Route.id.asc()).limit(3).all()
    return {r.id: i + 1 for i, r in enumerate(top)}


def points_only_cost(route_data):
    """Стоимость точек посещения (билеты и средний чек) без транспорта"""
    return sum(
        item.get('cost', 0) or 0
        for item in (route_data or [])
        if item.get('type') in ('attraction', 'food')
    )


def adjust_taxi_costs_for_viewer(route_data, owner_people_count):
    """Пересчёт такси-строк с доли владельца на долю зрителя"""
    owner_people_count = max(1, owner_people_count or 1)
    if owner_people_count == 1:
        return route_data
    car_count = max(1, math.ceil(owner_people_count / 4))
    adjusted = []
    for item in (route_data or []):
        if item.get('costApproximate') and (item.get('cost') or 0) > 0:
            item = {**item, 'cost': item['cost'] * owner_people_count / car_count}
        adjusted.append(item)
    return adjusted


def _route_aggregates_fallback(route_data):
    """Запасной расчёт (длительность, стоимость) для пустых агрегатов"""
    if not route_data:
        return None, None
    agg = route_data_aggregates(route_data)
    return agg['duration'], agg['cost']


def viewer_lang():
    """Язык зрителя из заголовка X-Lang"""
    return 'en' if (request.headers.get('X-Lang') or '').lower().startswith('en') else 'ru'


def serialize_route_card(route, starred_ids, current_user, popular_rank_map):
    """Карточка маршрута для RouteBar (видимость зависит от зрителя и типа маршрута)"""
    is_owner = current_user is not None and route.user_id == current_user.id
    viewer_is_admin = current_user is not None and current_user.is_admin
    cost_excludes_transport = False

    if route.is_recommended:
        if viewer_is_admin or route.display_mode != 'points_only':
            # Живой пересчёт без терминалов (trim_terminals)
            full_data = trim_terminals(route.route_data or [])
            agg = route_data_aggregates(full_data)
            duration, cost, people = agg['duration'], agg['cost'], route.people_count
        else:
            duration, cost, people = None, points_only_cost(route.route_data), route.people_count
            cost_excludes_transport = True
        stars = None
    elif is_owner:
        duration, cost, people = route.total_duration, route.total_cost, route.people_count
        if duration is None or cost is None:
            fallback_duration, fallback_cost = _route_aggregates_fallback(route.route_data)
            duration = fallback_duration if duration is None else duration
            cost = fallback_cost if cost is None else cost
        stars = (route.stars_count or 0) if route.is_public else None
    elif route.display_mode != 'points_only':
        # Пересчёт по текущей настройке приватных терминалов владельца
        private_terminal_enabled = route.user.private_terminal_enabled if route.user else True
        full_data = adjust_taxi_costs_for_viewer(route.route_data or [], route.people_count)
        trimmed = trim_terminals(full_data) if private_terminal_enabled else full_data
        agg = route_data_aggregates(trimmed)
        duration, cost, people = agg['duration'], agg['cost'], 1
        stars = (route.stars_count or 0) if route.is_public else None
    else:
        duration, cost, people = None, points_only_cost(route.route_data), 1
        cost_excludes_transport = True
        stars = (route.stars_count or 0) if route.is_public else None

    # Считаем только точки посещения, без точек питания
    points = sum(
        1 for item in (route.route_data or [])
        if item.get('type') == 'attraction'
    )

    title, description = translation_service.localized_texts(route, viewer_lang())

    return {
        'id': route.id,
        'title': title,
        'description': description,
        'points': points,
        'duration': duration,
        'cost_per_person': cost,
        'people_count': people,
        'stars_count': stars,
        'is_favorite': route.id in starred_ids,
        # Обложка отдаётся отдельным URL /routes/<id>/cover
        'image': None,
        'image_version': cover_version(route.cover_image),
        'is_owner': is_owner,
        'is_public': route.is_public,
        'is_recommended': route.is_recommended,
        'display_mode': route.display_mode,
        'cost_excludes_transport': cost_excludes_transport,
        'admin_username': (route.user.username if route.is_recommended and viewer_is_admin and route.user else None),
        'popular_rank': popular_rank_map.get(route.id),
    }


def mine_routes(user):
    """«Мои»: сначала созданные пользователем (кроме рекомендованных), затем избранные"""
    if not user:
        return [], []

    created = Route.query.filter(
        Route.user_id == user.id, Route.is_recommended.is_(False)
    ).order_by(Route.created_at.desc()).all()
    created_ids = {r.id for r in created}

    starred = Star.query.filter_by(user_id=user.id) \
        .order_by(Star.created_at.desc()).all()
    routes_by_id = {
        r.id: r for r in Route.query.filter(
            Route.id.in_([s.route_id for s in starred])
        ).all()
    } if starred else {}
    # Порядок избранного сохраняем явно
    favorited = [
        routes_by_id[s.route_id] for s in starred
        if s.route_id in routes_by_id and s.route_id not in created_ids
    ]

    return created, favorited


def trim_terminals(route_data):
    """Для не-владельца заменяет терминалы синтетическими Старт/Финиш"""
    if not route_data:
        return route_data

    data = list(route_data)

    if data[0].get('type') == 'start' and data[0].get('icon') == 'home':
        cut = 2 if len(data) > 1 and data[1].get('id') == 'transport_start_terminal' else 1
        first_point = data[cut] if cut < len(data) else None
        synthetic = dict(data[0])
        synthetic['icon'] = 'start'
        if first_point:
            # Время старта пересчитывается с учётом обрезанного плеча
            synthetic['name'] = f"Старт ({first_point.get('address') or 'первая точка'})"
            synthetic['address'] = 'Согласовано с первой точкой'
            synthetic['time'] = first_point.get('time') or synthetic.get('time')
        else:
            synthetic['name'] = 'Старт'
        data = [synthetic] + data[cut:]

    if data[-1].get('type') == 'end' and data[-1].get('icon') == 'home':
        cut = 2 if len(data) > 1 and data[-2].get('id') == 'transport_end_terminal' else 1
        last_point = data[-cut - 1] if len(data) > cut else None
        synthetic = dict(data[-1])
        synthetic['icon'] = 'finish'
        if last_point:
            # Время финиша пересчитывается с учётом обрезанного плеча
            synthetic['name'] = f"Финиш ({last_point.get('address') or 'последняя точка'})"
            synthetic['address'] = 'Согласовано с последней точкой'
            synthetic['time'] = last_point.get('endTime') or synthetic.get('time')
        else:
            synthetic['name'] = 'Финиш'
        data = data[:len(data) - cut] + [synthetic]

    return data


def has_route_access(route, user):
    """Права создателя: владелец или любой админ для рекомендованных"""
    if user is None:
        return False
    if route.user_id == user.id:
        return True
    return route.is_recommended and user.is_admin


def route_data_aggregates(route_data):
    """Время и стоимость маршрута по route_data"""
    if not route_data:
        return {'duration': 0, 'cost': 0}

    def _to_minutes(t):
        try:
            h, m = (t or '00:00').split(':')
            return int(h) * 60 + int(m)
        except (ValueError, AttributeError):
            return 0

    duration = _to_minutes(route_data[-1].get('time')) - _to_minutes(route_data[0].get('time'))
    if duration < 0:
        duration += 1440
    # round убирает погрешность float
    cost = round(sum(item.get('cost', 0) or 0 for item in route_data))
    return {'duration': duration, 'cost': cost}
