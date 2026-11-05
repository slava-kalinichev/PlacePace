"""Матрица перегонов: пешком, транспорт, такси, речной транспорт"""

from concurrent.futures import as_completed, ThreadPoolExecutor
from datetime import datetime, timedelta
import json
import os

from flask import current_app
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..extensions import osrm_service, transit_service, yandex_taxi_service
from ..models import db, TransitCacheEntry
from ..utils import haversine_m
from .transit_service import leg_family


# Семейства транспорта для подписей маршрута
FAMILY_LABELS_RU = {
    'metro': 'Метро', 'mcd': 'МЦД', 'bus': 'Автобус', 'tram': 'Трамвай',
}


# Порог расстояния (м), ближе которого транспорт не проверяем; настраивается как "Прогулочный лимит"
TRANSIT_DISTANCE_THRESHOLD_M = 800


# Порог времени пешком (мин): альтернативный триггер проверки транспорта
TRANSIT_WALK_TIME_THRESHOLD_MIN = 15


def _walk_time_threshold_min(distance_threshold_m):
    """Лимит времени пропорционально лимиту расстояния"""
    return distance_threshold_m * TRANSIT_WALK_TIME_THRESHOLD_MIN / TRANSIT_DISTANCE_THRESHOLD_M


# Срок хранения кэша OTP
TRANSIT_CACHE_TTL = timedelta(days=14)


# Число потоков для запросов к OTP
TRANSIT_MATRIX_MAX_WORKERS = 16


_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')


def _load_data_json(filename):
    with open(os.path.join(_DATA_DIR, filename), encoding='utf-8') as f:
        return json.load(f)


# Пирсы и маршруты речного транспорта (координаты приблизительные)
RIVER_PIERS = _load_data_json('river_piers.json')


RIVER_ROUTES = _load_data_json('river_routes.json')


_PIER_BY_ID = {p['id']: p for p in RIVER_PIERS}


# Скорость пешехода, м/с
WALK_SPEED_MPS = 1.39


# Скорость электросуден, м/с (расписания в GTFS нет)
FERRY_SPEED_MPS = 5.14


# Время стоянки на каждом промежуточном причале, сек
FERRY_DWELL_SECONDS_PER_STOP = 90


# Максимальная дистанция пешком до причала, м
FERRY_PIER_WALK_RADIUS_M = 1000


FERRY_FARE_WEEKDAY_RUB = 200


FERRY_FARE_WEEKEND_RUB = 350


# Тарифы такси по Москве (подача включает бесплатные км и минуты)
TAXI_TARIFFS = {
    'economy': {'base': 170, 'per_km': 15, 'per_min': 12},
    'comfort': {'base': 250, 'per_km': 21, 'per_min': 16},
    'business': {'base': 450, 'per_km': 38, 'per_min': 26},
}


TAXI_FREE_KM = 2


TAXI_FREE_MIN = 5


TAXI_TARIFF_LABELS_RU = {'economy': 'Эконом', 'comfort': 'Комфорт', 'business': 'Бизнес'}


DEFAULT_TAXI_TARIFF = 'economy'


def describe_legs(legs):
    """Строка вида «Метро (А - Б) → Автобус 12 (Б - В)»"""
    parts = []
    for leg in legs:
        if leg['mode'] == 'WALK':
            continue
        family = leg_family(leg)
        label = FAMILY_LABELS_RU.get(family, (leg.get('mode') or '').capitalize())
        # Номер маршрута только у автобуса и трамвая
        if family in ('bus', 'tram') and leg.get('route'):
            label = f"{label} {leg['route']}"
        from_name, to_name = leg.get('from'), leg.get('to')
        if from_name and to_name:
            label = f"{label} ({from_name} - {to_name})"
        parts.append(label)
    return ' → '.join(parts) if parts else 'пешком'


def _transit_cache_key(origin, dest, is_weekend, hour, mode=None):
    # Координаты округляются до ~1 м; mode - пул семейств транспорта
    suffix = f"|{mode}" if mode else ""
    return (f"{origin[0]:.5f},{origin[1]:.5f}|{dest[0]:.5f},{dest[1]:.5f}"
            f"|{'we' if is_weekend else 'wd'}|{hour}{suffix}")


def weekend_and_hour(date_str, time_str):
    now = datetime.now()
    try:
        d = datetime.strptime(date_str, '%Y-%m-%d').date() if date_str else now.date()
    except ValueError:
        d = now.date()
    try:
        hour = int(time_str.split(':')[0]) if time_str else now.hour
    except (ValueError, IndexError):
        hour = now.hour
    return d.weekday() >= 5, hour


def _upsert_transit_cache(cache_key, route):
    values = dict(
        cache_key=cache_key,
        found=route is not None,
        duration_seconds=route['duration_seconds'] if route else None,
        legs=route['legs'] if route else None,
        updated_at=datetime.utcnow(),
    )
    stmt = pg_insert(TransitCacheEntry).values(**values).on_conflict_do_update(
        index_elements=['cache_key'], set_=values)
    db.session.execute(stmt)
    db.session.commit()


_ALL_TRANSIT_FAMILIES = frozenset({'metro', 'mcd', 'bus', 'tram'})


# Подрежимы общественного транспорта
PUBLIC_TRANSIT_SUBMODES = {
    'optimal': _ALL_TRANSIT_FAMILIES,
    'metro_only': frozenset({'metro'}),
    'surface_only': frozenset({'mcd', 'bus', 'tram'}),
}


DEFAULT_PUBLIC_TRANSIT_SUBMODE = 'optimal'


def _pool_cache_suffix(allowed_families, require_pure):
    # Пул "все семейства" сохраняет прежний ключ кэша
    if frozenset(allowed_families) == _ALL_TRANSIT_FAMILIES and not require_pure:
        return None
    return ','.join(sorted(allowed_families)) + ('+pure' if require_pure else '')


def get_cached_transit_route(origin, dest, date=None, time_str=None,
                               allowed_families=_ALL_TRANSIT_FAMILIES, require_pure=False):
    """Маршрут OTP с кэшем (TransitCacheEntry); при промахе - живой запрос"""
    is_weekend, hour = weekend_and_hour(date, time_str)
    cache_key = _transit_cache_key(origin, dest, is_weekend, hour,
                                    mode=_pool_cache_suffix(allowed_families, require_pure))

    try:
        entry = TransitCacheEntry.query.filter_by(cache_key=cache_key).first()
        # Закрываем транзакцию до сетевого запроса, чтобы не держать соединение
        db.session.commit()
    except Exception:
        db.session.rollback()
        entry = None

    if entry and (datetime.utcnow() - entry.updated_at) < TRANSIT_CACHE_TTL:
        return {'duration_seconds': entry.duration_seconds, 'legs': entry.legs} if entry.found else None

    route = transit_service.get_pool_route(
        origin, dest, allowed_families, require_pure=require_pure, date=date, time_str=time_str)
    # Сбой OTP не кэшируем как "транспорта нет"
    if route is None and transit_service.last_query_failed():
        return None
    try:
        _upsert_transit_cache(cache_key, route)
    except Exception:
        db.session.rollback()
    return route


def _nearest_pier(lat, lon, max_radius_m=FERRY_PIER_WALK_RADIUS_M):
    best, best_dist = None, max_radius_m
    for pier in RIVER_PIERS:
        d = haversine_m(lat, lon, pier['lat'], pier['lon'])
        if d <= best_dist:
            best, best_dist = pier, d
    return best, best_dist


def _ferry_route_for_piers(pier_id_a, pier_id_b):
    for route in RIVER_ROUTES:
        if pier_id_a in route['pier_ids'] and pier_id_b in route['pier_ids']:
            return route
    return None


def ferry_leg_estimate(origin, dest):
    """Оценка речного участка между точками или None"""
    pier_a, dist_a = _nearest_pier(*origin)
    if not pier_a:
        return None
    pier_b, dist_b = _nearest_pier(*dest)
    if not pier_b or pier_a['id'] == pier_b['id']:
        return None
    route = _ferry_route_for_piers(pier_a['id'], pier_b['id'])
    if not route:
        return None

    pids = route['pier_ids']
    idx_a, idx_b = pids.index(pier_a['id']), pids.index(pier_b['id'])
    segment = pids[min(idx_a, idx_b):max(idx_a, idx_b) + 1]
    ride_seconds = 0.0
    for k in range(len(segment) - 1):
        p1, p2 = _PIER_BY_ID[segment[k]], _PIER_BY_ID[segment[k + 1]]
        ride_seconds += haversine_m(p1['lat'], p1['lon'], p2['lat'], p2['lon']) / FERRY_SPEED_MPS
    # Промежуточные остановки на причалах
    intermediate_stops = max(0, len(segment) - 2)
    ride_seconds += intermediate_stops * FERRY_DWELL_SECONDS_PER_STOP

    walk_a_seconds = dist_a / WALK_SPEED_MPS
    walk_b_seconds = dist_b / WALK_SPEED_MPS
    total_seconds = walk_a_seconds + ride_seconds + walk_b_seconds
    description = f"Речной транспорт ({pier_a['name']} - {pier_b['name']})"
    leg_list = [
        {'mode': 'WALK', 'route': '', 'from': None, 'to': pier_a['name'], 'duration_s': walk_a_seconds},
        {'mode': 'FERRY', 'route': '', 'from': pier_a['name'], 'to': pier_b['name'], 'duration_s': ride_seconds},
        {'mode': 'WALK', 'route': '', 'from': pier_b['name'], 'to': None, 'duration_s': walk_b_seconds},
    ]
    return total_seconds, description, leg_list


# Прогулочный приоритет: пороги прогулок ×3
WALK_PRIORITY_MULTIPLIER = 3


def _qualifies_for_transit(distance_m, walk_seconds, walk_priority=False, base_distance_m=TRANSIT_DISTANCE_THRESHOLD_M):
    """Достаточно ли «далёкая» пара, чтобы проверять транспорт"""
    multiplier = WALK_PRIORITY_MULTIPLIER if walk_priority else 1
    distance_threshold = base_distance_m * multiplier
    if distance_m >= distance_threshold:
        return True
    time_threshold_min = _walk_time_threshold_min(base_distance_m) * multiplier
    if walk_seconds is not None and walk_seconds >= time_threshold_min * 60:
        return True
    return False


def find_ferry_candidate(coord_tuples, durations, distances, walk_priority=False, base_distance_m=TRANSIT_DISTANCE_THRESHOLD_M):
    """Первая пара, куда можно вставить речной транспорт"""
    n = len(coord_tuples)
    for i in range(n):
        for j in range(i + 1, n):
            if not _qualifies_for_transit(distances[i][j], durations[i][j], walk_priority=walk_priority, base_distance_m=base_distance_m):
                continue
            estimate = ferry_leg_estimate(coord_tuples[i], coord_tuples[j])
            if estimate:
                return i, j, estimate
    return None


def _apply_ferry_option(coord_tuples, durations, distances, modes, legs, fares, date, walk_priority=False, base_distance_m=TRANSIT_DISTANCE_THRESHOLD_M):
    """Опция «Речной транспорт»: подменяет только одну лучшую пару"""
    candidate = find_ferry_candidate(coord_tuples, durations, distances, walk_priority=walk_priority, base_distance_m=base_distance_m)
    if not candidate:
        return None
    i, j, _ = candidate

    is_weekend, _ = weekend_and_hour(date, None)
    fare = FERRY_FARE_WEEKEND_RUB if is_weekend else FERRY_FARE_WEEKDAY_RUB

    # Оба направления пересчитываем отдельно
    for a, b in ((i, j), (j, i)):
        estimate = ferry_leg_estimate(coord_tuples[a], coord_tuples[b])
        if not estimate:
            continue
        ferry_seconds, description, ferry_legs = estimate
        durations[a][b] = ferry_seconds
        modes[a][b] = description
        legs[a][b] = ferry_legs
        fares[a][b] = fare

    return i, j


def taxi_fare_rub(taxi_meters, taxi_seconds, tariff=DEFAULT_TAXI_TARIFF):
    """Стоимость такси для 1-4 человек по тарифу"""
    t = TAXI_TARIFFS.get(tariff, TAXI_TARIFFS[DEFAULT_TAXI_TARIFF])
    extra_km = max(0.0, taxi_meters / 1000 - TAXI_FREE_KM)
    extra_min = max(0.0, taxi_seconds / 60 - TAXI_FREE_MIN)
    return round(t['base'] + t['per_km'] * extra_km + t['per_min'] * extra_min)


def taxi_mode_label(tariff=DEFAULT_TAXI_TARIFF):
    """Подпись такси: «Такси Эконом/Комфорт/Бизнес»"""
    return f"Такси {TAXI_TARIFF_LABELS_RU.get(tariff, TAXI_TARIFF_LABELS_RU[DEFAULT_TAXI_TARIFF])}"


def _apply_taxi_compare(coord_tuples, durations, distances, modes, legs, fares, pairs, tariff=DEFAULT_TAXI_TARIFF):
    """Такси как кандидат в сравнении: подменяет перегон, если строго быстрее"""
    if not pairs:
        return

    taxi_durations, taxi_distances = osrm_service.get_travel_matrix(coord_tuples, 'driving')
    mode_label = taxi_mode_label(tariff)
    for i, j in pairs:
        taxi_seconds = taxi_durations[i][j]
        if not taxi_seconds or not durations[i][j] or taxi_seconds >= durations[i][j]:
            continue
        taxi_meters = taxi_distances[i][j] or 0

        trip_info = yandex_taxi_service.get_trip_info(
            coord_tuples[i][0], coord_tuples[i][1], coord_tuples[j][0], coord_tuples[j][1], tariff=tariff)
        if trip_info:
            fare_rub, yandex_seconds = trip_info
            if yandex_seconds:
                taxi_seconds = yandex_seconds
        else:
            fare_rub = taxi_fare_rub(taxi_meters, taxi_seconds, tariff)

        durations[i][j] = taxi_seconds
        distances[i][j] = taxi_meters
        modes[i][j] = mode_label
        legs[i][j] = None
        fares[i][j] = fare_rub


def compute_auto_matrix(coord_tuples, date=None, time_str=None, options=None, walk_distance_limit_m=None):
    """Матрица перегонов: пешком (OSRM) и транспорт (OTP), берётся минимум по паре"""
    options = options or {}
    public_transit = options.get('public_transit', True)
    submode = options.get('public_transit_submode', DEFAULT_PUBLIC_TRANSIT_SUBMODE)
    allowed_families = PUBLIC_TRANSIT_SUBMODES.get(submode, PUBLIC_TRANSIT_SUBMODES[DEFAULT_PUBLIC_TRANSIT_SUBMODE])
    taxi = options.get('taxi', False)
    taxi_tariff = options.get('taxi_tariff', DEFAULT_TAXI_TARIFF)
    walk_priority = bool(options.get('walk_priority'))
    no_composite = bool(options.get('no_composite'))
    # Индивидуальный "Прогулочный лимит" текущего пользователя
    base_distance_m = walk_distance_limit_m or TRANSIT_DISTANCE_THRESHOLD_M

    durations, distances = osrm_service.get_travel_matrix(coord_tuples, 'foot')
    n = len(coord_tuples)
    modes = [['пешком'] * n for _ in range(n)]
    legs = [[None] * n for _ in range(n)]
    fares = [[None] * n for _ in range(n)]
    ferry_forced_pair = None

    pairs = [(i, j) for i in range(n) for j in range(n)
             if i != j and _qualifies_for_transit(distances[i][j], durations[i][j], walk_priority=walk_priority, base_distance_m=base_distance_m)]

    if pairs and public_transit:
        app = current_app._get_current_object()

        def _fetch(i, j):
            # Потоку нужен свой app context
            with app.app_context():
                return i, j, get_cached_transit_route(
                    coord_tuples[i], coord_tuples[j], date, time_str,
                    allowed_families=allowed_families, require_pure=no_composite)

        with ThreadPoolExecutor(max_workers=min(TRANSIT_MATRIX_MAX_WORKERS, len(pairs))) as executor:
            futures = [executor.submit(_fetch, i, j) for i, j in pairs]
            for future in as_completed(futures):
                i, j, route = future.result()
                if not route:
                    continue
                transit_minutes = route['duration_seconds'] / 60
                walk_minutes = durations[i][j] / 60 if durations[i][j] else float('inf')
                if transit_minutes < walk_minutes:
                    durations[i][j] = route['duration_seconds']
                    modes[i][j] = describe_legs(route['legs'])
                    legs[i][j] = route['legs']

    if taxi:
        # Такси сравнивается всегда, а не только при включённом транспорте
        _apply_taxi_compare(coord_tuples, durations, distances, modes, legs, fares, pairs, tariff=taxi_tariff)

    if options.get('include_ferry'):
        ferry_forced_pair = _apply_ferry_option(coord_tuples, durations, distances, modes, legs, fares, date, walk_priority=walk_priority, base_distance_m=base_distance_m)

    return durations, distances, modes, legs, fares, ferry_forced_pair
