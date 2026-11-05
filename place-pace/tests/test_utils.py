from datetime import datetime

import pytest

from backend.utils import haversine_m, iso_utc


def test_haversine_same_point():
    assert haversine_m(55.75, 37.62, 55.75, 37.62) == 0


def test_haversine_one_degree_of_longitude_at_equator():
    assert haversine_m(0, 0, 0, 1) == pytest.approx(111195, abs=100)


def test_haversine_is_symmetric():
    forward = haversine_m(55.7520, 37.6175, 55.7414, 37.6200)
    assert forward == pytest.approx(haversine_m(55.7414, 37.6200, 55.7520, 37.6175))
    assert 1000 < forward < 1500


def test_iso_utc():
    assert iso_utc(datetime(2026, 1, 2, 3, 4, 5)) == '2026-01-02T03:04:05Z'
    assert iso_utc(None) is None
