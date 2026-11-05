"""Тариф «Тройки» и стоимость маршрута по итоговому порядку"""

import math

from .time_windows import time_to_minutes


# Тариф "Тройки": 75 ₽ за поездку, пересадки бесплатны в течение 90 минут
TRANSIT_FARE_RUB = 75


TRANSIT_FREE_TRANSFER_MINUTES = 90


def compute_transit_fare(order, schedule, places, travel_modes,
                           start_terminal_modes=None, end_terminal_modes=None, start_time=None,
                           travel_fares=None, start_terminal_fares=None, end_terminal_fares=None,
                           people_count=1):
    """Тариф «Тройки» по итоговому маршруту (после оптимизации)"""
    leg_fares = [0] * max(len(order) - 1, 0)
    start_terminal_fare = 0
    end_terminal_fare = 0
    if not order:
        return {'total': 0, 'legs': leg_fares, 'start_terminal': 0, 'end_terminal': 0}

    id_to_index = {p['id']: idx for idx, p in enumerate(places)}
    departures = {item['place_id']: item['departure'] for item in schedule}
    group_divisor = max(people_count, 1)

    total = 0
    last_paid_minutes = None

    def _charge_leg(mode, precomputed_fare, boarding_minutes):
        nonlocal total, last_paid_minutes
        if not mode or mode == 'пешком':
            return 0
        if mode.startswith('Такси'):
            if not precomputed_fare:
                return 0
            group_fare = precomputed_fare * math.ceil(group_divisor / 4)
            per_person = group_fare / group_divisor
            total += per_person
            return per_person
        if mode.startswith('Речной транспорт'):
            fare = precomputed_fare or 0
            total += fare
            return fare
        # Обычный городской транспорт - тариф "Тройки" с окном пересадок
        if last_paid_minutes is None or boarding_minutes - last_paid_minutes > TRANSIT_FREE_TRANSFER_MINUTES:
            total += TRANSIT_FARE_RUB
            last_paid_minutes = boarding_minutes
            return TRANSIT_FARE_RUB
        return 0

    if start_terminal_modes:
        first_index = id_to_index.get(order[0])
        if first_index is not None and first_index < len(start_terminal_modes):
            mode = start_terminal_modes[first_index]
            fare = start_terminal_fares[first_index] if start_terminal_fares and first_index < len(start_terminal_fares) else None
            start_terminal_fare = _charge_leg(mode, fare, time_to_minutes(start_time))

    for k, (place_id, next_place_id) in enumerate(zip(order, order[1:])):
        i, j = id_to_index.get(place_id), id_to_index.get(next_place_id)
        mode, fare = None, None
        if i is not None and j is not None:
            try:
                mode = travel_modes[i][j]
                fare = travel_fares[i][j] if travel_fares else None
            except (IndexError, TypeError):
                mode = None
        leg_fares[k] = _charge_leg(mode, fare, time_to_minutes(departures.get(place_id)))

    if end_terminal_modes:
        last_index = id_to_index.get(order[-1])
        if last_index is not None and last_index < len(end_terminal_modes):
            mode = end_terminal_modes[last_index]
            fare = end_terminal_fares[last_index] if end_terminal_fares and last_index < len(end_terminal_fares) else None
            end_terminal_fare = _charge_leg(mode, fare, time_to_minutes(departures.get(order[-1])))

    return {'total': total, 'legs': leg_fares, 'start_terminal': start_terminal_fare, 'end_terminal': end_terminal_fare}
