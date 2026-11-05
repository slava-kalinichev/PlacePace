"""Нормализация обложек маршрутов: сжатие data URL до JPEG разумного размера"""

import base64
import binascii
import hashlib
import io
import re

from PIL import Image, ImageOps

# Длинная сторона обложки в пикселях
COVER_MAX_SIDE = 1000
COVER_JPEG_QUALITY = 82

# Потолок длины входящего data URL (файл до 10 МБ в base64)
COVER_MAX_INPUT_CHARS = 14_500_000

# Небольшие обложки возвращаются как есть, без повторного сжатия
COVER_SKIP_RECODE_BYTES = 400_000

_DATA_URL_RE = re.compile(r'^data:image/[a-zA-Z0-9.+-]+;base64,', re.IGNORECASE)


def normalize_cover_image(data_url):
    """Data URL -> JPEG data URL; пустое значение -> None, битый файл -> ValueError"""
    if not data_url:
        return None
    if not isinstance(data_url, str) or not _DATA_URL_RE.match(data_url):
        raise ValueError('Обложка должна быть изображением')
    if len(data_url) > COVER_MAX_INPUT_CHARS:
        raise ValueError('Изображение обложки слишком большое (максимум 10 МБ)')

    try:
        raw = base64.b64decode(data_url.split(',', 1)[1], validate=False)
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (binascii.Error, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ValueError('Не удалось прочитать изображение обложки') from exc

    # Поворот по EXIF
    image = ImageOps.exif_transpose(image)

    if max(image.size) <= COVER_MAX_SIDE and len(data_url) <= COVER_SKIP_RECODE_BYTES:
        return data_url

    image.thumbnail((COVER_MAX_SIDE, COVER_MAX_SIDE), Image.LANCZOS)

    # JPEG без альфа-канала - прозрачные PNG/WebP кладём на белый фон
    if image.mode in ('RGBA', 'LA') or (image.mode == 'P' and 'transparency' in image.info):
        rgba = image.convert('RGBA')
        background = Image.new('RGB', rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel('A'))
        image = background
    else:
        image = image.convert('RGB')

    buffer = io.BytesIO()
    image.save(buffer, format='JPEG', quality=COVER_JPEG_QUALITY, optimize=True, progressive=True)
    encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
    result = f'data:image/jpeg;base64,{encoded}'

    # Если сжатие не помогло, оставляем меньший вариант
    return result if len(result) < len(data_url) else data_url


# Форматы, которые отдаём через /routes/<id>/cover
SERVABLE_COVER_MIMES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}


def cover_version(data_url):
    """Короткий отпечаток обложки для ?v= в URL"""
    if not data_url:
        return None
    return hashlib.md5(data_url.encode('utf-8')).hexdigest()[:12]


def decode_cover(data_url):
    """data URL -> (mime, bytes) или None"""
    if not data_url or not _DATA_URL_RE.match(data_url):
        return None
    header, _, payload = data_url.partition(',')
    mime = header[len('data:'):].split(';', 1)[0].lower()
    if mime not in SERVABLE_COVER_MIMES:
        return None
    try:
        return mime, base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError):
        return None
