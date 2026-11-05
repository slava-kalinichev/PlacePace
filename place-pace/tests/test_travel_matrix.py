import pytest

from backend.services import travel_matrix as tm


@pytest.mark.parametrize('tariff, expected', [
    ('economy', 335),
    ('comfort', 473),
    ('business', 824),
    ('unknown', 335),
])
def test_taxi_fare_for_5_km_15_min(tariff, expected):
    assert tm.taxi_fare_rub(5000, 15 * 60, tariff) == expected


def test_taxi_fare_inside_free_zone_is_base_price():
    assert tm.taxi_fare_rub(1000, 3 * 60) == tm.TAXI_TARIFFS['economy']['base']


def test_taxi_mode_label():
    assert tm.taxi_mode_label('comfort') == 'Такси Комфорт'
    assert tm.taxi_mode_label('unknown') == 'Такси Эконом'


def test_weekend_and_hour():
    assert tm.weekend_and_hour('2026-11-07', '14:30') == (True, 14)
    assert tm.weekend_and_hour('2026-11-09', '9:00') == (False, 9)


def test_weekend_and_hour_bad_input_does_not_raise():
    is_weekend, hour = tm.weekend_and_hour('не дата', 'не время')
    assert isinstance(is_weekend, bool) and 0 <= hour <= 23


def test_transit_cache_key_rounds_coordinates():
    key = tm._transit_cache_key((55.7520001, 37.6175001), (55.74, 37.62), True, 15)
    assert key == '55.75200,37.61750|55.74000,37.62000|we|15'
    assert tm._transit_cache_key((1, 2), (3, 4), False, 9, mode='metro').endswith('|wd|9|metro')


def test_describe_legs():
    legs = [
        {'mode': 'WALK'},
        {'mode': 'SUBWAY', 'from': 'Охотный ряд', 'to': 'Парк культуры'},
        {'mode': 'BUS', 'route': '15', 'from': 'А', 'to': 'Б'},
    ]
    assert tm.describe_legs(legs) == 'Метро (Охотный ряд - Парк культуры) → Автобус 15 (А - Б)'


def test_describe_legs_walk_only():
    assert tm.describe_legs([{'mode': 'WALK'}]) == 'пешком'


@pytest.mark.parametrize('distance, walk_seconds, priority, expected', [
    (900, None, False, True),
    (500, 600, False, False),
    (500, 900, False, True),
    (1500, 600, True, False),
    (2400, None, True, True),
])
def test_qualifies_for_transit(distance, walk_seconds, priority, expected):
    assert tm._qualifies_for_transit(distance, walk_seconds, walk_priority=priority) is expected
