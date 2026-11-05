import logging
import os
import queue
import threading
from datetime import date, timedelta

from ..models import db, Place
from .travel_matrix import get_cached_transit_route, TRANSIT_DISTANCE_THRESHOLD_M
from .osrm_service import OSRMService

logger = logging.getLogger(__name__)

# Часы, на которые прогревается кэш (утро, день, вечер)
WARMUP_HOURS = (10, 15, 19)
WARMUP_MAX_WORKERS = 8
# Предохранитель: число пар растёт квадратично, прогрев рассчитан на ручной каталог
WARMUP_MAX_PLACES = 120


def _nearest_date_for(is_weekend):
    """Ближайшая календарная дата нужного типа дня (будни/выходной)"""
    today = date.today()
    target_weekday = 5 if is_weekend else 0  # ближайшая суббота / понедельник
    days_ahead = (target_weekday - today.weekday()) % 7
    return (today + timedelta(days=days_ahead)).isoformat()


def warm_transit_cache(app):
    """Фоновый прогрев кэша OTP для всех пар мест каталога (идемпотентно)"""
    if os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return

    def _run():
        with app.app_context():
            places = Place.query.filter_by(is_active=True).all()
            coords = [(p.latitude, p.longitude) for p in places if p.latitude is not None and p.longitude is not None]
            # Возвращаем соединение в пул до сетевых запросов
            db.session.commit()
            if len(coords) < 2:
                return
            if len(coords) > WARMUP_MAX_PLACES:
                logger.warning(
                    f"Прогрев кэша транспорта пропущен: {len(coords)} мест в ручном каталоге "
                    f"(предел {WARMUP_MAX_PLACES}) - число пар растёт квадратично"
                )
                return

            osrm = OSRMService()
            _, distances = osrm.get_travel_matrix(coords, 'foot')
            pairs = [(i, j) for i in range(len(coords)) for j in range(len(coords))
                     if i < j and distances[i][j] >= TRANSIT_DISTANCE_THRESHOLD_M]
            if not pairs:
                return

            dates = {False: _nearest_date_for(False), True: _nearest_date_for(True)}
            jobs = [(coords[i], coords[j], is_weekend, hour)
                    for i, j in pairs for is_weekend in (False, True) for hour in WARMUP_HOURS]
            logger.info(f"Прогрев кэша транспорта: {len(jobs)} запросов для {len(pairs)} пар мест каталога")

            def _warm_one(origin, dest, is_weekend, hour):
                with app.app_context():
                    get_cached_transit_route(origin, dest, dates[is_weekend], f"{hour:02d}:00")

            # Демон-потоки с очередью: не мешают перезапуску dev-сервера
            job_queue = queue.Queue()
            for job in jobs:
                job_queue.put(job)

            def _worker():
                while True:
                    try:
                        origin, dest, is_weekend, hour = job_queue.get_nowait()
                    except queue.Empty:
                        return
                    try:
                        _warm_one(origin, dest, is_weekend, hour)
                    except Exception:
                        logger.exception("Прогрев кэша: задача не удалась")

            workers = [threading.Thread(target=_worker, daemon=True, name=f'transit-warm-{n}')
                       for n in range(WARMUP_MAX_WORKERS)]
            for w in workers:
                w.start()
            for w in workers:
                w.join()
            logger.info("Прогрев кэша транспорта завершён")

    threading.Thread(target=_run, daemon=True, name='transit-cache-warmer').start()
