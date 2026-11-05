import requests
import logging
import threading
from datetime import date

from ..config import Config

logger = logging.getLogger(__name__)

_reverse_lock = threading.Lock()
_reverse_state = {'day': date.today(), 'used': 0}


def _reverse_budget_ok() -> bool:
    """Суточный лимит обратного геокодирования (защита квоты)"""
    with _reverse_lock:
        today = date.today()
        if _reverse_state['day'] != today:
            _reverse_state['day'], _reverse_state['used'] = today, 0
        if _reverse_state['used'] >= Config.YANDEX_REVERSE_GEOCODE_DAILY_LIMIT:
            logger.warning("Yandex reverse geocode: суточный лимит исчерпан (%s)",
                           Config.YANDEX_REVERSE_GEOCODE_DAILY_LIMIT)
            return False
        _reverse_state['used'] += 1
        return True


class YandexSuggestService:
    """Подсказки адресов (Геосаджест) и их разрешение в координаты (Геокодер) - два продукта Яндекса с разными ключами"""

    SUGGEST_URL = 'https://suggest-maps.yandex.ru/v1/suggest'
    GEOCODER_URL = 'https://geocode-maps.yandex.ru/1.x/'

    def __init__(self):
        self.suggest_api_key = Config.YANDEX_SUGGEST_API_KEY
        self.geocoder_api_key = Config.YANDEX_GEOCODER_API_KEY
        self.headers = {'Referer': Config.YANDEX_API_REFERER}

    def suggest(self, text: str, results: int = 5):
        if not self.suggest_api_key or not text:
            return None
        try:
            response = requests.get(self.SUGGEST_URL, params={
                'apikey': self.suggest_api_key,
                'text': text,
                'lang': 'ru_RU',
                'results': results,
                'types': 'geo',
                'print_address': 1,
                # Мягкое смещение к Москве без strict_bounds, чтобы не отрезать адреса области
                'll': '37.6173,55.7558',
                'spn': '4,3',
            }, headers=self.headers, timeout=5)
            if response.status_code != 200:
                logger.warning(f"Yandex suggest HTTP {response.status_code}: {response.text[:200]}")
                return None
            return response.json()
        except requests.RequestException as e:
            logger.warning(f"Yandex suggest ошибка запроса: {e}")
            return None
        except ValueError as e:
            logger.warning(f"Yandex suggest некорректный JSON: {e}")
            return None

    def geocode(self, text: str):
        if not self.geocoder_api_key or not text:
            return None
        try:
            response = requests.get(self.GEOCODER_URL, params={
                'apikey': self.geocoder_api_key,
                'geocode': text,
                'lang': 'ru_RU',
                'format': 'json',
                'results': 1,
            }, headers=self.headers, timeout=5)
            if response.status_code != 200:
                logger.warning(f"Yandex geocode HTTP {response.status_code}: {response.text[:200]}")
                return None
            return response.json()
        except requests.RequestException as e:
            logger.warning(f"Yandex geocode ошибка запроса: {e}")
            return None
        except ValueError as e:
            logger.warning(f"Yandex geocode некорректный JSON: {e}")
            return None

    def reverse_geocode(self, lat: float, lon: float):
        """Адрес по координатам (ближайший дом); None при ошибке или превышении лимита"""
        if not self.geocoder_api_key:
            return None
        if not _reverse_budget_ok():
            return None
        try:
            response = requests.get(self.GEOCODER_URL, params={
                'apikey': self.geocoder_api_key,
                'geocode': f'{lon},{lat}',
                'kind': 'house',
                'lang': 'ru_RU',
                'format': 'json',
                'results': 1,
            }, headers=self.headers, timeout=5)
            if response.status_code != 200:
                logger.warning(f"Yandex reverse geocode HTTP {response.status_code}: {response.text[:200]}")
                return None
            return response.json()
        except requests.RequestException as e:
            logger.warning(f"Yandex reverse geocode ошибка запроса: {e}")
            return None
        except ValueError as e:
            logger.warning(f"Yandex reverse geocode некорректный JSON: {e}")
            return None
