"""Общие экземпляры внешних сервисов"""

from .services.dgis_service import DgisService
from .services.osrm_service import OSRMService
from .services.taxi_service import YandexTaxiService
from .services.transit_service import TransitService
from .services.yandex_suggest_service import YandexSuggestService

osrm_service = OSRMService()
transit_service = TransitService()
yandex_suggest_service = YandexSuggestService()
dgis_service = DgisService()
yandex_taxi_service = YandexTaxiService()
