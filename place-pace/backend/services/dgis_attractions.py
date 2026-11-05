"""Ответ живого поиска 2GIS в формат Place (без записи в БД)"""
import hashlib
import re
from concurrent.futures import ThreadPoolExecutor

from ..data.dgis_rubrics import CATEGORY_RUBRICS, DEFAULT_DURATION_BY_CATEGORY, category_for_rubrics
from .dgis_service import DgisService, _collapse_schedule_to_range

# Дальше этого от ручной точки с похожим названием - не считаем дублем
DEDUP_RADIUS_M = 150


def numeric_id(external_id: str) -> int:
    """Числовой id для фронтенда: отрицательный хэш, не пересекается с id ручных точек"""
    digest = hashlib.sha1(external_id.encode('utf-8')).hexdigest()
    return -int(digest[:13], 16)


def _normalize_name(name: str) -> str:
    return re.sub(r'[^\w\s]', '', name.lower()).strip()


def _is_duplicate_of_manual(lat, lon, name, manual_places, haversine_m) -> bool:
    """Точка 2GIS - дубль ручной, если рядом и названия вложены друг в друга"""
    norm = _normalize_name(name)
    for p in manual_places:
        if p.latitude is None or p.longitude is None:
            continue
        if haversine_m(lat, lon, p.latitude, p.longitude) > DEDUP_RADIUS_M:
            continue
        p_norm = _normalize_name(p.name)
        if norm in p_norm or p_norm in norm:
            return True
    return False


def normalize_query(query: str) -> str:
    """Убирает из запроса инициалы и знаки препинания"""
    tokens = [t for t in re.split(r'[\s.,]+', query.lower()) if len(t) > 1]
    return ' '.join(tokens) or query.strip().lower()


def live_categories() -> list[str]:
    """Категории, для которых есть рубрики 2GIS (то есть живой поиск)"""
    return list(CATEGORY_RUBRICS.keys())


def search_live(dgis: DgisService, manual_places, haversine_m, category: str | None,
                query: str | None, page: int, max_pages: int, address_resolver=None) -> dict:
    """Один запрос -> {'items': [...], 'has_more': bool}; без категории ищет по тексту без фильтра рубрик"""
    empty = {'items': [], 'has_more': False}
    if category:
        if category not in CATEGORY_RUBRICS:
            return empty
        rubric_ids = CATEGORY_RUBRICS[category][0]
    elif query:
        rubric_ids = None
    else:
        return empty
    if page < 1 or page > max_pages:
        return empty

    res = dgis.search_attractions(rubric_ids, query=normalize_query(query) if query else None, page=page)
    if res is None:
        return empty

    items = []
    for it in res['items']:
        ext_id = it['id']
        if not ext_id:
            continue
        item_category = category_for_rubrics(it['rubric_ids'])
        # Точки другой категории пропускаем, при поиске по тексту оставляем и без категории
        if category and item_category != category:
            continue
        if _is_duplicate_of_manual(it['lat'], it['lon'], it['name'], manual_places, haversine_m):
            continue
        items.append({
            'id': numeric_id(ext_id),
            'name': it['name'],
            'description': None,
            'address': it['address'],
            'latitude': it['lat'],
            'longitude': it['lon'],
            'category': item_category,
            'work_time': _collapse_schedule_to_range(it['schedule']),
            'ticket_price': 0,
            'recommended_duration': DEFAULT_DURATION_BY_CATEGORY.get(item_category, 60),
            'image_url': None,
            # Расписание по дням (нигде не хранится)
            'schedule': it['schedule'],
        })

    # Адрес из 2GIS или по координатам через геокодер; без адреса точка скрывается
    missing = [i for i in items if not (i['address'] or '').strip()]
    if missing and address_resolver:
        with ThreadPoolExecutor(max_workers=min(10, len(missing))) as pool:
            def _safe_resolve(i):
                # Сбой геокодера - просто нет адреса
                try:
                    return address_resolver(i['latitude'], i['longitude'])
                except Exception:
                    return None
            for item, address in zip(missing, pool.map(_safe_resolve, missing)):
                item['address'] = address
    items = [i for i in items if (i['address'] or '').strip()]

    has_more = len(res['items']) >= 10 and res['total'] > page * 10 and page < max_pages
    return {'items': items, 'has_more': has_more}
