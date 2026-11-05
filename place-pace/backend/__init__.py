from flask import Flask
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from .config import Config
from .models import db


# Колонки, добавленные после первого create_all() (миграций нет, ALTER идемпотентные)
_USERS_NEW_COLUMNS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'ru'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS default_taxi_tariff VARCHAR(16) NOT NULL DEFAULT 'economy'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS walk_distance_limit_m INTEGER NOT NULL DEFAULT 800",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS account_confirmed BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email VARCHAR(200)",]
_APP_SETTINGS_NEW_COLUMNS = [
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS require_email_verification BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS route_mini_map_enabled BOOLEAN NOT NULL DEFAULT TRUE",]
_ROUTES_NEW_COLUMNS = [
    "ALTER TABLE routes ADD COLUMN IF NOT EXISTS title_lang VARCHAR(2)",
    "ALTER TABLE routes ADD COLUMN IF NOT EXISTS title_translated TEXT",
    "ALTER TABLE routes ADD COLUMN IF NOT EXISTS description_lang VARCHAR(2)",
    "ALTER TABLE routes ADD COLUMN IF NOT EXISTS description_translated TEXT",
]


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    CORS(app, origins=app.config['CORS_ORIGINS'], supports_credentials=True)
    db.init_app(app)
    with app.app_context():
        db.create_all()
        for stmt in _USERS_NEW_COLUMNS + _APP_SETTINGS_NEW_COLUMNS + _ROUTES_NEW_COLUMNS:
            db.session.execute(text(stmt))
        db.session.commit()

    from .routes import api_bp
    app.register_blueprint(api_bp, url_prefix='/api')

    # Фоновый прогрев кэша транспорта для каталога мест
    from .services.transit_cache_warmer import warm_transit_cache
    warm_transit_cache(app)
    return app