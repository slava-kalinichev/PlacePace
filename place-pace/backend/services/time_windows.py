# Общие функции разбора часов работы мест
import logging

logger = logging.getLogger(__name__)


def time_to_minutes(time_str):
    """Время 'HH:MM' в минуты от начала суток"""
    if not time_str:
        return 0
    try:
        parts = time_str.split(':')
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return 0


def parse_work_time(work_time_str):
    """Разбор часов работы 'HH:MM-HH:MM' в окно (начало, конец); при ошибке - круглосуточно"""
    if not work_time_str or work_time_str == '-' or work_time_str == 'Круглосуточно':
        return 0, 1440

    try:
        work_time_str = work_time_str.strip()

        if '-' in work_time_str:
            parts = work_time_str.split('-')
            if len(parts) == 2:
                start_str = parts[0].strip()
                end_str = parts[1].strip()

                if ':' in start_str and ':' in end_str:
                    start = time_to_minutes(start_str)
                    end = time_to_minutes(end_str)
                    return start, end
    except Exception as e:
        logger.warning(f"Ошибка парсинга времени '{work_time_str}': {e}")

    return 0, 1440


def fits_within_window(work_time_str, arrival_minutes, departure_minutes):
    """Укладывается ли визит в часы работы места"""
    open_minutes, close_minutes = parse_work_time(work_time_str)
    return arrival_minutes >= open_minutes and departure_minutes <= close_minutes
