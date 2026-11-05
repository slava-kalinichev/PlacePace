from types import SimpleNamespace

import pytest
import requests

from backend.services import translation_service as ts


class _Response:
    def __init__(self, status=200, payload=None):
        self.status_code = status
        self.text = ''
        self._payload = payload or {}

    def json(self):
        return self._payload


@pytest.mark.parametrize('text, expected', [('Привет', 'ru'), ('Hello', 'en'), ('Hello, Москва', 'ru'), ('', None), ('  ', None), (None, None)])
def test_detect_lang(text, expected):
    assert ts.detect_lang(text) == expected


def test_opposite():
    assert ts.opposite('ru') == 'en' and ts.opposite('en') == 'ru'


def test_translate_keeps_first_letter_case(monkeypatch):
    monkeypatch.setattr(ts.requests, 'post', lambda *a, **k: _Response(payload={'text': 'hello world'}))
    assert ts.translate('Привет мир', 'ru', 'en') == 'Hello world'
    assert ts.translate('привет мир', 'ru', 'en') == 'hello world'


def test_translate_returns_none_on_http_error(monkeypatch):
    monkeypatch.setattr(ts.requests, 'post', lambda *a, **k: _Response(status=500))
    assert ts.translate('Привет', 'ru', 'en') is None


def test_translate_returns_none_when_service_is_down(monkeypatch):
    def fail(*args, **kwargs):
        raise requests.ConnectionError('translator is down')
    monkeypatch.setattr(ts.requests, 'post', fail)
    assert ts.translate('Привет', 'ru', 'en') is None


def test_localized_texts_prefers_translation_for_other_language():
    route = SimpleNamespace(title='Москва за день', title_lang='ru', title_translated='Moscow in a day',
                            description='Описание', description_lang='ru', description_translated=None)
    assert ts.localized_texts(route, 'en') == ('Moscow in a day', 'Описание')
    assert ts.localized_texts(route, 'ru') == ('Москва за день', 'Описание')
