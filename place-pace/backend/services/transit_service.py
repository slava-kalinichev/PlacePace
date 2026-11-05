import logging
import threading
import time
from datetime import datetime

import requests

from ..config import Config

logger = logging.getLogger(__name__)

PLAN_QUERY_TEMPLATE = """
query Plan($originLat: CoordinateValue!, $originLon: CoordinateValue!, $destLat: CoordinateValue!, $destLon: CoordinateValue!, $earliestDeparture: OffsetDateTime!) {{
  planConnection(
    origin: {{ location: {{ coordinate: {{ latitude: $originLat, longitude: $originLon }} }} }}
    destination: {{ location: {{ coordinate: {{ latitude: $destLat, longitude: $destLon }} }} }}
    dateTime: {{ earliestDeparture: $earliestDeparture }}
    modes: {{ transitOnly: true{mode_filter} }}
  ) {{
    edges {{
      node {{
        duration
        legs {{
          mode
          duration
          from {{ name }}
          to {{ name }}
          route {{ shortName longName agency {{ name }} }}
        }}
      }}
    }}
  }}
}}
"""

# Запрос без фильтра видов транспорта
PLAN_QUERY = PLAN_QUERY_TEMPLATE.format(mode_filter='')

# Метро и МЦК - одно агентство, МЦД - отдельное
METRO_AGENCY_NAME = 'Московский метрополитен'
MCD_AGENCY_NAME = 'Московские центральные диаметры'

# OTP-режимы, нужные для поиска плеч каждого семейства
FAMILY_OTP_MODES = {
    'metro': {'SUBWAY', 'RAIL'},
    'mcd': {'RAIL'},
    'bus': {'BUS'},
    'tram': {'TRAM'},
}


def leg_family(leg):
    """Семейство транспорта плеча: metro, mcd, bus, tram, walk, ferry"""
    mode = leg.get('mode')
    if mode == 'WALK':
        return 'walk'
    if mode == 'SUBWAY':
        return 'metro'
    if mode == 'RAIL':
        return 'mcd' if leg.get('agency') == MCD_AGENCY_NAME else 'metro'
    if mode == 'BUS':
        return 'bus'
    if mode == 'TRAM':
        return 'tram'
    if mode == 'FERRY':
        return 'ferry'
    return None


def _build_modes_query(otp_modes):
    if not otp_modes:
        return PLAN_QUERY
    mode_list = ', '.join(f'{{mode: {m}}}' for m in sorted(otp_modes))
    return PLAN_QUERY_TEMPLATE.format(mode_filter=f', transit: {{ transit: [{mode_list}] }}')


# Таймауты OTP (сек): тяжёлые пары считаются ~13 с, общий бюджет задают gunicorn и nginx
OTP_CONNECT_TIMEOUT_S = 5
OTP_READ_TIMEOUT_S = 40


class TransitService:
    """Обёртка над GraphQL API OpenTripPlanner (метро/МЦК/МЦД/автобус/трамвай)."""

    def __init__(self):
        self.base_url = Config.OTP_URL
        # Флаг сбоя последнего запроса в этом потоке (сбой не кэшируем как "транспорта нет")
        self._local = threading.local()

    def last_query_failed(self):
        return getattr(self._local, 'failed', False)

    def _query_otp(self, query, origin, dest, date, time_str):
        """Запрос в OTP с повторами; список edges или None"""
        date = date or datetime.now().strftime("%Y-%m-%d")
        time_str = time_str or datetime.now().strftime("%H:%M")
        earliest_departure = f"{date}T{time_str}:00+03:00"

        variables = {
            "originLat": origin[0], "originLon": origin[1],
            "destLat": dest[0], "destLon": dest[1],
            "earliestDeparture": earliest_departure,
        }
        # Повторяем при сбое сети, таймауте и временных ошибках GraphQL
        self._local.failed = False
        for attempt in range(3):
            try:
                r = requests.post(
                    f"{self.base_url}/otp/gtfs/v1",
                    json={"query": query, "variables": variables},
                    timeout=(OTP_CONNECT_TIMEOUT_S, OTP_READ_TIMEOUT_S),
                )
                if r.status_code != 200:
                    logger.warning(f"OTP HTTP {r.status_code} для {origin} -> {dest} (попытка {attempt + 1})")
                    self._local.failed = True
                    continue
                data = r.json()
                if data.get("errors"):
                    logger.warning(f"OTP GraphQL ошибка для {origin} -> {dest} (попытка {attempt + 1}): {data['errors']}")
                    self._local.failed = True
                    continue
                found = (data.get("data") or {}).get("planConnection", {}).get("edges", [])
                if not found:
                    # Пустой ответ может быть временным сбоем
                    self._local.failed = False
                    continue
                self._local.failed = False
                return found
            except requests.ReadTimeout as e:
                # Таймаут чтения: повтор не поможет, сразу сдаёмся
                logger.warning(f"OTP не ответил за {OTP_READ_TIMEOUT_S} с для {origin} -> {dest}: {e}")
                self._local.failed = True
                return None
            except requests.RequestException as e:
                logger.warning(f"OTP недоступен для {origin} -> {dest} (попытка {attempt + 1}): {e}")
                self._local.failed = True
            if attempt < 2:
                time.sleep(0.4 * (attempt + 1))
        return None

    @staticmethod
    def _itinerary_to_legs(itin):
        legs = []
        for leg in itin.get("legs", []):
            route = leg.get("route") or {}
            agency = route.get("agency") or {}
            legs.append({
                "mode": leg.get("mode"),
                "route": route.get("shortName") or "",
                "agency": agency.get("name"),
                "from": (leg.get("from") or {}).get("name"),
                "to": (leg.get("to") or {}).get("name"),
                "duration_s": leg.get("duration", 0),
            })
        return legs

    def get_pool_route(self, origin, dest, allowed_families, require_pure=False, date=None, time_str=None):
        """Лучший маршрут по разрешённым семействам транспорта (require_pure - без смешивания)"""
        otp_modes = set()
        for fam in allowed_families:
            otp_modes |= FAMILY_OTP_MODES.get(fam, set())
        query = _build_modes_query(otp_modes)
        edges = self._query_otp(query, origin, dest, date, time_str)
        if not edges:
            return None

        def _itin_families(itin):
            return {leg_family(leg) for leg in itin.get('legs', []) if leg.get('mode') != 'WALK'}

        candidates = []
        for e in edges:
            itin = e['node']
            fams = _itin_families(itin)
            # Пустой набор семейств - чисто пеший вариант, не годится
            if not fams or not fams.issubset(allowed_families):
                continue
            if require_pure and len(fams) > 1:
                continue
            candidates.append(itin)
        if not candidates:
            return None

        # Берём самый быстрый вариант, а не с минимальной обобщённой стоимостью OTP
        itin = min(candidates, key=lambda n: n.get("duration", float("inf")))
        return {
            "duration_seconds": itin.get("duration", 0),
            "legs": self._itinerary_to_legs(itin),
        }
