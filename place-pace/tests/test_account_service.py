import pytest

from backend.services.account_service import hash_token, validate_email_format, validate_username


@pytest.mark.parametrize('username', ['slava', 'slava_1', 'A1_', 'a' * 30])
def test_valid_usernames(username):
    assert validate_username(username) is None


@pytest.mark.parametrize('username', ['ab', 'a' * 31, 'имя', 'with space', 'dash-name', ''])
def test_invalid_usernames(username):
    assert validate_username(username)


@pytest.mark.parametrize('email, valid', [
    ('user@example.com', True),
    ('a.b+c@mail.ru', True),
    ('no-at-sign.com', False),
    ('user@nodot', False),
    ('us er@example.com', False),
])
def test_email_format(email, valid):
    assert (validate_email_format(email) is None) is valid


def test_token_hash_is_deterministic_sha256():
    assert hash_token('abc') == hash_token('abc')
    assert len(hash_token('abc')) == 64
    assert hash_token('abc') != hash_token('abd')
