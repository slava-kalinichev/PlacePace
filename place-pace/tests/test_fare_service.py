from backend.services.fare_service import TRANSIT_FARE_RUB, compute_transit_fare

PLACES = [{'id': 1}, {'id': 2}, {'id': 3}]


def _schedule(*departures):
    return [{'place_id': i + 1, 'departure': d} for i, d in enumerate(departures)]


def _modes(first, second):
    return [[None, first, None], [None, None, second], [None, None, None]]


def test_empty_order():
    result = compute_transit_fare([], [], PLACES, [])
    assert result['total'] == 0 and result['legs'] == []


def test_walking_is_free():
    result = compute_transit_fare([1, 2], _schedule('10:00', '11:00'), PLACES, _modes('пешком', None))
    assert result['total'] == 0


def test_transfer_within_window_is_free():
    result = compute_transit_fare([1, 2, 3], _schedule('10:00', '10:30', '11:00'), PLACES, _modes('Метро', 'Автобус 12'))
    assert result['legs'][:2] == [TRANSIT_FARE_RUB, 0]
    assert result['total'] == TRANSIT_FARE_RUB


def test_transfer_exactly_at_window_edge_is_free():
    result = compute_transit_fare([1, 2, 3], _schedule('10:00', '11:30', '12:00'), PLACES, _modes('Метро', 'Метро'))
    assert result['total'] == TRANSIT_FARE_RUB


def test_new_fare_after_window():
    result = compute_transit_fare([1, 2, 3], _schedule('10:00', '11:31', '12:00'), PLACES, _modes('Метро', 'Метро'))
    assert result['total'] == 2 * TRANSIT_FARE_RUB


def test_taxi_fare_split_between_people():
    fares = [[None, 400, None], [None, None, None], [None, None, None]]
    modes = _modes('Такси Эконом', None)
    solo = compute_transit_fare([1, 2], _schedule('10:00', '11:00'), PLACES, modes, travel_fares=fares)
    group = compute_transit_fare([1, 2], _schedule('10:00', '11:00'), PLACES, modes, travel_fares=fares, people_count=5)
    assert solo['total'] == 400
    assert group['total'] == 2 * 400 / 5


def test_ferry_uses_precomputed_fare():
    fares = [[None, 200, None], [None, None, None], [None, None, None]]
    result = compute_transit_fare([1, 2], _schedule('10:00', '11:00'), PLACES, _modes('Речной транспорт', None), travel_fares=fares)
    assert result['total'] == 200


def test_terminal_legs_are_charged():
    result = compute_transit_fare(
        [1, 2], _schedule('10:00', '11:00'), PLACES, _modes('пешком', None),
        start_terminal_modes=['Метро', None, None], end_terminal_modes=[None, 'Метро', None],
        start_time='09:30')
    assert result['start_terminal'] == TRANSIT_FARE_RUB
    assert result['end_terminal'] == 0
    assert result['total'] == TRANSIT_FARE_RUB
