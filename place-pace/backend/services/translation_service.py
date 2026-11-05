"""Автоперевод названий и описаний маршрутов ru<->en через контейнер translator/"""
import logging
import re
import threading

import requests

from ..config import Config

logger = logging.getLogger(__name__)

_CYRILLIC_RE = re.compile('[а-яёА-ЯЁ]')
# Первый запрос после старта контейнера может ждать загрузки модели
_TIMEOUT_SECONDS = 60


def detect_lang(text: str | None) -> str | None:
    """'ru' при наличии кириллицы, иначе 'en'; None для пустого текста"""
    if not text or not text.strip():
        return None
    return 'ru' if _CYRILLIC_RE.search(text) else 'en'


def opposite(lang: str) -> str:
    return 'en' if lang == 'ru' else 'ru'


def _match_first_letter_case(original: str, translated: str) -> str:
    """Переносит регистр первой буквы оригинала на перевод"""
    first = next((c for c in original if c.isalpha()), None)
    if first and first.isupper():
        for i, c in enumerate(translated):
            if c.isalpha():
                return translated[:i] + c.upper() + translated[i + 1:]
    return translated


def translate(text: str, source: str, target: str) -> str | None:
    """Перевод одной строки; None при любой ошибке/недоступном переводчике"""
    try:
        response = requests.post(f'{Config.TRANSLATOR_URL}/translate', json={
            'text': text, 'source': source, 'target': target,
        }, timeout=_TIMEOUT_SECONDS)
        if response.status_code != 200:
            logger.warning("Переводчик HTTP %s: %s", response.status_code, response.text[:200])
            return None
        translated = (response.json().get('text') or '').strip()
        return _match_first_letter_case(text, translated) if translated else None
    except (requests.RequestException, ValueError) as e:
        logger.warning("Переводчик недоступен: %s", e)
        return None


def translate_route_texts(route) -> bool:
    """Заполняет недостающие переводы маршрута; True, если что-то изменилось"""
    changed = False
    for field in ('title', 'description'):
        text = getattr(route, field)
        lang = detect_lang(text)
        if setattr_if_diff(route, f'{field}_lang', lang):
            setattr(route, f'{field}_translated', None)
            changed = True
        if not lang or getattr(route, f'{field}_translated'):
            continue
        translated = translate(text, lang, opposite(lang))
        if translated:
            setattr(route, f'{field}_translated', translated)
            changed = True
    return changed


def setattr_if_diff(obj, name: str, value) -> bool:
    if getattr(obj, name) == value:
        return False
    setattr(obj, name, value)
    return True


def translate_route_async(app, route_id: int):
    """Фоновый перевод только что сохранённого маршрута (свой app context и сессия БД)"""
    def _run():
        from ..models import db, Route
        with app.app_context():
            try:
                route = Route.query.get(route_id)
                if route and translate_route_texts(route):
                    db.session.commit()
            except Exception:
                db.session.rollback()
                logger.exception("Автоперевод маршрута %s не удался", route_id)
    threading.Thread(target=_run, daemon=True).start()


def localized_texts(route, lang: str) -> tuple[str, str | None]:
    """Название и описание маршрута на языке зрителя"""
    title = route.title
    if route.title_lang and route.title_lang != lang and route.title_translated:
        title = route.title_translated
    description = route.description
    if route.description_lang and route.description_lang != lang and route.description_translated:
        description = route.description_translated
    return title, description
