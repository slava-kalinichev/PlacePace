"""Каталог мест и живой поиск 2GIS"""

from concurrent.futures import ThreadPoolExecutor
from flask import jsonify, request
from ..config import Config
from ..extensions import dgis_service
from ..models import db, Place
from ..services import dgis_attractions
from ..services.address_service import reverse_address
from ..utils import haversine_m
from .blueprint import api_bp


@api_bp.route('/places', methods=['GET'])
def get_places():
    """Получить список всех мест с возможностью фильтрации по категории"""
    category = request.args.get('category')
    # Каталог ручных мест
    query = Place.query.filter_by(is_active=True)
    if category:
        query = query.filter_by(category=category)
    places = query.all()
    return jsonify([{
        'id': p.id,
        'name': p.name,
        'description': p.description,
        'address': p.address,
        'latitude': p.latitude,
        'longitude': p.longitude,
        'category': p.category,
        'work_time': p.work_time,
        'ticket_price': p.ticket_price,
        'recommended_duration': p.recommended_duration,
        'image_url': p.image_url
    } for p in places])

HIDDEN_FILTER_CATEGORIES = {'Развлечения', 'Цирки'}

@api_bp.route('/categories', methods=['GET'])
def get_categories():
    """Категории: ручные места с количеством и категории живого поиска 2GIS"""
    rows = db.session.query(
        Place.category,
        db.func.count(Place.id).label('count')
    ).filter_by(is_active=True).filter(
        Place.category.notin_(HIDDEN_FILTER_CATEGORIES)
    ).group_by(Place.category).all()
    live_names = set(dgis_attractions.live_categories()) if dgis_service.is_available() else set()
    result = [{'name': r.category, 'count': r.count, 'live': r.category in live_names} for r in rows]
    present = {r.category for r in rows}
    result.extend({'name': name, 'count': 0, 'live': True} for name in dgis_attractions.live_categories()
                  if name in live_names and name not in present)
    return jsonify(result)


@api_bp.route('/places/schedules', methods=['POST'])
def get_places_schedules():
    """Расписания ручных точек из 2GIS ({id: расписание | null})"""
    data = request.json or {}
    items = [p for p in (data.get('places') or []) if isinstance(p, dict)][:20]
    if not items or not dgis_service.is_available():
        return jsonify({'schedules': {str(p.get('id')): None for p in items}, 'available': False})

    def _lookup(p):
        try:
            return dgis_service.lookup_schedule(p.get('name') or '', float(p['latitude']), float(p['longitude']))
        except (KeyError, TypeError, ValueError):
            return None

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(_lookup, items))
    return jsonify({
        'schedules': {str(p.get('id')): sched for p, sched in zip(items, results)},
        'available': True,
    })


@api_bp.route('/places/live', methods=['GET'])
def get_places_live():
    """Живой поиск достопримечательностей 2GIS; при сбое пустой список"""
    category = (request.args.get('category') or '').strip() or None
    query = (request.args.get('q') or '').strip() or None
    if query and len(query) < 2:
        query = None
    try:
        page = int(request.args.get('page', 1))
    except ValueError:
        page = 1

    manual_places = Place.query.filter_by(is_active=True).all()
    return jsonify(dgis_attractions.search_live(
        dgis_service, manual_places, haversine_m, category, query, page, Config.DGIS_MAX_PAGES,
        address_resolver=reverse_address))


@api_bp.route('/places/<int:place_id>', methods=['GET'])
def get_place(place_id):
    """Получить информацию о конкретном месте"""
    place = Place.query.get_or_404(place_id)
    return jsonify({
        'id': place.id,
        'name': place.name,
        'description': place.description,
        'address': place.address,
        'latitude': place.latitude,
        'longitude': place.longitude,
        'category': place.category,
        'work_time': place.work_time,
        'ticket_price': place.ticket_price,
        'recommended_duration': place.recommended_duration,
        'image_url': place.image_url
    })
