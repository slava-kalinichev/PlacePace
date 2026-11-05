"""Офлайн-переводчик ru <-> en на Argos Translate (отдельный контейнер из-за расхода памяти)"""
import logging
import threading

import argostranslate.translate as argos_translate
from flask import Flask, jsonify, request

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('translator')

app = Flask(__name__)

SUPPORTED = {'ru', 'en'}
MAX_CHARS = 5000
_lock = threading.Lock()


def _warm_up():
    for src, dst in (('ru', 'en'), ('en', 'ru')):
        try:
            argos_translate.translate('test', src, dst)
        except Exception:
            logger.exception('warm-up %s->%s не удался', src, dst)


_warm_up()


@app.route('/health')
def health():
    return jsonify({'ok': True})


@app.route('/translate', methods=['POST'])
def translate():
    data = request.get_json(silent=True) or {}
    text = (data.get('text') or '').strip()
    source, target = data.get('source'), data.get('target')
    if not text:
        return jsonify({'text': ''})
    if source not in SUPPORTED or target not in SUPPORTED or source == target:
        return jsonify({'error': 'source/target должны быть разными ru или en'}), 400
    if len(text) > MAX_CHARS:
        return jsonify({'error': 'слишком длинный текст'}), 413
    try:
        with _lock:
            translated = argos_translate.translate(text, source, target)
    except Exception:
        logger.exception('ошибка перевода')
        return jsonify({'error': 'ошибка перевода'}), 500
    return jsonify({'text': translated})


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5003)
