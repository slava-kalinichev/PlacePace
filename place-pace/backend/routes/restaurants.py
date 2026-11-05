# Подбор мест питания для слота маршрута

from concurrent.futures import ThreadPoolExecutor
import logging
from flask import jsonify, request
from ..config import Config
from ..extensions import dgis_service
from ..utils import haversine_m
from .blueprint import api_bp

logger = logging.getLogger(__name__)


def _rank_restaurant_candidates(candidates, before, after):
    """Сортировка кандидатов по рейтингу и близости к соседним точкам"""
    RATING_WEIGHT = 0.6
    PROXIMITY_WEIGHT = 0.4
    # Радиус нормализации близости, м
    NORMALIZATION_RADIUS_M = 1200

    scored = []
    for c in candidates:
        distances = []
        if before is not None:
            distances.append(haversine_m(before['lat'], before['lon'], c['lat'], c['lon']))
        if after is not None:
            distances.append(haversine_m(after['lat'], after['lon'], c['lat'], c['lon']))
        distance_m = min(distances) if distances else 0
        rating = c.get('rating') or 0
        rating_score = min(rating, 5) / 5
        proximity_score = max(0.0, 1 - distance_m / NORMALIZATION_RADIUS_M)
        composite = RATING_WEIGHT * rating_score + PROXIMITY_WEIGHT * proximity_score
        scored.append({**c, 'distanceMeters': round(distance_m), 'compositeScore': composite})

    scored.sort(key=lambda c: c['compositeScore'], reverse=True)
    for c in scored:
        del c['compositeScore']
    return scored


def _search_fast_food(lat, lon, radius_m, limit):
    """Фастфуд для слота"""
    chains = Config.DGIS_FAST_FOOD_CHAINS
    with ThreadPoolExecutor(max_workers=len(chains) + 1) as executor:
        generic_future = executor.submit(
            dgis_service.search, lat, lon, radius_m=radius_m, limit=limit, fast_food=True)
        chain_futures = [
            executor.submit(dgis_service.search, lat, lon, radius_m=radius_m, limit=2, chain=chain)
            for chain in chains
        ]
        chain_lists = [f.result() or [] for f in chain_futures]
        generic = generic_future.result() or []

    # Отсекаем филиалы заметно дальше радиуса поиска
    max_distance_m = radius_m * 1.3
    def near(c):
        return haversine_m(lat, lon, c['lat'], c['lon']) <= max_distance_m
    chain_lists = [[c for c in items if near(c)] for items in chain_lists]
    generic = [c for c in generic if near(c)]

    ordered = []
    for rank in range(2):
        for items in chain_lists:
            if rank < len(items):
                ordered.append(items[rank])
    ordered += generic

    seen, result = set(), []
    for c in ordered:
        if c['id'] in seen:
            continue
        seen.add(c['id'])
        result.append(c)
        if len(result) >= limit:
            break
    return result


@api_bp.route('/restaurants/search', methods=['POST'])
def restaurants_search():
    """Подбор мест для окна «Рестораны и кафе»: один запрос на слот"""
    try:
        data = request.json or {}
        before = data.get('before')
        after = data.get('after')
        if not before and not after:
            return jsonify({'error': 'Нужна хотя бы одна точка (before или after)'}), 400

        # Если точки слота далеко друг от друга: поиск вокруг каждой
        FAR_GAP_THRESHOLD_M = 1200
        gap_m = None
        if before and after:
            gap_m = haversine_m(before['lat'], before['lon'], after['lat'], after['lon'])
        # Max позиций фастфуда на слот
        FAST_FOOD_LIMIT = 6
        fast_food_candidates = []

        if before and after and gap_m > FAR_GAP_THRESHOLD_M:
            before_results = dgis_service.search(before['lat'], before['lon'], radius_m=900)
            after_results = dgis_service.search(after['lat'], after['lon'], radius_m=900)
            if before_results is None and after_results is None:
                return jsonify({'error': 'Поиск ресторанов временно недоступен'}), 502
            by_id = {}
            for c in (before_results or []) + (after_results or []):
                by_id[c['id']] = c
            candidates = list(by_id.values())
            per_side = FAST_FOOD_LIMIT // 2
            # Для далёких точек ищем только общим запросом
            for point in (before, after):
                fast_food_candidates += dgis_service.search(
                    point['lat'], point['lon'], radius_m=900, limit=per_side, fast_food=True) or []
        else:
            if before and after:
                center_lat = (before['lat'] + after['lat']) / 2
                center_lon = (before['lon'] + after['lon']) / 2
                radius_m = max(600, min(2000, gap_m / 2 + 500))
            else:
                point = before or after
                center_lat, center_lon = point['lat'], point['lon']
                radius_m = 900
            candidates = dgis_service.search(center_lat, center_lon, radius_m=round(radius_m))
            if candidates is None:
                return jsonify({'error': 'Поиск ресторанов временно недоступен'}), 502
            fast_food_candidates = _search_fast_food(center_lat, center_lon, round(radius_m), FAST_FOOD_LIMIT)

        # Не дублируем заведения из основной выдачи
        known_ids = {c['id'] for c in candidates}
        for c in fast_food_candidates:
            if c['id'] not in known_ids:
                known_ids.add(c['id'])
                candidates.append(c)

        ranked = _rank_restaurant_candidates(candidates, before, after)
        return jsonify({'candidates': ranked}), 200
    except Exception as e:
        logger.error(f"Ошибка поиска ресторанов: {str(e)}")
        return jsonify({'error': str(e)}), 500
