# Проверка работы и общие настройки проекта

from flask import jsonify, request
from ..models import db
from ..services.app_settings_service import app_settings_dict, load_app_settings
from .auth import get_current_user
from .blueprint import api_bp


@api_bp.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'message': 'Place Pace API is running'})


@api_bp.route('/app-settings', methods=['GET'])
def get_app_settings():
    """Публичные настройки проекта"""
    settings = load_app_settings()
    return jsonify(app_settings_dict(settings))


@api_bp.route('/app-settings', methods=['POST'])
def update_app_settings():
    """Изменение общих настроек (только админ)"""
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Доступно только администраторам'}), 403

    data = request.json or {}
    settings = load_app_settings()
    if 'map_enabled' in data:
        settings.map_enabled = bool(data['map_enabled'])
    if 'route_mini_map_enabled' in data:
        settings.route_mini_map_enabled = bool(data['route_mini_map_enabled'])
    if 'require_email_verification' in data:
        settings.require_email_verification = bool(data['require_email_verification'])
    db.session.commit()

    return jsonify(app_settings_dict(settings))
