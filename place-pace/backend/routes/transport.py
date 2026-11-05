"""Оптимизация маршрута и расчёт перегонов"""

from concurrent.futures import as_completed, ThreadPoolExecutor
import logging
from flask import current_app, jsonify, request
from ..extensions import osrm_service, yandex_taxi_service
from ..services.fare_service import compute_transit_fare, TRANSIT_FARE_RUB
from ..services.optimization_service import OptimizationService
from ..services.schedule_service import ScheduleService
from ..services.travel_matrix import (
    compute_auto_matrix,
    describe_legs,
    FERRY_FARE_WEEKDAY_RUB,
    FERRY_FARE_WEEKEND_RUB,
    ferry_leg_estimate,
    find_ferry_candidate,
    get_cached_transit_route,
    taxi_fare_rub,
    taxi_mode_label,
    TRANSIT_DISTANCE_THRESHOLD_M,
    TRANSIT_MATRIX_MAX_WORKERS,
    weekend_and_hour,
)
from .auth import get_current_user
from .blueprint import api_bp

logger = logging.getLogger(__name__)


@api_bp.route('/optimize', methods=['POST'])
def optimize_route():
    try:
        data = request.json
        places = data.get('places', [])
        travel_matrix = data.get('travel_matrix', [])
        start_time = data.get('start_time')
        end_time = data.get('end_time')
        people_count = data.get('people_count', 1)
        date = data.get('date')
        start_place_index = data.get('start_place_index')
        end_place_index = data.get('end_place_index')
        # Время от адресных терминалов до каждого места (в порядке places)
        start_terminal_costs = data.get('start_terminal_costs')
        end_terminal_costs = data.get('end_terminal_costs')
        # Описание вида транспорта по перегонам для расчёта тарифа
        travel_modes = data.get('travel_modes')
        start_terminal_modes = data.get('start_terminal_modes')
        end_terminal_modes = data.get('end_terminal_modes')
        # Собственная стоимость перегонов (такси, речной транспорт)
        travel_fares = data.get('travel_fares')
        start_terminal_fares = data.get('start_terminal_fares')
        end_terminal_fares = data.get('end_terminal_fares')
        # Короткий лимит для повторного прохода с фиксированным порядком
        time_limit_seconds = data.get('time_limit_seconds')
        if time_limit_seconds is not None:
            try:
                time_limit_seconds = max(1, min(10, int(time_limit_seconds)))
            except (TypeError, ValueError):
                time_limit_seconds = None
        # Пары мест, которые должны идти подряд, переводим в индексы
        force_edges = []
        force_edges_ids = data.get('force_edges') or []
        id_to_index = {p['id']: idx for idx, p in enumerate(places)}
        for pair in force_edges_ids:
            if not pair or len(pair) != 2:
                continue
            idx_a, idx_b = id_to_index.get(pair[0]), id_to_index.get(pair[1])
            if idx_a is not None and idx_b is not None:
                force_edges.append((idx_a, idx_b))

        if not places or len(places) == 0:
            return jsonify({'success': False, 'error': 'Нет выбранных мест'}), 400

        if not travel_matrix or len(travel_matrix) == 0:
            return jsonify({'success': False, 'error': 'Нет матрицы времени'}), 400

        if not start_time:
            return jsonify({'success': False, 'error': 'Не указано время начала'}), 400

        # Проверка расписаний
        schedule_result = ScheduleService.check_schedules(places, date)

        if schedule_result['excluded_places']:
            return jsonify({
                'success': False,
                'error': 'Некоторые места закрыты в выбранную дату',
                'excluded_places': [p['name'] for p in schedule_result['excluded_places']],
                'warnings': schedule_result['warnings']
            }), 400

        # Оптимизация
        optimizer = OptimizationService()
        result = optimizer.optimize_route(
            places=schedule_result['valid_places'],
            travel_matrix=travel_matrix,
            start_time=start_time,
            end_time=end_time,
            start_place_index=start_place_index,
            end_place_index=end_place_index,
            start_terminal_costs=start_terminal_costs,
            end_terminal_costs=end_terminal_costs,
            force_edges=force_edges,
            time_limit_seconds=time_limit_seconds
        )

        if result is None:
            return jsonify({
                'success': False,
                'error': 'Не удалось найти оптимальный маршрут. Попробуйте изменить параметры.'
            }), 400

        if 'error' in result:
            response = {'success': False, 'error': result['error']}
            if 'suggested_start_time' in result:
                response['suggested_start_time'] = result['suggested_start_time']
            return jsonify(response), 400

        fare = compute_transit_fare(
            result['order'], result['schedule'], schedule_result['valid_places'], travel_modes,
            start_terminal_modes=start_terminal_modes, end_terminal_modes=end_terminal_modes,
            start_time=start_time, travel_fares=travel_fares,
            start_terminal_fares=start_terminal_fares, end_terminal_fares=end_terminal_fares,
            people_count=people_count,
        )
        per_person_cost = result['total_cost'] + fare['total']

        # Возвращаем результат БЕЗ дополнительных проверок
        return jsonify({
            'success': True,
            'order': result['order'],
            'schedule': result['schedule'],
            'total_time': result['total_time'],
            'total_cost': per_person_cost * people_count,
            'per_person_cost': per_person_cost,
            'people_count': people_count,
            # Разбивка тарифа по перегонам
            'transit_leg_fares': fare['legs'],
            'transit_start_terminal_fare': fare['start_terminal'],
            'transit_end_terminal_fare': fare['end_terminal'],
            'warnings': schedule_result['warnings'],
            # Места с праздничным предупреждением 2GIS
            'holiday_places': schedule_result['holiday_places']
        }), 200

    except Exception as e:
        logger.error(f"Ошибка оптимизации: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500


@api_bp.route('/matrix', methods=['POST'])
def get_matrix():
    """Получение матрицы расстояний через OSRM"""
    try:
        data = request.json
        coords = data.get('coords', [])
        mode = data.get('mode', 'foot')

        if not coords or len(coords) < 2:
            return jsonify({'error': 'Нужно минимум 2 точки'}), 400

        coord_tuples = [(lat, lon) for lat, lon in coords]

        if mode == 'auto':
            # Тумблеры режима передвижения (по умолчанию всё выключено)
            options = data.get('options') or {}
            user = get_current_user()
            durations, distances, modes, legs, fares, ferry_forced_pair = compute_auto_matrix(
                coord_tuples, date=data.get('date'), time_str=data.get('time'), options=options,
                walk_distance_limit_m=user.walk_distance_limit_m if user else None)
            return jsonify({
                'durations': durations,
                'distances': distances,
                'modes': modes,
                'legs': legs,
                'fares': fares,
                'ferry_forced_pair': ferry_forced_pair,
            }), 200

        durations, distances = osrm_service.get_travel_matrix(coord_tuples, mode)

        return jsonify({
            'durations': durations,
            'distances': distances
        }), 200

    except Exception as e:
        logger.error(f"Ошибка получения матрицы: {str(e)}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/matrix/legs', methods=['POST'])
def get_legs_at_times():
    """Перегоны (пешком/транспорт) на время отправления каждого из них"""
    try:
        data = request.json or {}
        legs_in = data.get('legs') or []
        if not legs_in or len(legs_in) > 60:
            return jsonify({'error': 'Нужно от 1 до 60 перегонов'}), 400
        # Такси и речной транспорт от времени не зависят
        options = {**(data.get('options') or {}), 'taxi': False, 'include_ferry': False}
        user = get_current_user()
        walk_limit = user.walk_distance_limit_m if user else None
        app = current_app._get_current_object()

        def _one(leg):
            try:
                with app.app_context():
                    durations, _distances, modes, legs, _fares, _ferry = compute_auto_matrix(
                        [(leg['from'][0], leg['from'][1]), (leg['to'][0], leg['to'][1])],
                        date=leg.get('date'), time_str=leg.get('time'), options=options,
                        walk_distance_limit_m=walk_limit)
                return {'duration_seconds': durations[0][1], 'mode': modes[0][1], 'legs': legs[0][1]}
            except Exception as e:
                logger.warning(f"Не удалось пересчитать перегон {leg}: {e}")
                return None

        with ThreadPoolExecutor(max_workers=min(TRANSIT_MATRIX_MAX_WORKERS, len(legs_in))) as executor:
            results = list(executor.map(_one, legs_in))
        return jsonify({'results': results}), 200
    except Exception as e:
        logger.error(f"Ошибка пересчёта перегонов: {str(e)}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/transport-mode/ferry-feasible', methods=['POST'])
def ferry_feasible():
    """Проверка доступности тумблера «Речной транспорт»"""
    try:
        data = request.json or {}
        coords = data.get('coords', [])
        if len(coords) < 2:
            return jsonify({'feasible': False}), 200

        coord_tuples = [(lat, lon) for lat, lon in coords]
        walk_priority = bool(data.get('walk_priority'))
        # Прогулочный лимит текущего пользователя
        current_user_for_walk_limit = get_current_user()
        base_distance_m = current_user_for_walk_limit.walk_distance_limit_m if current_user_for_walk_limit else TRANSIT_DISTANCE_THRESHOLD_M
        durations, distances = osrm_service.get_travel_matrix(coord_tuples, 'foot')
        feasible = find_ferry_candidate(coord_tuples, durations, distances, walk_priority=walk_priority, base_distance_m=base_distance_m) is not None
        return jsonify({'feasible': feasible}), 200
    except Exception as e:
        logger.error(f"Ошибка проверки речного транспорта: {str(e)}")
        return jsonify({'feasible': False}), 200


@api_bp.route('/transport-mode/leg-options', methods=['POST'])
def transport_mode_leg_options():
    """Варианты передвижения между двумя точками для ручной настройки перегона"""
    try:
        data = request.json or {}
        origin = data.get('origin')
        dest = data.get('dest')
        if not origin or not dest or len(origin) != 2 or len(dest) != 2:
            return jsonify({'error': 'Нужны origin и dest ([lat, lon])'}), 400
        origin = (origin[0], origin[1])
        dest = (dest[0], dest[1])
        date = data.get('date')
        time_str = data.get('time')

        results = {}
        app = current_app._get_current_object()

        # mode_label в том же формате, что modes[i][j] автовыбора
        def _walk():
            durations, distances = osrm_service.get_travel_matrix([origin, dest], 'foot')
            return {
                'key': 'walk', 'duration_seconds': durations[0][1], 'distance_m': distances[0][1],
                'cost': 0, 'cost_approximate': False, 'legs': None, 'mode_label': 'пешком',
            }

        # Поездка на такси считается один раз для всех тарифов
        _taxi_ride = {}

        def _taxi_ride_once():
            if not _taxi_ride:
                durations, distances = osrm_service.get_travel_matrix([origin, dest], 'driving')
                _taxi_ride['seconds'] = durations[0][1]
                _taxi_ride['meters'] = distances[0][1] or 0
            return _taxi_ride

        def _taxi(tariff):
            ride = _taxi_ride_once()
            taxi_seconds = ride.get('seconds')
            if not taxi_seconds:
                return None
            taxi_meters = ride.get('meters', 0)
            # Цена Яндекс Go приоритетнее формулы
            trip_info = yandex_taxi_service.get_trip_info(origin[0], origin[1], dest[0], dest[1], tariff=tariff)
            if trip_info:
                cost, yandex_seconds = trip_info
                if yandex_seconds:
                    taxi_seconds = yandex_seconds
            else:
                cost = taxi_fare_rub(taxi_meters, taxi_seconds, tariff)
            return {
                'key': f'taxi_{tariff}', 'duration_seconds': taxi_seconds, 'distance_m': taxi_meters,
                'cost': cost, 'cost_approximate': trip_info is None, 'legs': None,
                'mode_label': taxi_mode_label(tariff), 'tariff': tariff,
            }

        def _ferry():
            estimate = ferry_leg_estimate(origin, dest)
            if not estimate:
                return None
            ferry_seconds, ferry_description, ferry_legs = estimate
            is_weekend, _ = weekend_and_hour(date, None)
            return {
                'key': 'ferry', 'duration_seconds': ferry_seconds, 'distance_m': None,
                'cost': FERRY_FARE_WEEKEND_RUB if is_weekend else FERRY_FARE_WEEKDAY_RUB,
                'cost_approximate': False, 'legs': ferry_legs, 'description': ferry_description,
                'mode_label': ferry_description,
            }

        def _family(key, family):
            with app.app_context():
                route = get_cached_transit_route(origin, dest, date=date, time_str=time_str,
                                                   allowed_families={family})
            if not route:
                return None
            return {
                'key': key, 'duration_seconds': route['duration_seconds'], 'distance_m': None,
                'cost': TRANSIT_FARE_RUB, 'cost_approximate': False, 'legs': route['legs'],
                'mode_label': describe_legs(route['legs']),
            }

        # Запросы выполняются параллельно, тарифы такси считаются после
        jobs = {
            'walk': _walk,
            'ferry': _ferry,
            'metro': lambda: _family('metro', 'metro'),
            'mcd': lambda: _family('mcd', 'mcd'),
            'bus': lambda: _family('bus', 'bus'),
            'tram': lambda: _family('tram', 'tram'),
            'taxi_ride': _taxi_ride_once,
        }
        with ThreadPoolExecutor(max_workers=len(jobs)) as executor:
            futures = {executor.submit(fn): key for key, fn in jobs.items()}
            for future in as_completed(futures):
                results[futures[future]] = future.result()
        for tariff in ('economy', 'comfort', 'business'):
            results[f'taxi_{tariff}'] = _taxi(tariff)

        # Фиксированный порядок вариантов
        key_order = ('walk', 'metro', 'mcd', 'bus', 'tram', 'taxi_economy', 'taxi_comfort', 'taxi_business', 'ferry')
        options = [results[key] for key in key_order if results.get(key)]
        return jsonify({'options': options}), 200
    except Exception as e:
        logger.error(f"Ошибка получения вариантов перегона: {str(e)}")
        return jsonify({'error': str(e)}), 500
