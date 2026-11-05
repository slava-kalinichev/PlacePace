import requests
import math
import logging
from typing import List, Tuple

from ..config import Config

logger = logging.getLogger(__name__)


class OSRMService:
    def __init__(self):
        # Используем локальный OSRM
        self.base_url = Config.OSRM_URL
        self.public_url = "https://router.project-osrm.org"

    def get_travel_matrix(self, coords: List[Tuple[float, float]], mode: str = 'foot') -> Tuple[
        List[List[float]], List[List[float]]]:
        """Получение матрицы расстояний"""
        profile = 'foot' if mode == 'foot' else 'driving'
        locs = ';'.join([f'{lon},{lat}' for lat, lon in coords])

        # Локальный OSRM собран только под пеший профиль, для остальных профилей идёт публичный
        if profile == 'foot':
            try:
                result = self._query(self.base_url, profile, locs)
                if result:
                    return result
            except Exception as e:
                logger.warning(f"Локальный OSRM ошибка: {e}, пробуем публичный")

        # Публичный OSRM: источник для driving и запасной для foot
        try:
            result = self._query(self.public_url, profile, locs)
            if result:
                return result
        except Exception as e:
            logger.warning(f"Публичный OSRM ошибка: {e}")

        # Fallback на приблизительный расчет
        logger.warning("OSRM не доступен, используем приблизительный расчет")
        return self._calculate_approx_matrix(coords, profile)

    def _query(self, base_url, profile, locs):
        url = f"{base_url}/table/v1/{profile}/{locs}"
        response = requests.get(url, params={
            'annotations': 'distance,duration',
            'sources': 'all',
            'destinations': 'all'
        }, timeout=10)

        if response.status_code != 200:
            return None
        data = response.json()
        durations = data.get('durations')
        distances = data.get('distances')
        if not durations or not distances:
            return None
        durations = [[d if d is not None else 0 for d in row] for row in durations]
        distances = [[d if d is not None else 0 for d in row] for row in distances]
        return durations, distances

    def _calculate_approx_matrix(self, coords, profile='foot'):
        """Приблизительный расчёт по прямой с учётом скорости профиля"""
        n = len(coords)
        durations = [[0] * n for _ in range(n)]
        distances = [[0] * n for _ in range(n)]
        speed_mps = 1.39 if profile == 'foot' else 8.3  # 5 км/ч пешком, ~30 км/ч по городу на авто

        for i in range(n):
            for j in range(n):
                if i == j:
                    continue
                lat1, lon1 = coords[i]
                lat2, lon2 = coords[j]

                R = 6371000
                dlat = math.radians(lat2 - lat1)
                dlon = math.radians(lon2 - lon1)
                a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(
                    dlon / 2) ** 2
                c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
                distance = R * c

                durations[i][j] = distance / speed_mps
                distances[i][j] = distance

        return durations, distances