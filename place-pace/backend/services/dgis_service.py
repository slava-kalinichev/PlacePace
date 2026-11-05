import re
import threading
import time
import requests
import logging
from datetime import date

from ..config import Config

logger = logging.getLogger(__name__)

# Пауза после отказа по ключу, чтобы не слать запросы с недействительным ключом
_KEY_ERROR_COOLDOWN_SECONDS = 30 * 60


class _RequestBudget:
    """Предохранитель квоты 2GIS: суточный лимит запросов и пауза после ошибки ключа"""

    def __init__(self):
        self._lock = threading.Lock()
        self._day = date.today()
        self._used = 0
        self._blocked_until = 0.0

    def acquire(self) -> bool:
        with self._lock:
            today = date.today()
            if today != self._day:
                self._day, self._used = today, 0
            if time.time() < self._blocked_until:
                return False
            if self._used >= Config.DGIS_DAILY_REQUEST_LIMIT:
                logger.warning("2GIS: суточный лимит запросов исчерпан (%s)",
                               Config.DGIS_DAILY_REQUEST_LIMIT)
                return False
            self._used += 1
            return True

    def block(self, reason: str):
        with self._lock:
            self._blocked_until = time.time() + _KEY_ERROR_COOLDOWN_SECONDS
        logger.warning("2GIS: ошибка ключа (%s) - запросы приостановлены на %s мин",
                       reason, _KEY_ERROR_COOLDOWN_SECONDS // 60)

    def is_available(self) -> bool:
        """Можно ли сейчас рассчитывать на ответ 2GIS (запрос не тратится)"""
        with self._lock:
            return time.time() >= self._blocked_until and self._used < Config.DGIS_DAILY_REQUEST_LIMIT


_budget = _RequestBudget()

# Дни недели в порядке выдачи 2GIS
_WEEKDAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
_WEEKDAY_RU_SHORT = {'Mon': 'Пн', 'Tue': 'Вт', 'Wed': 'Ср', 'Thu': 'Чт', 'Fri': 'Пт', 'Sat': 'Сб', 'Sun': 'Вс'}


def _format_schedule(schedule: dict | None) -> str:
    """Часы работы одной строкой: "HH:MM-HH:MM" или по группам дней"""
    if not schedule:
        return '-'

    def _hours_for(day):
        day_info = schedule.get(day)
        if not day_info or not day_info.get('working_hours'):
            return None
        wh = day_info['working_hours'][0]
        return f"{wh.get('from', '')}-{wh.get('to', '')}"

    hours_by_day = {d: _hours_for(d) for d in _WEEKDAY_KEYS}
    distinct_hours = set(h for h in hours_by_day.values() if h)
    if not distinct_hours:
        return '-'
    if len(distinct_hours) == 1:
        return next(iter(distinct_hours))

    weekday_hours = set(hours_by_day[d] for d in _WEEKDAY_KEYS[:5] if hours_by_day[d])
    weekend_hours = set(hours_by_day[d] for d in _WEEKDAY_KEYS[5:] if hours_by_day[d])
    if len(weekday_hours) == 1 and len(weekend_hours) == 1:
        return f"Пн-Пт {next(iter(weekday_hours))}, Сб-Вс {next(iter(weekend_hours))}"

    first_day = next(d for d in _WEEKDAY_KEYS if hours_by_day[d])
    return f"{_WEEKDAY_RU_SHORT[first_day]} {hours_by_day[first_day]}"


def _normalize_schedule(schedule: dict | None) -> dict | None:
    """Сырое расписание 2GIS -> {"Mon": {"from", "to"}, ..., "comment"}"""
    if not schedule:
        return None
    normalized = {}
    if schedule.get('is_24x7'):
        # Круглосуточно все дни - 2GIS отдаёт флаг, а не часы по дням
        for day in _WEEKDAY_KEYS:
            normalized[day] = {'from': '00:00', 'to': '24:00'}
        if schedule.get('comment'):
            normalized['comment'] = schedule['comment']
        return normalized
    for day in _WEEKDAY_KEYS:
        day_info = schedule.get(day)
        if not day_info or not day_info.get('working_hours'):
            continue
        wh = day_info['working_hours'][0]
        if wh.get('from') and wh.get('to'):
            normalized[day] = {'from': wh['from'], 'to': wh['to']}
    comment = schedule.get('comment')
    if comment:
        normalized['comment'] = comment
    return normalized or None


def _collapse_schedule_to_range(schedule: dict | None) -> str:
    """Расписание -> строка "HH:MM-HH:MM" для солвера и фронтенда"""
    if not schedule:
        return '-'

    def _range_for(day):
        info = schedule.get(day)
        return f"{info['from']}-{info['to']}" if info else None

    weekday_ranges = [_range_for(d) for d in _WEEKDAY_KEYS[:5]]
    weekend_ranges = [_range_for(d) for d in _WEEKDAY_KEYS[5:]]
    all_ranges = [r for r in weekday_ranges + weekend_ranges if r]
    if not all_ranges:
        return '-'
    if all(r == all_ranges[0] for r in all_ranges):
        rng = all_ranges[0]
        return 'Круглосуточно' if rng in ('00:00-23:59', '00:00-24:00') else rng

    present_weekday_ranges = [r for r in weekday_ranges if r]
    pool = present_weekday_ranges or [r for r in weekend_ranges if r]
    return max(set(pool), key=pool.count)


def _extract_rubric_ids(rubrics: list | None) -> list[str]:
    return [r['id'] for r in (rubrics or []) if r.get('id')]


_AVG_PRICE_RE = re.compile(r'(\d[\d\s\xa0]*)')


def _parse_avg_check(attribute_groups: list | None) -> int | None:
    """Средний чек из атрибута food_service_avg_price (или None)"""
    for group in attribute_groups or []:
        for attr in group.get('attributes', []):
            if attr.get('tag') == 'food_service_avg_price':
                match = _AVG_PRICE_RE.search(attr.get('name', ''))
                if match:
                    digits = match.group(1).replace(' ', '').replace('\xa0', '')
                    if digits.isdigit():
                        return int(digits)
    return None


def _parse_cuisine(attribute_groups: list | None) -> str | None:
    """Кухня из атрибутов food_service_food_*"""
    names = []
    for group in attribute_groups or []:
        for attr in group.get('attributes', []):
            tag = attr.get('tag', '')
            if tag.startswith('food_service_food_'):
                name = attr.get('name')
                if name:
                    names.append(name)
    return ', '.join(names) if names else None


def _name_tokens(name: str) -> set:
    """Значимые слова названия (первые 5 букв) для сопоставления с 2GIS"""
    return {w[:5] for w in re.findall(r'[а-яёa-z0-9]+', name.lower()) if len(w) >= 4}


_FAST_FOOD_RUBRIC_KEYWORDS = (
    'быстрое питание', 'быстрого', 'фастфуд', 'фаст-фуд', 'фудкорт', 'фуд-корт',
    'пицц', 'шаурм', 'бургер', 'стрит-фуд', 'стритфуд',
)
# Известные сети быстрого питания (нижний регистр)
_FAST_FOOD_CHAINS = (
    'вкусно и точка', 'макдоналдс', 'mcdonald', 'ростик', 'rostic', 'kfc',
    'бургер кинг', 'burger king', 'теремок', 'subway', 'крошка картошка',
    'додо пицца', 'dodo pizza', 'папа джонс', 'papa john', 'доминос', 'domino',
    'му му', 'стардогс', 'starbucks', 'wendy', 'шаурма',
)
_NAME_NOISE_RE = re.compile(r'[^a-zа-я0-9]+')


def _normalize_name(name: str | None) -> str:
    """Название для сравнения: регистр, ё/е и пунктуация нормализованы"""
    return _NAME_NOISE_RE.sub(' ', (name or '').lower().replace('ё', 'е')).strip()


def _is_fast_food_chain(name: str | None) -> bool:
    normalized = _normalize_name(name)
    return any(chain in normalized for chain in _FAST_FOOD_CHAINS)


def _is_fast_food(name: str | None, rubrics: list | None, strict: bool = False) -> bool:
    """Фастфуд по рубрикам или названию сети; без рубрик не отсекаем"""
    if _is_fast_food_chain(name):
        return True
    names = [(r.get('name') or '').lower() for r in (rubrics or [])]
    if not names:
        # Для поиска конкретной сети без рубрик заведение не подходит
        return not strict
    return any(keyword in n for n in names for keyword in _FAST_FOOD_RUBRIC_KEYWORDS)


class DgisService:
    """Поиск ресторанов и кафе через 2GIS Каталог API (без собственной базы)"""

    SEARCH_URL = 'https://catalog.api.2gis.com/3.0/items'

    def __init__(self):
        self.api_key = Config.DGIS_CATALOG_API_KEY

    def search(self, lat: float, lon: float, radius_m: int = 900, limit: int = 10,
               fast_food: bool = False, chain: str | None = None):
        """fast_food - дополнительный запрос "быстрое питание"; chain - поиск конкретной сети по названию"""
        fast_food = fast_food or bool(chain)
        if not self.api_key:
            logger.warning("2GIS: DGIS_CATALOG_API_KEY не задан")
            return None
        if not _budget.acquire():
            return None
        try:
            response = requests.get(self.SEARCH_URL, params={
                'key': self.api_key,
                # Свободный текст вместо rubric_id; type=branch отсекает районы и города
                'q': chain or ('быстрое питание' if fast_food else 'кафе ресторан'),
                'location': f'{lon},{lat}',
                'radius': radius_m,
                'type': 'branch',
                'sort': 'distance',
                # Явная локаль, иначе приходят английские названия
                'locale': 'ru_RU',
                # page_size API ограничен 1..10 (ошибка приходит внутри meta)
                'page_size': 10 if fast_food else max(1, min(10, limit)),
                'fields': 'items.point,items.address_name,items.reviews,items.schedule,items.attribute_groups,items.rubrics',
            }, timeout=8)
            if response.status_code != 200:
                logger.warning(f"2GIS search HTTP {response.status_code}: {response.text[:200]}")
                return None
            data = response.json()
        except requests.RequestException as e:
            logger.warning(f"2GIS search ошибка запроса: {e}")
            return None
        except ValueError as e:
            logger.warning(f"2GIS search некорректный JSON: {e}")
            return None

        meta = data.get('meta') or {}
        if meta.get('code') != 200:
            logger.warning(f"2GIS search API ошибка: {meta.get('error')}")
            return None

        items = (data.get('result') or {}).get('items') or []
        results = []
        for it in items:
            point = it.get('point')
            if not point or 'lat' not in point or 'lon' not in point:
                continue
            if fast_food and not _is_fast_food(it.get('name'), it.get('rubrics'), strict=bool(chain)):
                continue
            if chain and _normalize_name(chain) not in _normalize_name(it.get('name')):
                continue
            reviews = it.get('reviews') or {}
            results.append({
                '_chain': fast_food and _is_fast_food_chain(it.get('name')),
                'id': it.get('id'),
                'name': it.get('name') or 'Без названия',
                'address': it.get('address_name') or 'Адрес не указан',
                'workTime': _format_schedule(it.get('schedule')),
                'rating': reviews.get('general_rating'),
                'avgCheck': _parse_avg_check(it.get('attribute_groups')),
                # У фастфуда кухни обычно нет
                'cuisine': _parse_cuisine(it.get('attribute_groups')) or ('Фастфуд' if fast_food else None),
                'lat': point['lat'],
                'lon': point['lon'],
            })
        if fast_food:
            # Сети выше мелких кафе
            results.sort(key=lambda r: not r['_chain'])
            results = results[:max(1, limit)]
        for r in results:
            r.pop('_chain', None)
        return results

    def search_attractions(self, rubric_ids: list | None, query: str | None = None, page: int = 1):
        """Живой поиск достопримечательностей в 2GIS (без кэша и сохранения)"""
        if not self.api_key:
            return None
        if not _budget.acquire():
            return None
        params = {
            'key': self.api_key,
            'viewpoint1': Config.DGIS_SEARCH_VIEWPOINT1,
            'viewpoint2': Config.DGIS_SEARCH_VIEWPOINT2,
            # С рубриками - только организации, по тексту - ещё и здания
            'type': 'branch' if rubric_ids else Config.DGIS_TEXT_SEARCH_TYPES,
            # Явная локаль, иначе приходят английские названия
            'locale': 'ru_RU',
            'page': page,
            'page_size': 10,
            'fields': 'items.point,items.address_name,items.schedule,items.rubrics',
        }
        if rubric_ids:
            params['rubric_id'] = ','.join(rubric_ids)
        if query:
            params['q'] = query
        try:
            response = requests.get(self.SEARCH_URL, params=params, timeout=8)
            if response.status_code in (401, 403):
                _budget.block(f"HTTP {response.status_code}")
                return None
            if response.status_code != 200:
                logger.warning(f"2GIS search_attractions HTTP {response.status_code}: {response.text[:200]}")
                return None
            data = response.json()
        except requests.RequestException as e:
            logger.warning(f"2GIS search_attractions ошибка запроса: {e}")
            return None
        except ValueError as e:
            logger.warning(f"2GIS search_attractions некорректный JSON: {e}")
            return None

        meta = data.get('meta') or {}
        if meta.get('code') == 404:
            return {'items': [], 'total': 0}
        if meta.get('code') != 200:
            error = meta.get('error')
            if meta.get('code') in (401, 403) or 'apikey' in str(error).lower():
                _budget.block(str(error)[:100])
            else:
                logger.warning(f"2GIS search_attractions API ошибка: {error}")
            return None

        result = data.get('result') or {}
        parsed = []
        for it in result.get('items') or []:
            point = it.get('point')
            if not point or 'lat' not in point or 'lon' not in point:
                continue
            parsed.append({
                'id': it.get('id'),
                'name': it.get('name') or 'Без названия',
                'address': it.get('address_name') or None,
                'schedule': _normalize_schedule(it.get('schedule')),
                'rubric_ids': _extract_rubric_ids(it.get('rubrics')),
                'lat': point['lat'],
                'lon': point['lon'],
            })
        return {'items': parsed, 'total': result.get('total', len(parsed))}

    @staticmethod
    def is_available() -> bool:
        """Можно ли рассчитывать на 2GIS сейчас (ключ, лимит, пауза)"""
        return bool(Config.DGIS_CATALOG_API_KEY) and _budget.is_available()

    def lookup_schedule(self, name: str, lat: float, lon: float):
        """Расписание ручной точки из 2GIS или None"""
        if not self.api_key or not name:
            return None
        if not _budget.acquire():
            return None
        try:
            response = requests.get(self.SEARCH_URL, params={
                'key': self.api_key,
                'q': name,
                'location': f'{lon},{lat}',
                'radius': 400,
                'type': 'branch,building,attraction',
                'locale': 'ru_RU',
                'page_size': 5,
                'fields': 'items.point,items.schedule',
            }, timeout=8)
            if response.status_code in (401, 403):
                _budget.block(f"HTTP {response.status_code}")
                return None
            if response.status_code != 200:
                return None
            data = response.json()
        except (requests.RequestException, ValueError):
            return None

        meta = data.get('meta') or {}
        if meta.get('code') != 200:
            if meta.get('code') in (401, 403) or 'apikey' in str(meta.get('error')).lower():
                _budget.block(str(meta.get('error'))[:100])
            return None

        # Выбираем самый похожий объект по словам названия, при равенстве - ближайший
        wanted = _name_tokens(name)
        best, best_key = None, None
        for it in (data.get('result') or {}).get('items') or []:
            point = it.get('point')
            schedule = _normalize_schedule(it.get('schedule'))
            if not point or not schedule:
                continue
            tokens = _name_tokens(it.get('name') or '')
            common = wanted & tokens
            if not common:
                continue
            similarity = len(common) / len(wanted | tokens)
            distance = (point['lat'] - lat) ** 2 + (point['lon'] - lon) ** 2
            key = (-similarity, distance)
            if best_key is None or key < best_key:
                best, best_key = schedule, key
        return best
