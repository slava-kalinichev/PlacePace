"""Короткие адреса из ответов Яндекс Геокодера"""

from ..extensions import yandex_suggest_service


def reverse_address(lat, lon):
    """Адрес по координатам через Яндекс или None"""
    data = yandex_suggest_service.reverse_geocode(lat, lon)
    try:
        members = data['response']['GeoObjectCollection']['featureMember']
        components = members[0]['GeoObject']['metaDataProperty']['GeocoderMetaData']['Address']['Components']
    except (KeyError, IndexError, TypeError):
        return None
    return short_terminal_address(components) or None


def short_terminal_address(components):
    """Короткий адрес: улица и дом, город только если не Москва"""
    by_kind = {}
    for c in components:
        kind, name = c.get('kind'), c.get('name')
        if kind and name and kind not in by_kind:
            by_kind[kind] = name

    street_house = ', '.join(p for p in (by_kind.get('street'), by_kind.get('house')) if p)
    locality = by_kind.get('locality')

    if locality and locality != 'Москва':
        return f"{locality}, {street_house}" if street_house else locality
    return street_house or locality or ''
