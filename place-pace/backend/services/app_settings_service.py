"""Общие настройки проекта (одна строка в БД)"""

from ..models import AppSettings, db


def load_app_settings():
    """Единственная строка AppSettings (создаётся при первом обращении)"""
    settings = AppSettings.query.first()
    if not settings:
        settings = AppSettings(map_enabled=True, require_email_verification=True, route_mini_map_enabled=True)
        db.session.add(settings)
        db.session.commit()
    return settings


def app_settings_dict(settings):
    return {
        'map_enabled': settings.map_enabled,
        'route_mini_map_enabled': settings.route_mini_map_enabled,
        'require_email_verification': settings.require_email_verification,
    }
