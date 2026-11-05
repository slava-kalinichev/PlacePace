import pytest

from backend.services.time_windows import fits_within_window, parse_work_time, time_to_minutes


@pytest.mark.parametrize('value, expected', [('09:30', 570), ('00:00', 0), ('24:00', 1440), ('', 0), (None, 0), ('abc', 0)])
def test_time_to_minutes(value, expected):
    assert time_to_minutes(value) == expected


@pytest.mark.parametrize('value, expected', [
    ('10:00-19:00', (600, 1140)),
    (' 09:00 - 21:30 ', (540, 1290)),
    ('Круглосуточно', (0, 1440)),
    ('-', (0, 1440)),
    ('', (0, 1440)),
    (None, (0, 1440)),
    ('по записи', (0, 1440)),
])
def test_parse_work_time(value, expected):
    assert parse_work_time(value) == expected


def test_fits_within_window():
    assert fits_within_window('10:00-18:00', 600, 1080)
    assert not fits_within_window('10:00-18:00', 599, 700)
    assert not fits_within_window('10:00-18:00', 900, 1081)
    assert fits_within_window('Круглосуточно', 0, 1440)
