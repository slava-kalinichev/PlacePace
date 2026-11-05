"""Подсказки и разрешение адресов (Яндекс)"""

import logging
from flask import jsonify, request
from ..extensions import yandex_suggest_service
from ..services.address_service import short_terminal_address
from .blueprint import api_bp

logger = logging.getLogger(__name__)


ALLOWED_TERMINAL_PROVINCES = {'Москва', 'Московская область'}
MOSCOW_REGION_BBOX = {'lat_min': 54.2, 'lat_max': 56.95, 'lon_min': 35.1, 'lon_max': 40.3}


@api_bp.route('/geosuggest', methods=['GET'])
def geosuggest():
    # Подсказки (Яндекс Геосаджест)
    text = (request.args.get('text') or '').strip()
    if len(text) < 3:
        return jsonify({'results': []}), 200

    data = yandex_suggest_service.suggest(text)
    if data is None:
        return jsonify({'results': [], 'error': 'Сервис подсказок адресов временно недоступен'}), 200

    results = [
        {
            'title': (item.get('title') or {}).get('text', ''),
            'subtitle': (item.get('subtitle') or {}).get('text', ''),
        }
        for item in data.get('results', [])
    ]

    return jsonify({'results': results}), 200


@api_bp.route('/geosuggest/resolve', methods=['GET'])
def geosuggest_resolve():
    """Адрес выбранной подсказки -> координаты и короткий адрес (Яндекс Геокодер)"""
    text = (request.args.get('text') or '').strip()
    if not text:
        return jsonify({'error': 'text обязателен'}), 400

    data = yandex_suggest_service.geocode(text)
    if not data:
        return jsonify({'error': 'Не удалось определить координаты адреса'}), 502

    try:
        feature_member = data['response']['GeoObjectCollection']['featureMember']
        if not feature_member:
            return jsonify({'error': 'Адрес не найден'}), 502
        geo_object = feature_member[0]['GeoObject']
        lon_str, lat_str = geo_object['Point']['pos'].split(' ')
        lon, lat = float(lon_str), float(lat_str)
        geocoder_meta = geo_object.get('metaDataProperty', {}).get('GeocoderMetaData', {})
        components = geocoder_meta.get('Address', {}).get('Components', [])
    except (KeyError, IndexError, TypeError, ValueError):
        logger.error(f"Некорректный ответ Yandex geocode для text={text}: {data}")
        return jsonify({'error': 'Некорректный ответ геокодера'}), 502

    provinces = {c.get('name') for c in components if c.get('kind') == 'province'}
    if provinces:
        in_region = bool(provinces & ALLOWED_TERMINAL_PROVINCES)
    else:
        in_region = (
            MOSCOW_REGION_BBOX['lat_min'] <= lat <= MOSCOW_REGION_BBOX['lat_max']
            and MOSCOW_REGION_BBOX['lon_min'] <= lon <= MOSCOW_REGION_BBOX['lon_max']
        )
    if not in_region:
        return jsonify({'error': 'Данный адрес за пределами МО'}), 422

    if not any(c.get('kind') == 'house' for c in components):
        return jsonify({'error': 'Укажите адрес дома'}), 422

    address = short_terminal_address(components) or text
    return jsonify({'address': address, 'lat': lat, 'lon': lon}), 200
