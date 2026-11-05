# Каскадный сдвиг времени при прохождении маршрута (серверная версия routeTimeShift.ts)
import math

from .time_windows import time_to_minutes, parse_work_time, fits_within_window

# Плейсхолдеры "времени нет": их не сдвигаем
_REAL_TIME_PLACEHOLDERS = ('-', '--:--')

# Типы точек с часами работы
_STOP_TYPES = ('attraction', 'food')


def _is_real_time(value):
    return isinstance(value, str) and value not in _REAL_TIME_PLACEHOLDERS


def _minutes_to_time(minutes):
    """Минуты в 'HH:MM' без заворота за полночь"""
    minutes = round(minutes)
    hours = minutes // 60
    mins = minutes % 60
    return f"{hours:02d}:{mins:02d}"


def _shift_field(value, delta):
    if not _is_real_time(value):
        return value
    return _minutes_to_time(time_to_minutes(value) + delta)


def _find_index(route_data, stop_item_id):
    for i, item in enumerate(route_data):
        if item.get('id') == stop_item_id:
            return i
    return None


def _uniform_shift(route_data, idx, new_start_minutes, new_end_minutes):
    """Равномерный сдвиг: отредактированная точка меняется напрямую, остальные смещаются на одну delta"""
    old_end = time_to_minutes(route_data[idx].get('endTime'))
    delta = new_end_minutes - old_end

    shifted = []
    for i, item in enumerate(route_data):
        if i < idx:
            shifted.append(item)
            continue
        if i == idx:
            edited = dict(item)
            edited['time'] = _minutes_to_time(new_start_minutes)
            edited['endTime'] = _minutes_to_time(new_end_minutes)
            # Длительность считается из фактических значений
            edited['duration'] = new_end_minutes - new_start_minutes
            shifted.append(edited)
            continue
        if delta == 0:
            shifted.append(item)
            continue
        moved = dict(item)
        moved['time'] = _shift_field(item.get('time'), delta)
        moved['endTime'] = _shift_field(item.get('endTime'), delta)
        shifted.append(moved)
    return shifted


def _find_conflicts(shifted, idx):
    """Все точки ниже по маршруту, чьё новое окно выходит за часы работы"""
    conflicts = []
    for i in range(idx + 1, len(shifted)):
        item = shifted[i]
        if item.get('type') not in _STOP_TYPES:
            continue
        arrival = time_to_minutes(item.get('time'))
        departure = time_to_minutes(item.get('endTime'))
        work_time = item.get('workTime')
        if fits_within_window(work_time, arrival, departure):
            continue

        open_m, close_m = parse_work_time(work_time)
        name = item.get('name')
        if arrival < open_m:
            reason = (
                f"«{name}» открывается в {_minutes_to_time(open_m)}, "
                f"а по новому времени вы будете там уже в {item.get('time')}"
            )
        else:
            reason = (
                f"«{name}» закрывается в {_minutes_to_time(close_m)}, "
                f"а по новому времени вы будете там до {item.get('endTime')}"
            )
        conflicts.append({'item_id': item.get('id'), 'name': name, 'reason': reason})
    return conflicts


def _max_shift_delta(route_data, idx):
    """Максимальная delta, при которой все следующие точки успевают до закрытия"""
    upper = None
    for i in range(idx + 1, len(route_data)):
        item = route_data[i]
        if item.get('type') not in _STOP_TYPES:
            continue
        departure = time_to_minutes(item.get('endTime'))
        _open_m, close_m = parse_work_time(item.get('workTime'))
        stop_upper = close_m - departure
        upper = stop_upper if upper is None else min(upper, stop_upper)
    return upper


def _absorb_early_arrivals(route_data, shifted, idx):
    """Точки, куда придём до открытия: ждём открытия и поглощаем сдвиг"""
    for i in range(idx + 1, len(shifted)):
        item = shifted[i]
        if item.get('type') not in _STOP_TYPES:
            continue
        arrival = time_to_minutes(item.get('time'))
        open_m, _close_m = parse_work_time(item.get('workTime'))
        if arrival >= open_m:
            continue
        return shifted[:i] + route_data[i:]
    return shifted


def _build_removal_set(route_data, exclude_ids):
    """Индексы для удаления: исключаемая точка и соседние транспортные плечи"""
    exclude_ids = set(exclude_ids or [])
    excluded_stop_indices = {
        i for i, item in enumerate(route_data)
        if item.get('type') in _STOP_TYPES and item.get('id') in exclude_ids
    }
    removal = set()
    for i in excluded_stop_indices:
        removal.add(i)
        if i - 1 >= 0 and route_data[i - 1].get('type') == 'transport':
            removal.add(i - 1)
        if i + 1 < len(route_data) and route_data[i + 1].get('type') == 'transport':
            removal.add(i + 1)
    return removal


def _build_bridging_leg(before_item, after_item, travel_matrix_fn):
    """Новое плечо между точками до и после исключённого участка (живой запрос матрицы)"""
    coords = [
        (before_item.get('latitude'), before_item.get('longitude')),
        (after_item.get('latitude'), after_item.get('longitude')),
    ]
    durations, distances = travel_matrix_fn(coords, 'foot')
    # Секунды OSRM округляются вверх до минут (как в mapService.ts)
    travel_minutes = math.ceil((durations[0][1] or 0) / 60)
    distance_m = distances[0][1] or 0

    # Для 'start'/'end' в fromPlace/toPlace идёт служебное слово, адрес передаётся отдельно
    from_is_terminal = before_item.get('type') == 'start'
    to_is_terminal = after_item.get('type') == 'end'
    from_place = 'Старт' if from_is_terminal else before_item.get('name')
    to_place = 'Финиш' if to_is_terminal else after_item.get('name')
    from_override = before_item.get('rawAddressLabel') if from_is_terminal else None
    to_override = after_item.get('rawAddressLabel') if to_is_terminal else None

    return {
        'id': f"transport_exclude_{before_item.get('id')}_{after_item.get('id')}",
        'name': 'Пешком',
        'type': 'transport',
        'icon': 'walk',
        'time': None,
        'endTime': None,
        'cost': 0,
        'isUserDefined': False,
        'distance': distance_m,
        'travelTime': travel_minutes,
        'rawTravelMode': 'пешком',
        'fromPlace': from_place,
        'toPlace': to_place,
        'fromAddressOverride': from_override,
        'toAddressOverride': to_override,
        'fromId': before_item.get('id'),
        'toId': after_item.get('id'),
        'fromCoords': {'lat': before_item.get('latitude'), 'lon': before_item.get('longitude')},
        'toCoords': {'lat': after_item.get('latitude'), 'lon': after_item.get('longitude')},
    }


def _recompute_sequential(route_data, start_index, start_minutes):
    """Пересчёт времени вперёд от start_index по travelTime и duration"""
    current = start_minutes
    out = list(route_data[:start_index])
    for i in range(start_index, len(route_data)):
        item = route_data[i]
        item_type = item.get('type')
        new_item = dict(item)
        if item_type == 'transport':
            new_item['time'] = _minutes_to_time(current)
            current += item.get('travelTime') or 0
            new_item['endTime'] = _minutes_to_time(current)
        elif item_type in _STOP_TYPES:
            new_item['time'] = _minutes_to_time(current)
            current += item.get('duration') or 0
            new_item['endTime'] = _minutes_to_time(current)
        elif item_type == 'end':
            new_item['time'] = _minutes_to_time(current)
            # У 'end' endTime - плейсхолдер, не трогаем
        out.append(new_item)
    return out


def _terminal_mirrors_stop(terminal_item, stop_item):
    """'end' совпадает по координатам с точкой: финиш «зеркалит» последнюю точку"""
    if stop_item is None:
        return False
    t_lat, t_lon = terminal_item.get('latitude'), terminal_item.get('longitude')
    s_lat, s_lon = stop_item.get('latitude'), stop_item.get('longitude')
    if t_lat is None or t_lon is None or s_lat is None or s_lon is None:
        return False
    return abs(t_lat - s_lat) < 1e-9 and abs(t_lon - s_lon) < 1e-9


def _move_mirrored_end(end_item, new_last_item):
    """Переносит 'end' на новую последнюю точку"""
    updated = dict(end_item)
    updated['latitude'] = new_last_item.get('latitude')
    updated['longitude'] = new_last_item.get('longitude')
    new_raw_label = new_last_item.get('address') or 'последняя точка'
    updated['rawAddressLabel'] = new_raw_label
    updated['name'] = f"Финиш ({new_raw_label})"
    return updated


def _apply_exclusion(route_data, exclude_ids, travel_matrix_fn):
    """Вырезает исключённые точки, добавляет мостовые плечи и пересчитывает расписание"""
    removal = _build_removal_set(route_data, exclude_ids)
    if not removal:
        return list(route_data)

    # Зеркалирует ли финиш последнюю точку (по исходному маршруту)
    end_mirrors_last = _terminal_mirrors_stop(
        route_data[-1],
        next((item for item in reversed(route_data) if item.get('type') in _STOP_TYPES), None),
    )

    result = []
    i = 0
    n = len(route_data)
    resume_from = None  # первая позиция в result, которую нужно honest-но пересчитать
    while i < n:
        if i not in removal:
            result.append(route_data[i])
            i += 1
            continue

        # anchor_before всегда существует и не входит в удаляемый блок
        anchor_before = result[-1]
        j = i
        while j < n and j in removal:
            j += 1
        # route_data[j] существует всегда - 'end' тоже никогда не исключается
        anchor_after = route_data[j]

        # Если за исключённой точкой шёл зеркальный финиш, переносим финиш без мостового плеча
        if anchor_after.get('type') == 'end' and end_mirrors_last \
                and anchor_before.get('type') in _STOP_TYPES:
            anchor_after = _move_mirrored_end(anchor_after, anchor_before)
            if resume_from is None:
                resume_from = len(result)
            result.append(anchor_after)
            i = j + 1
            continue

        bridging_leg = _build_bridging_leg(anchor_before, anchor_after, travel_matrix_fn)
        if resume_from is None:
            resume_from = len(result)
        result.append(bridging_leg)
        result.append(anchor_after)
        i = j + 1

    if resume_from is not None:
        start_minutes = time_to_minutes(result[resume_from - 1].get('endTime'))
        result = _recompute_sequential(result, resume_from, start_minutes)
    return result


def shift_stop_time(route_data, stop_item_id, new_start_minutes, new_end_minutes,
                     resolution=None, travel_matrix_fn=None):
    """Точка входа для POST /routes/<id>/walk/shift; resolution=None - пробный расчёт без применения"""
    idx = _find_index(route_data, stop_item_id)
    if idx is None:
        return {'ok': False, 'error': 'stop_not_found'}

    if resolution == 'cancel':
        return {'ok': True, 'route_data': route_data}

    if isinstance(resolution, dict) and 'exclude' in resolution:
        shifted = _uniform_shift(route_data, idx, new_start_minutes, new_end_minutes)
        shifted = _absorb_early_arrivals(route_data, shifted, idx)
        excluded_route = _apply_exclusion(shifted, resolution.get('exclude'), travel_matrix_fn)
        return {'ok': True, 'route_data': excluded_route}

    shifted = _uniform_shift(route_data, idx, new_start_minutes, new_end_minutes)
    shifted = _absorb_early_arrivals(route_data, shifted, idx)
    conflicts = _find_conflicts(shifted, idx)

    if resolution == 'auto_adjust' and conflicts:
        old_end = time_to_minutes(route_data[idx].get('endTime'))
        upper = _max_shift_delta(route_data, idx)
        adjusted_delta = new_end_minutes - old_end
        if upper is not None and adjusted_delta > upper:
            adjusted_delta = upper
        shifted = _uniform_shift(route_data, idx, new_start_minutes, old_end + adjusted_delta)
        shifted = _absorb_early_arrivals(route_data, shifted, idx)
        conflicts = _find_conflicts(shifted, idx)

    if conflicts:
        old_end = time_to_minutes(route_data[idx].get('endTime'))
        upper = _max_shift_delta(route_data, idx)
        max_fit_end_minutes = old_end + upper if upper is not None else None
        return {'ok': False, 'conflicts': conflicts, 'max_fit_end_minutes': max_fit_end_minutes}

    return {'ok': True, 'route_data': shifted}
