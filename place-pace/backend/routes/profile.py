"""Личный кабинет: профиль, смена email и пароля"""

from flask import jsonify, request
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash
from ..models import db, Route, User
from ..services.account_service import email_taken, send_verification, validate_email_format
from ..services.travel_matrix import TAXI_TARIFFS
from ..utils import iso_utc
from .auth import get_current_user, user_public_dict
from .blueprint import api_bp


@api_bp.route('/profile/change-email', methods=['POST'])
def change_email():
    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'error': 'Не авторизован'}), 401

    data = request.json or {}
    new_email = (data.get('new_email') or '').strip().lower()
    password = data.get('password') or ''

    if not new_email or not password:
        return jsonify({'success': False, 'error': 'Заполните все поля'}), 400

    if not check_password_hash(user.password_hash, password):
        return jsonify({'success': False, 'error': 'Неверный пароль'}), 401

    email_error = validate_email_format(new_email)
    if email_error:
        return jsonify({'success': False, 'error': email_error, 'field': 'email'}), 400

    if user.email and new_email == user.email.lower():
        return jsonify({'success': False, 'error': 'Это уже ваш текущий email', 'field': 'email'}), 400
    if email_taken(new_email, exclude_user_id=user.id):
        return jsonify({'success': False, 'error': 'Данная почта уже используется другим аккаунтом', 'field': 'email'}), 409

    # email меняется только после подтверждения
    user.pending_email = new_email
    db.session.commit()
    send_verification(user, 'change_email', new_email)

    return jsonify({'success': True, 'email': new_email}), 200


@api_bp.route('/profile/change-password', methods=['POST'])
def change_password():
    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'error': 'Не авторизован'}), 401

    data = request.json or {}
    current_password = data.get('current_password') or ''
    new_password = data.get('new_password') or ''

    if not current_password or not new_password:
        return jsonify({'success': False, 'error': 'Заполните все поля'}), 400

    if not check_password_hash(user.password_hash, current_password):
        return jsonify({'success': False, 'error': 'Неверный текущий пароль'}), 401

    user.password_hash = generate_password_hash(new_password)
    db.session.commit()

    return jsonify({'success': True}), 200


@api_bp.route('/profile', methods=['GET'])
def get_profile():
    """Данные личного кабинета: счётчики маршрутов, звёзд и место в рейтинге"""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401

    routes_count = Route.query.filter_by(user_id=user.id).count()

    # Звёзды - только с открытых маршрутов аккаунта
    stars_by_user = db.session.query(
        Route.user_id.label('user_id'),
        func.coalesce(func.sum(Route.stars_count), 0).label('total_stars')
    ).filter(Route.is_public.is_(True), Route.is_recommended.is_(False)) \
        .group_by(Route.user_id).subquery()

    ranked = db.session.query(
        User.id,
        func.coalesce(stars_by_user.c.total_stars, 0).label('total_stars')
    ).outerjoin(stars_by_user, User.id == stars_by_user.c.user_id) \
        .order_by(db.desc('total_stars'), User.id) \
        .all()

    # Место в рейтинге: при равенстве звёзд акаунты делят место
    stars_total = 0
    rank_start = None
    rank_end = None
    position = 1
    i = 0
    while i < len(ranked):
        j = i
        while j < len(ranked) and ranked[j].total_stars == ranked[i].total_stars:
            j += 1
        group_size = j - i
        if any(row.id == user.id for row in ranked[i:j]):
            stars_total = ranked[i].total_stars
            rank_start = position
            rank_end = position + group_size - 1
            break
        position += group_size
        i = j
    rank_label = None
    if rank_start is not None:
        rank_label = str(rank_start) if rank_start == rank_end else f"{rank_start}-{rank_end}"

    return jsonify({
        **user_public_dict(user),
        'created_at': iso_utc(user.created_at),
        'routes_count': routes_count,
        'stars_total': int(stars_total),
        'rank_label': rank_label,
        'email': user.email,
        'pending_email': user.pending_email,
        'home_address': user.home_address,
        'home_lat': user.home_lat,
        'home_lon': user.home_lon,
        'private_terminal_enabled': user.private_terminal_enabled,
        'language': user.language,
        'is_admin': user.is_admin,
        'default_taxi_tariff': user.default_taxi_tariff,
        'walk_distance_limit_m': user.walk_distance_limit_m,
    }), 200


@api_bp.route('/profile', methods=['POST'])
def update_profile():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401
    data = request.json or {}
    if 'home_address' in data:
        # Адрес уже разрешён на фронтенде
        home_address = (data.get('home_address') or '').strip()
        user.home_address = home_address or None
        user.home_lat = data.get('home_lat') if home_address else None
        user.home_lon = data.get('home_lon') if home_address else None
    if 'private_terminal_enabled' in data:
        user.private_terminal_enabled = bool(data['private_terminal_enabled'])
    if 'language' in data and data['language'] in ('ru', 'en'):
        user.language = data['language']
    # Индивидуальные настройки аккаунта: тариф такси и прогулочный лимит
    if 'default_taxi_tariff' in data and data['default_taxi_tariff'] in TAXI_TARIFFS:
        user.default_taxi_tariff = data['default_taxi_tariff']
    if 'walk_distance_limit_m' in data:
        # Границы совпадают с ползунком на фронтенде (100- 1500 м)
        try:
            limit = int(data['walk_distance_limit_m'])
        except (TypeError, ValueError):
            limit = None
        if limit is not None and 100 <= limit <= 1500:
            user.walk_distance_limit_m = limit
    db.session.commit()

    return jsonify({
        'success': True,
        'home_address': user.home_address,
        'home_lat': user.home_lat,
        'home_lon': user.home_lon,
        'private_terminal_enabled': user.private_terminal_enabled,
        'language': user.language,
        'default_taxi_tariff': user.default_taxi_tariff,
        'walk_distance_limit_m': user.walk_distance_limit_m,
    }), 200
