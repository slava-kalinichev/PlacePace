"""Сохранённые маршруты: лента, создание, просмотр, правка, звёзды"""

from flask import current_app, jsonify, request, Response
from sqlalchemy import func
from ..models import db, Route, Star, User
from ..services import translation_service
from ..services.image_service import decode_cover, normalize_cover_image
from ..services.route_view_service import (
    adjust_taxi_costs_for_viewer,
    build_popular_rank_map,
    has_route_access,
    mine_routes,
    points_only_cost,
    route_data_aggregates,
    serialize_route_card,
    trim_terminals,
    viewer_lang,)
from ..utils import iso_utc
from .auth import get_current_user
from .blueprint import api_bp


@api_bp.route('/routes', methods=['GET'])
def get_routes():
    """Данные для вкладок RouteBar и поиска"""
    user = get_current_user()
    starred_ids = set()
    if user:
        starred_ids = {
            s.route_id for s in Star.query.filter_by(user_id=user.id).all()
        }
    popular_rank_map = build_popular_rank_map()

    search = (request.args.get('search') or '').strip()

    if search:
        # Приоритет поиска: логин, id через "@", название маршрута, название точки
        matched_user = User.query.filter(
            func.lower(User.username) == search.lower()
        ).first()
        user_routes = []
        if matched_user:
            # Рекомендованные маршруты по логину нее ищутся
            user_routes = Route.query.filter_by(
                user_id=matched_user.id, is_public=True, is_recommended=False
            ).all()
        shown_ids = {r.id for r in user_routes}
        id_routes = []
        if search.startswith('@'):
            id_part = search[1:].strip()
            if id_part.isdigit():
                candidate = Route.query.get(int(id_part))
                if candidate and candidate.id not in shown_ids and (
                    candidate.is_public or (user and candidate.user_id == user.id)
                ):
                    id_routes = [candidate]
                    shown_ids.add(candidate.id)

        # Поиск по оригиналу и автопереводу названия
        title_match = db.or_(
            Route.title.ilike(f'%{search}%'),
            Route.title_translated.ilike(f'%{search}%'),
        )
        title_matches = Route.query.filter(
            title_match, Route.is_public.is_(True)
        ).all()
        # Приватные маршруты находит только их владелец
        if user:
            title_matches += Route.query.filter(
                title_match,
                Route.is_public.is_(False),
                Route.user_id == user.id,
            ).all()
        title_routes = [r for r in title_matches if r.id not in shown_ids]
        shown_ids |= {r.id for r in title_routes}

        # Поиск по названиям точек внутри маршрутов
        content_candidates = Route.query.filter(Route.is_public.is_(True)).all()
        if user:
            content_candidates += Route.query.filter(
                Route.is_public.is_(False), Route.user_id == user.id
            ).all()
        search_lower = search.lower()
        content_routes = []
        for r in content_candidates:
            if r.id in shown_ids:
                continue
            points = (r.route_data_public if r.is_public else None) or r.route_data or []
            if any(
                p.get('type') == 'attraction' and search_lower in (p.get('name') or '').lower()
                for p in points
            ):
                content_routes.append(r)
        content_routes.sort(key=lambda r: r.stars_count or 0, reverse=True)
        shown_ids |= {r.id for r in content_routes}

        sections = []
        if user_routes:
            sections.append({'key': 'search_users', 'label': 'Пользователи', 'routes': user_routes})

        # Слово "Маршруты" только у первого непустого блока
        route_blocks = [
            ('search_id', 'ID', id_routes),
            ('search_title', 'названию', title_routes),
            ('search_content', 'содержанию', content_routes),
        ]
        prefixed = False
        for key, suffix, routes in route_blocks:
            if not routes:
                continue
            label = f'Маршруты по {suffix}' if not prefixed else f'По {suffix}'
            prefixed = True
            sections.append({'key': key, 'label': label, 'routes': routes})

        return jsonify({
            'sections': [
                {**s, 'routes': [serialize_route_card(r, starred_ids, user, popular_rank_map) for r in s['routes']]}
                for s in sections
            ]
        }), 200

    category = request.args.get('category', 'all')

    if category == 'mine':
        created, favorited = mine_routes(user)
        sections = [
            {'key': 'mine_created', 'label': 'Созданные', 'routes': created},
            {'key': 'mine_favorited', 'label': 'Избранное', 'routes': favorited},
        ]
    elif category == 'popular':
        # Топ-20 по звёздам (минимум одна звезда)
        popular = Route.query.filter(
            Route.is_public.is_(True), Route.stars_count > 0
        ).order_by(Route.stars_count.desc(), Route.id.asc()).limit(20).all()
        sections = [{'key': 'popular', 'label': 'Топ 20 маршрутов пользователей', 'routes': popular}]
    else:
        # Рекомендованные: по времени создания, новые сверху
        recommended_routes = Route.query.filter_by(
            is_recommended=True
        ).order_by(Route.created_at.desc()).all()
        created, favorited = mine_routes(user)
        # Популярные и остальные открытые маршруты
        popular = Route.query.filter(
            Route.is_public.is_(True), Route.stars_count > 0
        ).order_by(Route.stars_count.desc(), Route.id.asc()).limit(20).all()
        popular_ids = [r.id for r in popular]
        rest = Route.query.filter(
            Route.is_public.is_(True),
            Route.is_recommended.is_(False),
            Route.id.notin_(popular_ids),
        ).order_by(Route.stars_count.desc(), Route.id.asc()).all()
        sections = [
            {'key': 'recommended', 'label': 'Рекомендованные', 'routes': recommended_routes},
            {'key': 'mine', 'label': 'Мои', 'routes': created + favorited},
            {'key': 'popular', 'label': 'Популярные', 'routes': popular},
            {'key': 'rest', 'label': 'Остальные', 'routes': rest},
        ]

    # Пустые секции не отдаё
    sections = [s for s in sections if s['routes']]

    return jsonify({
        'sections': [
            {**s, 'routes': [serialize_route_card(r, starred_ids, user, popular_rank_map) for r in s['routes']]}
            for s in sections
        ]
    }), 200


@api_bp.route('/routes', methods=['POST'])
def create_route():
    """Сохранение маршрута; публичные может сохранять только вошедший пользователь"""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401

    data = request.json or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'Название маршрута обязательно'}), 400

    # Право на is_recommended проверяем на сервере
    is_recommended = bool(data.get('is_recommended')) and user.is_admin
    is_public = True if is_recommended else bool(data.get('is_public', False))
    people_count = 1 if is_recommended else data.get('people_count', 1)
    display_mode = 'full' if is_recommended else data.get('display_mode', 'full')

    try:
        cover_image = normalize_cover_image(data.get('cover_image'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    route = Route(
        public_id=data.get('public_id'),
        title=title,
        description=data.get('description') or None,
        user_id=user.id,
        user_name=f"{user.first_name} {user.last_name}",
        start_point=data.get('start_point') or None,
        end_point=data.get('end_point') or None,
        date=data.get('date') or None,
        start_time=data.get('start_time') or None,
        end_time=data.get('end_time') or None,
        people_count=people_count,
        total_duration=data.get('total_duration'),
        total_cost=data.get('total_cost'),
        total_duration_public=data.get('total_duration_public'),
        total_cost_public=data.get('total_cost_public'),
        is_public=is_public,
        display_mode=display_mode,
        is_recommended=is_recommended,
        route_data=data.get('route_data'),
        route_data_public=data.get('route_data_public'),
        cover_image=cover_image,
        transport_options=data.get('transport_options'),
    )
    route.title_lang = translation_service.detect_lang(route.title)
    route.description_lang = translation_service.detect_lang(route.description)
    db.session.add(route)
    db.session.commit()
    translation_service.translate_route_async(current_app._get_current_object(), route.id)

    return jsonify({'success': True, 'id': route.id, 'public_id': route.public_id}), 201


@api_bp.route('/routes/lookup/<public_id>', methods=['GET'])
def lookup_route(public_id):
    """Публичная ссылка -> числовой id (права проверяет последующий запрос)"""
    route = Route.query.filter_by(public_id=public_id).first()
    if not route:
        return jsonify({'found': False}), 200
    return jsonify({'found': True, 'id': route.id}), 200


@api_bp.route('/routes/stars', methods=['GET'])
def get_route_stars():
    """Звёзды и избранное текущего пользователя по маршрутам"""
    user = get_current_user()
    starred_ids = set()
    if user:
        starred_ids = {
            s.route_id for s in Star.query.filter_by(user_id=user.id).all()
        }

    routes = Route.query.all()
    return jsonify([
        {
            'id': r.id,
            'stars_count': r.stars_count or 0,
            'is_favorite': r.id in starred_ids,
        }
        for r in routes
    ]), 200


@api_bp.route('/routes/<int:route_id>/toggle-star', methods=['POST'])
def toggle_route_star(route_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401

    route = Route.query.get(route_id)
    if not route:
        return jsonify({'error': 'Маршрут не найден'}), 404

    if not route.is_public:
        return jsonify({'error': 'Приватный маршрут нельзя добавить в избранное'}), 403

    if route.is_recommended:
        return jsonify({'error': 'Рекомендованный маршрут нельзя добавить в избранное'}), 403

    if route.user_id == user.id:
        return jsonify({'error': 'Нельзя добавить в избранное свой собственный маршрут'}), 403

    existing = Star.query.filter_by(user_id=user.id, route_id=route_id).first()
    if existing:
        db.session.delete(existing)
        route.stars_count = max(0, (route.stars_count or 0) - 1)
        is_favorite = False
    else:
        db.session.add(Star(user_id=user.id, route_id=route_id))
        route.stars_count = (route.stars_count or 0) + 1
        is_favorite = True

    db.session.commit()

    return jsonify({
        'success': True,
        'is_favorite': is_favorite,
        'stars_count': route.stars_count,
    }), 200


@api_bp.route('/routes/<int:route_id>/cover', methods=['GET'])
def get_route_cover(route_id):
    """Обложка маршрута как картинка (приватный маршрут видит только владелец)"""
    row = db.session.query(
        Route.id, Route.user_id, Route.is_public, Route.is_recommended, Route.cover_image
    ).filter(Route.id == route_id).first()
    if not row:
        return jsonify({'error': 'Маршрут не найден'}), 404

    if not row.is_public and not has_route_access(row, get_current_user()):
        return jsonify({'error': 'Маршрут не найден'}), 404

    decoded = decode_cover(row.cover_image)
    if not decoded:
        return jsonify({'error': 'Обложки нет'}), 404

    mime, body = decoded
    return Response(body, mimetype=mime, headers={
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
    })


@api_bp.route('/routes/<int:route_id>', methods=['GET'])
def get_route_detail(route_id):
    """Полные данные маршрута для окна «Просмотр» (терминалы обрезаются по текущей настройке владельца)"""
    route = Route.query.get(route_id)
    if not route:
        return jsonify({'error': 'Маршрут не найден'}), 404

    user = get_current_user()
    is_owner = has_route_access(route, user)

    if not route.is_public and not is_owner:
        return jsonify({'error': 'Маршрут не найден'}), 404

    cost_excludes_transport = False

    if route.is_recommended:
        full_data = trim_terminals(route.route_data or [])
        if is_owner or route.display_mode != 'points_only':
            route_data = full_data
            agg = route_data_aggregates(route_data)
            total_duration, total_cost = agg['duration'], agg['cost']
        else:
            # Точки питания показываем, но в сумме не учитываем
            route_data = [item for item in full_data if item.get('type') in ('attraction', 'food')]
            total_duration = None
            total_cost = points_only_cost(full_data)
            cost_excludes_transport = True
        people_count = route.people_count
    elif is_owner:
        # Владелец видит полный маршрут с терминалами
        route_data = route.route_data or []
        total_duration, total_cost = route.total_duration, route.total_cost
        people_count = route.people_count
    elif route.display_mode != 'points_only':
        private_terminal_enabled = route.user.private_terminal_enabled if route.user else True
        full_data = adjust_taxi_costs_for_viewer(route.route_data or [], route.people_count)
        route_data = trim_terminals(full_data) if private_terminal_enabled else full_data
        agg = route_data_aggregates(route_data)
        total_duration, total_cost = agg['duration'], agg['cost']
        people_count = 1
    else:
        # Точки питания показываем, но в сумме не учитываем
        route_data = [item for item in (route.route_data or []) if item.get('type') in ('attraction', 'food')]
        total_duration = None
        total_cost = points_only_cost(route.route_data)
        cost_excludes_transport = True
        people_count = 1

    # ниже параметры сохранения - только владельцу
    expose_sensitive = is_owner and not route.is_recommended
    # start_time не раскрывает адрес, нужен и для "Адаптировать"
    expose_start_time = is_owner or route.display_mode == 'full'

    title, description = translation_service.localized_texts(route, viewer_lang())

    return jsonify({
        'id': route.id,
        'public_id': route.public_id,
        # Название и описание для показа (с переводом) и оригиналы для форм
        'title': title,
        'description': description,
        'title_original': route.title,
        'description_original': route.description,
        'cover_image': route.cover_image,
        'is_owner': is_owner,
        'is_public': route.is_public,
        'is_recommended': route.is_recommended,
        'display_mode': route.display_mode,
        'creator_username': None if route.is_recommended else (route.user.username if route.user else route.user_name),
        'people_count': people_count,
        # null для приватных и рекомендованных (звёзд нет)
        'stars_count': (route.stars_count or 0) if (route.is_public and not route.is_recommended) else None,
        'is_favorite': user is not None and Star.query.filter_by(user_id=user.id, route_id=route.id).first() is not None,
        'total_cost': total_cost,
        'total_duration': total_duration,
        'cost_excludes_transport': cost_excludes_transport,
        'created_at': iso_utc(route.created_at),
        'updated_at': iso_utc(route.updated_at),
        'route_data': route_data,
        # Нужны и не-владельцу для "Адаптировать"
        'transport_options': route.transport_options if expose_start_time else None,
        'start_point': route.start_point if expose_sensitive else None,
        'end_point': route.end_point if expose_sensitive else None,
        'date': route.date.isoformat() if expose_sensitive and route.date else None,
        'end_time': route.end_time.isoformat(timespec='minutes') if expose_sensitive and route.end_time else None,
        'start_time': route.start_time.isoformat(timespec='minutes') if expose_start_time and route.start_time else None,
    }), 200


@api_bp.route('/routes/<int:route_id>', methods=['PATCH'])
def update_route(route_id):
    """Смена доступа и показа, полное обновление маршрута (владелец или админ)"""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401

    route = Route.query.get(route_id)
    if not route:
        return jsonify({'error': 'Маршрут не найден'}), 404

    if not has_route_access(route, user):
        return jsonify({'error': 'Можно менять только свой маршрут'}), 403

    data = request.json or {}

    if 'display_mode' in data and data['display_mode'] in ('full', 'points_only'):
        route.display_mode = data['display_mode']

    if 'is_public' in data and not route.is_recommended:
        new_is_public = bool(data['is_public'])
        if route.is_public and not new_is_public:
            # У приватных маршрутов звёзд нет
            Star.query.filter_by(route_id=route.id).delete()
            route.stars_count = 0
        route.is_public = new_is_public

    # Полное обновление содержимого (все поля необязательны)
    texts_changed = False
    if 'title' in data:
        title = (data.get('title') or '').strip()
        if title and title != route.title:
            route.title = title
            route.title_lang = translation_service.detect_lang(title)
            route.title_translated = None
            texts_changed = True
    if 'description' in data:
        description = data.get('description') or None
        if description != route.description:
            route.description = description
            route.description_lang = translation_service.detect_lang(description)
            route.description_translated = None
            texts_changed = True
    if 'cover_image' in data:
        try:
            route.cover_image = normalize_cover_image(data.get('cover_image'))
        except ValueError as exc:
            db.session.rollback()
            return jsonify({'error': str(exc)}), 400
    if 'start_point' in data:
        route.start_point = data.get('start_point') or None
    if 'end_point' in data:
        route.end_point = data.get('end_point') or None
    if 'date' in data:
        route.date = data.get('date') or None
    if 'start_time' in data:
        route.start_time = data.get('start_time') or None
    if 'end_time' in data:
        route.end_time = data.get('end_time') or None
    if 'people_count' in data and not route.is_recommended:
        route.people_count = data.get('people_count') or 1
    if 'total_duration' in data:
        route.total_duration = data.get('total_duration')
    if 'total_cost' in data:
        route.total_cost = data.get('total_cost')
    if 'total_duration_public' in data:
        route.total_duration_public = data.get('total_duration_public')
    if 'total_cost_public' in data:
        route.total_cost_public = data.get('total_cost_public')
    if 'route_data' in data:
        route.route_data = data.get('route_data')
    if 'route_data_public' in data:
        route.route_data_public = data.get('route_data_public')
    if 'transport_options' in data:
        route.transport_options = data.get('transport_options')

    db.session.commit()
    if texts_changed:
        translation_service.translate_route_async(current_app._get_current_object(), route.id)

    return jsonify({
        'success': True,
        'is_public': route.is_public,
        'display_mode': route.display_mode,
    }), 200


@api_bp.route('/routes/<int:route_id>', methods=['DELETE'])
def delete_route(route_id):
    """Удаление маршрута (владелец или админ)"""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401

    route = Route.query.get(route_id)
    if not route:
        return jsonify({'error': 'Маршрут не найден'}), 404

    if not has_route_access(route, user):
        return jsonify({'error': 'Можно удалить только свой маршрут'}), 403

    Star.query.filter_by(route_id=route.id).delete()
    db.session.delete(route)
    db.session.commit()

    return jsonify({'success': True}), 200
