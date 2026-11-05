import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key')
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', 'postgresql://localhost:5432/place_pace')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    DEBUG = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    CORS_ORIGINS = os.getenv('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',')
    # Secure-кука нужна под HTTPS
    SESSION_COOKIE_SECURE = os.getenv('SESSION_COOKIE_SECURE', 'False').lower() == 'true'
    OSRM_URL = os.getenv('OSRM_URL', 'http://localhost:5002')
    OTP_URL = os.getenv('OTP_URL', 'http://localhost:8080')
    YANDEX_SUGGEST_API_KEY = os.getenv('YANDEX_SUGGEST_API_KEY', '')
    YANDEX_GEOCODER_API_KEY = os.getenv('YANDEX_GEOCODER_API_KEY', '')
    YANDEX_API_REFERER = os.getenv('YANDEX_API_REFERER', 'http://localhost')
    DGIS_CATALOG_API_KEY = os.getenv('DGIS_CATALOG_API_KEY', '')
    # Суточный лимит исходящих запросов к 2GIS (счётчик в памяти процесса)
    DGIS_DAILY_REQUEST_LIMIT = int(os.getenv('DGIS_DAILY_REQUEST_LIMIT', '300'))
    DGIS_FAST_FOOD_CHAINS = [c.strip() for c in os.getenv(
        'DGIS_FAST_FOOD_CHAINS', 'Вкусно и точка,Бургер Кинг,Ростикс,Теремок').split(',') if c.strip()]
    DGIS_MAX_PAGES = int(os.getenv('DGIS_MAX_PAGES', '5'))
    DGIS_TEXT_SEARCH_TYPES = os.getenv('DGIS_TEXT_SEARCH_TYPES', 'branch,building,attraction')
    DGIS_SEARCH_VIEWPOINT1 = os.getenv('DGIS_SEARCH_VIEWPOINT1', '35.1,56.9')
    DGIS_SEARCH_VIEWPOINT2 = os.getenv('DGIS_SEARCH_VIEWPOINT2', '40.2,54.2')
    # Адрес сервиса офлайн-перевода
    TRANSLATOR_URL = os.getenv('TRANSLATOR_URL', 'http://localhost:5003')
    YANDEX_REVERSE_GEOCODE_DAILY_LIMIT = int(os.getenv('YANDEX_REVERSE_GEOCODE_DAILY_LIMIT', '300'))
    YANDEX_TAXI_CLID = os.getenv('YANDEX_TAXI_CLID', '')
    YANDEX_TAXI_API_KEY = os.getenv('YANDEX_TAXI_API_KEY', '')
    FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:5173')
    SMTP_HOST = os.getenv('SMTP_HOST', '')
    SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
    SMTP_USER = os.getenv('SMTP_USER', '')
    SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', '')
    SMTP_USE_TLS = os.getenv('SMTP_USE_TLS', 'True').lower() == 'true'
    SMTP_FROM = os.getenv('SMTP_FROM', 'Place Pace <noreply@placepace.ru>')