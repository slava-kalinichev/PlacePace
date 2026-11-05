import requests
import logging

from ..config import Config

logger = logging.getLogger(__name__)


class YandexTaxiService:
    """Стоимость и время такси через Яндекс Go Trip Info API"""

    TRIP_INFO_URL = 'https://taxi-routeinfo.taxi.yandex.net/taxi_info'

    # Наши тарифы -> классы Яндекс Go
    TARIFF_CLASS_MAP = {
        'economy': 'econom',
        'comfort': 'comfortplus',
        'business': 'business',
    }

    def __init__(self):
        self.clid = Config.YANDEX_TAXI_CLID
        self.api_key = Config.YANDEX_TAXI_API_KEY

    def get_trip_info(self, from_lat, from_lon, to_lat, to_lon, tariff='economy'):
        """(цена в рублях, время в секундах) поездки или None, если API недоступен"""
        if not self.clid or not self.api_key:
            return None

        yandex_class = self.TARIFF_CLASS_MAP.get(tariff, 'econom')
        # rll: "долгота,широта~долгота,широта"
        rll = f'{from_lon},{from_lat}~{to_lon},{to_lat}'

        try:
            response = requests.get(self.TRIP_INFO_URL, params={
                'rll': rll,
                'clid': self.clid,
                'class': yandex_class,
            }, headers={
                # Ключ передаётся заголовком, чтобы не попадать в логи
                'YaTaxi-Api-Key': self.api_key,
                'Accept': 'application/json',
            }, timeout=6)
        except requests.RequestException as e:
            logger.warning(f"Яндекс Go Trip Info ошибка запроса: {e}")
            return None

        if response.status_code == 204:
            logger.warning("Яндекс Go Trip Info: регион не поддерживается сервисами Яндекс Go")
            return None
        if response.status_code != 200:
            logger.warning(f"Яндекс Go Trip Info HTTP {response.status_code}: {response.text[:200]}")
            return None

        try:
            data = response.json()
        except ValueError as e:
            logger.warning(f"Яндекс Go Trip Info некорректный JSON: {e}")
            return None

        options = data.get('options') or []
        option = next((o for o in options if o.get('class_name') == yandex_class), None)
        if not option or option.get('price') is None:
            logger.warning(f"Яндекс Go Trip Info: нет опции для класса {yandex_class}")
            return None

        # Время поездки может отсутствовать в ответе
        return round(option['price']), data.get('time')
