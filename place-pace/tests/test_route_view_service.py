from types import SimpleNamespace

from backend.services.route_view_service import (
    adjust_taxi_costs_for_viewer, has_route_access, points_only_cost, route_data_aggregates, trim_terminals)


def test_points_only_cost_ignores_transport():
    data = [
        {'type': 'attraction', 'cost': 500},
        {'type': 'food', 'cost': 700},
        {'type': 'transport', 'cost': 75},
        {'type': 'attraction', 'cost': None},
    ]
    assert points_only_cost(data) == 1200
    assert points_only_cost(None) == 0


def test_taxi_cost_is_recalculated_for_viewer():
    data = [{'cost': 400, 'costApproximate': True}, {'cost': 75}]
    assert adjust_taxi_costs_for_viewer(data, 1) is data
    adjusted = adjust_taxi_costs_for_viewer(data, 5)
    assert adjusted[0]['cost'] == 400 * 5 / 2
    assert adjusted[1]['cost'] == 75


def test_route_data_aggregates():
    data = [{'time': '10:00', 'cost': 0}, {'time': '12:00', 'cost': 100.4}, {'time': '13:30', 'cost': 50.4}]
    assert route_data_aggregates(data) == {'duration': 210, 'cost': 151}
    assert route_data_aggregates([]) == {'duration': 0, 'cost': 0}


def test_route_data_aggregates_across_midnight():
    assert route_data_aggregates([{'time': '23:00'}, {'time': '01:00'}])['duration'] == 120


def test_trim_terminals_replaces_home_with_start_and_finish():
    data = [
        {'type': 'start', 'icon': 'home', 'name': 'Дом', 'time': '09:00'},
        {'id': 'transport_start_terminal', 'type': 'transport'},
        {'type': 'attraction', 'id': 1, 'address': 'ул. Тверская', 'time': '09:20', 'endTime': '10:20'},
        {'id': 'transport_end_terminal', 'type': 'transport'},
        {'type': 'end', 'icon': 'home', 'name': 'Дом', 'time': '11:00'},
    ]
    trimmed = trim_terminals(data)
    assert len(trimmed) == 3
    assert trimmed[0]['icon'] == 'start' and trimmed[0]['name'] == 'Старт (ул. Тверская)'
    assert trimmed[0]['time'] == '09:20'
    assert trimmed[-1]['icon'] == 'finish' and trimmed[-1]['time'] == '10:20'


def test_trim_terminals_keeps_empty_data():
    assert trim_terminals([]) == []
    assert trim_terminals(None) is None


def test_route_access_rules():
    owner = SimpleNamespace(id=1, is_admin=False)
    admin = SimpleNamespace(id=2, is_admin=True)
    stranger = SimpleNamespace(id=3, is_admin=False)
    route = SimpleNamespace(user_id=1, is_recommended=False)
    recommended = SimpleNamespace(user_id=1, is_recommended=True)
    assert has_route_access(route, owner)
    assert not has_route_access(route, admin)
    assert has_route_access(recommended, admin)
    assert not has_route_access(recommended, stranger)
    assert not has_route_access(route, None)
