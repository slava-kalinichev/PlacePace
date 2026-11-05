import pytest
from flask import Flask

from backend.routes import api_bp


@pytest.fixture(scope='module')
def client():
    app = Flask(__name__)
    app.register_blueprint(api_bp, url_prefix='/api')
    return app.test_client()


def _body(places, **overrides):
    n = len(places)
    body = {
        'places': places, 'travel_matrix': [[0 if i == j else 10 for j in range(n)] for i in range(n)],
        'travel_modes': [['пешком'] * n for _ in range(n)], 'travel_fares': [[None] * n for _ in range(n)],
        'start_time': '10:00', 'end_time': None, 'people_count': 1, 'date': '2026-11-09',
        'start_terminal_costs': None, 'end_terminal_costs': None, 'time_limit_seconds': 1,
    }
    body.update(overrides)
    return body


def _place(pid, work_time, schedule=None, duration=60):
    return {'id': pid, 'name': f'Место {pid}', 'work_time': work_time, 'schedule': schedule,
            'recommended_duration': duration, 'ticket_price': 0}


def test_returns_hours_used_for_the_chosen_date(client):
    monday_hours = {'Mon': {'from': '10:00', 'to': '19:00'}}
    places = [_place(1, '10:00-18:00', monday_hours), _place(2, 'Круглосуточно')]
    data = client.post('/api/optimize', json=_body(places)).get_json()
    assert data['success']
    assert data['work_hours'] == {'1': '10:00-19:00', '2': 'Круглосуточно'}


def test_route_is_rejected_when_it_cannot_fit_before_end_time(client):
    body = _body([_place(1, 'Круглосуточно')], end_time='11:45', start_terminal_costs=[10], end_terminal_costs=[40])
    response = client.post('/api/optimize', json=body)
    assert response.status_code == 400 and not response.get_json()['success']
