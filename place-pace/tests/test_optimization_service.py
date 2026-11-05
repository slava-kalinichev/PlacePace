import pytest

from backend.services.optimization_service import OptimizationService


def _place(pid, work_time='10:00-20:00', duration=60, price=100):
    return {'id': pid, 'name': f'Место {pid}', 'work_time': work_time,
            'recommended_duration': duration, 'ticket_price': price}


def _matrix(n, minutes=10):
    return [[0 if i == j else minutes for j in range(n)] for i in range(n)]


@pytest.fixture
def optimizer():
    return OptimizationService()


def _optimize(optimizer, places, **kwargs):
    kwargs.setdefault('time_limit_seconds', 1)
    return optimizer.optimize_route(places, _matrix(len(places)), '10:00', '20:00', **kwargs)


def test_no_places(optimizer):
    result = optimizer.optimize_route([], [], '10:00')
    assert result == {'order': [], 'schedule': [], 'total_time': 0, 'total_cost': 0}


def test_all_places_visited_with_totals(optimizer):
    result = _optimize(optimizer, [_place(1), _place(2), _place(3)])
    assert sorted(result['order']) == [1, 2, 3]
    assert result['total_time'] == 180
    assert result['total_cost'] == 300
    assert result['schedule'][0]['arrival'] >= '10:00'


def test_opening_hours_decide_the_order(optimizer):
    places = [_place(1, '15:00-20:00'), _place(2, '10:00-12:00')]
    assert _optimize(optimizer, places)['order'] == [2, 1]


def test_forced_edge_keeps_places_adjacent(optimizer):
    places = [_place(1), _place(2), _place(3)]
    order = _optimize(optimizer, places, force_edges=[(0, 2)])['order']
    assert order.index(3) == order.index(1) + 1


def test_visit_longer_than_opening_window_is_an_error(optimizer):
    result = _optimize(optimizer, [_place(1, '10:00-10:30', duration=60)])
    assert 'error' in result and 'Место 1' in result['error']


def test_minutes_to_time_wraps_after_midnight(optimizer):
    assert optimizer._minutes_to_time(24 * 60 + 5) == '00:05'
