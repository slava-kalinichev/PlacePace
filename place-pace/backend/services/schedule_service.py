from datetime import datetime
import logging
import re

logger = logging.getLogger(__name__)

# Ключи дней недели в порядке datetime.weekday()
_DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
_DAY_CLOSED_PHRASES = [
    'по понедельникам', 'по вторникам', 'по средам', 'по четвергам',
    'по пятницам', 'по субботам', 'по воскресеньям',
]
_MONTHS = {
    'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
    'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
}
_DATE_IN_TEXT_RE = re.compile(r'(\d{1,2})\s+(' + '|'.join(_MONTHS) + r')', re.IGNORECASE)
_CLOSED_WORDS_RE = re.compile(r'закры|не работа|выходн', re.IGNORECASE)


class ScheduleService:
    @staticmethod
    def _holiday_note(comment, date):
        """Фрагмент праздничного сообщения 2GIS, относящийся к дате маршрута (или None)"""
        if not comment or date is None:
            return None
        matches = list(_DATE_IN_TEXT_RE.finditer(comment))
        for i, match in enumerate(matches):
            if int(match.group(1)) == date.day and _MONTHS[match.group(2).lower()] == date.month:
                end = matches[i + 1].start() if i + 1 < len(matches) else len(comment)
                return comment[match.start():end].strip()
        return None

    @staticmethod
    def check_schedules(places, date_str):
        """Проверка расписаний мест на дату: подставляет часы нужного дня, исключает закрытые места"""
        valid_places = []
        excluded_places = []
        warnings = []
        holiday_places = []

        try:
            date = datetime.strptime(date_str, '%Y-%m-%d')
            weekday = date.weekday()
        except (TypeError, ValueError):
            date = None
            weekday = None

        for place in places:
            schedule = place.get('schedule')
            if isinstance(schedule, dict) and weekday is not None:
                day_info = ScheduleService._day_hours(schedule, weekday)
                note = ScheduleService._holiday_note(schedule.get('comment'), date)

                if note and _CLOSED_WORDS_RE.search(note):
                    excluded_places.append(place)
                    warnings.append(f"Место '{place['name']}' закрыто в выбранную дату: {note}")
                    continue
                if day_info == 'closed':
                    excluded_places.append(place)
                    warnings.append(
                        f"Место '{place['name']}' закрыто {_DAY_CLOSED_PHRASES[weekday]}")
                    continue
                if isinstance(day_info, str):
                    place['work_time'] = day_info
                if note:
                    holiday_places.append(place['name'])
                    warnings.append(f"Место '{place['name']}': {note}")

            work_time = place.get('work_time', '')

            if work_time == 'Круглосуточно':
                valid_places.append(place)
                continue

            if not work_time or work_time == '-':
                valid_places.append(place)
                continue

            try:
                if '-' in work_time:
                    parts = work_time.split('-')
                    if len(parts) == 2:
                        start_str = parts[0].strip()
                        end_str = parts[1].strip()

                        if start_str and end_str and ':' in start_str and ':' in end_str:
                            valid_places.append(place)
                            continue
            except Exception:
                pass

            excluded_places.append(place)
            warnings.append(f"Место '{place['name']}' исключено (не удалось определить время работы)")

        return {
            'valid_places': valid_places,
            'excluded_places': excluded_places,
            'warnings': warnings,
            'holiday_places': holiday_places,
        }

    @staticmethod
    def _day_hours(schedule, weekday):
        """Часы дня: 'HH:MM-HH:MM', 'Круглосуточно', 'closed' (в этот день закрыто) или None (данных нет)"""
        days_present = [d for d in _DAY_KEYS if isinstance(schedule.get(d), dict)]
        if not days_present:
            return None
        info = schedule.get(_DAY_KEYS[weekday])
        if not isinstance(info, dict) or not info.get('from') or not info.get('to'):
            return 'closed'
        start, end = info['from'], info['to']
        if start == '00:00' and end in ('24:00', '23:59'):
            return 'Круглосуточно'
        return f"{start}-{end}"
