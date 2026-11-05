"""Режим On It: прохождение маршрута и сдвиг времени"""

from datetime import datetime
from flask import jsonify, request
from ..extensions import osrm_service
from ..models import db, Route, RouteSession
from ..services import route_walk_service, translation_service
from ..services.route_view_service import has_route_access, viewer_lang
from ..utils import iso_utc
from .auth import get_current_user
from .blueprint import api_bp


@api_bp.route('/routes/<int:route_id>/walk-sessions', methods=['POST'])
def start_walk_session(route_id):
    """Начало прохождения маршрута"""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401

    route = Route.query.get(route_id)
    if not route:
        return jsonify({'error': 'Маршрут не найден'}), 404

    if not route.is_public and not has_route_access(route, user):
        return jsonify({'error': 'Маршрут не найден'}), 404
    session_row = RouteSession(user_id=user.id, route_id=route.id)
    db.session.add(session_row)
    db.session.commit()

    return jsonify({
        'id': session_row.id,
        'started_at': iso_utc(session_row.started_at),
    }), 200


def _walk_session_stats_dict(session_row, user):
    """Статистика прохождения из строки RouteSession"""
    route = Route.query.get(session_row.route_id)
    executed_route_data = session_row.executed_route_data or []
    # Остановки: attraction и food по фактически пройденному маршруту
    stop_count = sum(1 for item in executed_route_data if item.get('type') in ('attraction', 'food'))
    elapsed_seconds = int((session_row.finished_at - session_row.started_at).total_seconds())

    return {
        'id': session_row.id,
        'username': user.username,
        'route_title': translation_service.localized_texts(route, viewer_lang())[0] if route else None,
        # route_id - числовой id маршрута, как в окне "Просмотр"
        'route_id': route.id if route else None,
        'stop_count': stop_count,
        'started_at': iso_utc(session_row.started_at),
        'finished_at': iso_utc(session_row.finished_at),
        'elapsed_seconds': elapsed_seconds,
    }


@api_bp.route('/walk-sessions/<int:session_id>/finish', methods=['POST'])
def finish_walk_session(session_id):
    """Завершение прохождения (только владельцем сессии)"""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401

    session_row = RouteSession.query.get(session_id)
    if not session_row or session_row.user_id != user.id:
        return jsonify({'error': 'Сессия не найдена'}), 404

    if session_row.status == 'completed':
        return jsonify({'error': 'Сессия уже завершена'}), 400

    data = request.json or {}
    route_data = data.get('route_data') or []

    session_row.finished_at = datetime.utcnow()
    session_row.status = 'completed'
    session_row.executed_route_data = route_data
    db.session.commit()

    return jsonify(_walk_session_stats_dict(session_row, user)), 200


@api_bp.route('/walk-sessions', methods=['GET'])
def list_walk_sessions():
    """Завершённые прохождения текущего пользователя"""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401

    sessions = (RouteSession.query
                .filter_by(user_id=user.id, status='completed')
                .order_by(RouteSession.finished_at.desc())
                .all())

    return jsonify([_walk_session_stats_dict(s, user) for s in sessions]), 200


@api_bp.route('/routes/<int:route_id>/walk/shift', methods=['POST'])
def walk_shift_stop_time(route_id):
    """Каскадный сдвиг времени точки; без resolution - только проверка конфликтов"""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401

    route = Route.query.get(route_id)
    if not route:
        return jsonify({'error': 'Маршрут не найден'}), 404

    if not route.is_public and not has_route_access(route, user):
        return jsonify({'error': 'Маршрут не найден'}), 404

    data = request.json or {}
    route_data = data.get('route_data') or []
    stop_item_id = data.get('stop_item_id')
    new_start_minutes = data.get('new_start_minutes')
    new_end_minutes = data.get('new_end_minutes')
    resolution = data.get('resolution')

    if stop_item_id is None or new_start_minutes is None or new_end_minutes is None:
        return jsonify({'error': 'Не хватает параметров сдвига'}), 400

    try:
        new_start_minutes = int(new_start_minutes)
        new_end_minutes = int(new_end_minutes)
    except (TypeError, ValueError):
        return jsonify({'error': 'Некорректные значения времени'}), 400

    result = route_walk_service.shift_stop_time(
        route_data, stop_item_id, new_start_minutes, new_end_minutes,
        resolution=resolution,
        travel_matrix_fn=osrm_service.get_travel_matrix,
    )
    if result.get('error') == 'stop_not_found':
        return jsonify(result), 404
    return jsonify(result), 200
