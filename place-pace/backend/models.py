from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Place(db.Model):
    __tablename__ = 'places'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    address = db.Column(db.String(300))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    category = db.Column(db.String(100))
    work_time = db.Column(db.String(100))
    ticket_price = db.Column(db.Float, default=0)
    recommended_duration = db.Column(db.Integer, default=60)
    image_url = db.Column(db.String(500))
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Route(db.Model):
    __tablename__ = 'routes'

    id = db.Column(db.Integer, primary_key=True)
    # UUID с клиента для ссылки /route/<public_id>
    public_id = db.Column(db.String(36), unique=True, index=True, nullable=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    # Оригинал названия и описания, их язык и автоперевод
    title_lang = db.Column(db.String(2), nullable=True)
    title_translated = db.Column(db.Text, nullable=True)
    description_lang = db.Column(db.String(2), nullable=True)
    description_translated = db.Column(db.Text, nullable=True)

    # Пользователь
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)  # NULL = гость
    user_name = db.Column(db.String(100), default='Guest')  # для отображения

    # Параметры маршрута
    start_point = db.Column(db.String(300))
    end_point = db.Column(db.String(300))
    date = db.Column(db.Date)
    start_time = db.Column(db.Time)
    end_time = db.Column(db.Time)
    people_count = db.Column(db.Integer, default=1)

    # Снимок точек, транспорта, времени и стоимости (виден создателю)
    total_duration = db.Column(db.Integer)
    total_cost = db.Column(db.Float, default=0)
    route_data = db.Column(db.JSON)
    # Состояние автонастройки транспорта, с которым построен маршрут
    transport_options = db.Column(db.JSON, nullable=True)

    # Версия для остальных пользователей (без приватных терминалов)
    route_data_public = db.Column(db.JSON, nullable=True)
    total_duration_public = db.Column(db.Integer, nullable=True)
    total_cost_public = db.Column(db.Float, nullable=True)

    cover_image = db.Column(db.Text, nullable=True)  # data URL обложки

    # Социальные метрики
    stars_count = db.Column(db.Integer, default=0)
    views_count = db.Column(db.Integer, default=0)

    # Статус
    is_public = db.Column(db.Boolean, default=False)
    is_featured = db.Column(db.Boolean, default=False)
    # Что видят не-создатели: 'full' или 'points_only'
    display_mode = db.Column(db.String(20), default='full')

    # Рекомендованный маршрут администратора
    is_recommended = db.Column(db.Boolean, default=False)

    # Временные метки
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Связи
    user = db.relationship('User', backref='routes')


class RoutePlace(db.Model):
    __tablename__ = 'route_places'

    id = db.Column(db.Integer, primary_key=True)
    route_id = db.Column(db.Integer, db.ForeignKey('routes.id'), nullable=False)
    place_id = db.Column(db.Integer, db.ForeignKey('places.id'), nullable=False)
    order = db.Column(db.Integer, nullable=False)
    arrival_time = db.Column(db.Time)
    departure_time = db.Column(db.Time)
    duration = db.Column(db.Integer)
    is_custom = db.Column(db.Boolean, default=False)

    route = db.relationship('Route', backref='places')
    place = db.relationship('Place')


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=False)
    # Email в нижнем регистре; неподтверждённый тоже занимает уникальный индекс
    email = db.Column(db.String(200), unique=True, nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    # Может ли аккаунт входить (False до подтверждения email)
    account_confirmed = db.Column(db.Boolean, default=True, nullable=False)
    # Новый email до подтверждения
    pending_email = db.Column(db.String(200), nullable=True)
    avatar_url = db.Column(db.String(500))
    # Адрес дома или отеля с координатами
    home_address = db.Column(db.String(300))
    home_lat = db.Column(db.Float)
    home_lon = db.Column(db.Float)
    # Скрывать реальные адреса старта и финиша в публичных маршрутах
    private_terminal_enabled = db.Column(db.Boolean, default=True)
    # Код языка интерфейса ('ru'/'en')
    language = db.Column(db.String(10), default='ru', nullable=False)
    # Администратор (выставляется только вручную в БД)
    is_admin = db.Column(db.Boolean, default=False)
    # Индивидуальные настройки аккаунта: тариф такси и прогулочный лимит
    default_taxi_tariff = db.Column(db.String(16), default='economy', nullable=False)
    walk_distance_limit_m = db.Column(db.Integer, default=800, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Star(db.Model):
    __tablename__ = 'stars'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    route_id = db.Column(db.Integer, db.ForeignKey('routes.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Уникальная пара (user_id, route_id) - один пользователь = одна звезда на маршрут
    __table_args__ = (
        db.UniqueConstraint('user_id', 'route_id', name='unique_user_route_star'),
    )

    user = db.relationship('User', backref='stars')
    route = db.relationship('Route', backref='stars')


class RouteSession(db.Model):
    """Прохождение маршрута в режиме On It"""
    __tablename__ = 'route_sessions'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    # SET NULL: прохождение переживает удаление маршрута
    route_id = db.Column(db.Integer, db.ForeignKey('routes.id', ondelete='SET NULL'), nullable=True)
    started_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    finished_at = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.String(20), default='in_progress', nullable=False)
    # Снимок фактически пройденного маршрута, фиксируется один раз при завершении
    executed_route_data = db.Column(db.JSON, nullable=True)
    user = db.relationship('User', backref='route_sessions')
    route = db.relationship('Route', backref='sessions')


class AppSettings(db.Model):
    """Общие настройки проекта (всегда одна строка)"""
    __tablename__ = 'app_settings'

    id = db.Column(db.Integer, primary_key=True)
    map_enabled = db.Column(db.Boolean, default=True, nullable=False)
    # Показывать ли мини-карту маршрута
    route_mini_map_enabled = db.Column(db.Boolean, default=True, nullable=False)
    # Обязателен ли подтверждённый email при регистрации
    require_email_verification = db.Column(db.Boolean, default=True, nullable=False)


class TransitCacheEntry(db.Model):
    """Кэш ответов OTP для пары точек (координаты и время огрублены)"""
    __tablename__ = 'transit_cache_entries'
    id = db.Column(db.Integer, primary_key=True)
    cache_key = db.Column(db.String(120), unique=True, nullable=False, index=True)
    # Кэшируется и отсутствие маршрута
    found = db.Column(db.Boolean, nullable=False)
    duration_seconds = db.Column(db.Integer, nullable=True)
    legs = db.Column(db.JSON, nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EmailVerificationToken(db.Model):
    """Токен подтверждения почты"""
    __tablename__ = 'email_verification_tokens'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    token_hash = db.Column(db.String(64), unique=True, nullable=False, index=True)
    purpose = db.Column(db.String(20), nullable=False)
    # Email, который подтверждает эта ссылка
    target_email = db.Column(db.String(200), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    consumed_at = db.Column(db.DateTime, nullable=True)
    # Момент последней отправки (для кулдауна повторной отправки)
    last_sent_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    user = db.relationship('User', backref='email_tokens')