import base64
import io
import os

import pytest
from PIL import Image

from backend.services.image_service import cover_version, decode_cover, normalize_cover_image


def _data_url(image, fmt='PNG', mime='image/png'):
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return f"data:{mime};base64,{base64.b64encode(buffer.getvalue()).decode()}"


def test_empty_value_means_no_cover():
    assert normalize_cover_image(None) is None
    assert normalize_cover_image('') is None


@pytest.mark.parametrize('value', ['просто текст', 'data:text/plain;base64,AAAA', 'data:image/png;base64,не-картинка'])
def test_invalid_cover_is_rejected(value):
    with pytest.raises(ValueError):
        normalize_cover_image(value)


def test_small_cover_is_returned_as_is():
    url = _data_url(Image.new('RGB', (20, 20), 'red'))
    assert normalize_cover_image(url) == url


def test_large_cover_is_shrunk_to_jpeg():
    noise = Image.frombytes('RGB', (1500, 1000), os.urandom(1500 * 1000 * 3))
    url = _data_url(noise)
    result = normalize_cover_image(url)
    assert result.startswith('data:image/jpeg;base64,')
    assert len(result) < len(url)
    shrunk = Image.open(io.BytesIO(base64.b64decode(result.split(',', 1)[1])))
    assert max(shrunk.size) <= 1000


def test_cover_version_is_stable_short_hash():
    assert cover_version(None) is None
    version = cover_version('data:image/png;base64,AAAA')
    assert version == cover_version('data:image/png;base64,AAAA')
    assert len(version) == 12


def test_decode_cover():
    url = _data_url(Image.new('RGB', (4, 4), 'blue'))
    mime, payload = decode_cover(url)
    assert mime == 'image/png' and payload.startswith(b'\x89PNG')
    assert decode_cover('data:image/svg+xml;base64,AAAA') is None
    assert decode_cover(None) is None
