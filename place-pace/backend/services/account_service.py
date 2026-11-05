"""Токены подтверждения почты и проверки данных аккаунта"""

from datetime import datetime, timedelta
import hashlib
import re
import secrets

from sqlalchemy import func
from werkzeug.security import generate_password_hash

from . import email_service
from ..models import db, EmailVerificationToken, User


# Фиктивный хеш для выравнивания времени ответа /login при неизвестном логине
DUMMY_PASSWORD_HASH = generate_password_hash('dummy-password-for-timing-equalization')


# Логин: латиница, цифры, подчёркивание, 3-30 символов; email проверяется нестрого
USERNAME_RE = re.compile(r'^[A-Za-z0-9_]{3,30}$')


EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


VERIFICATION_TOKEN_TTL_HOURS = 24


RESEND_COOLDOWN_SECONDS = 120


# Сколько часов хранится неподтверждённая регистрация
PENDING_REGISTRATION_TTL_HOURS = 24


def hash_token(raw_token):
    """В БД хранится SHA-256 токена, а не сам токен"""
    return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()


def purge_expired_unconfirmed_users():
    """Освобождает логин и email просроченных неподтверждённых регистраций"""
    cutoff = datetime.utcnow() - timedelta(hours=PENDING_REGISTRATION_TTL_HOURS)
    stale_users = User.query.filter(
        User.account_confirmed.is_(False),
        User.created_at < cutoff,
    ).all()
    for user in stale_users:
        EmailVerificationToken.query.filter_by(user_id=user.id).delete()
        db.session.delete(user)
    if stale_users:
        db.session.commit()


def _issue_verification_token(user, purpose, target_email):
    """Выпускает новый токен подтверждения и инвалидирует прежний неиспользованный"""
    EmailVerificationToken.query.filter_by(user_id=user.id, purpose=purpose, consumed_at=None).delete()
    raw_token = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    token = EmailVerificationToken(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        purpose=purpose,
        target_email=target_email,
        expires_at=now + timedelta(hours=VERIFICATION_TOKEN_TTL_HOURS),
        last_sent_at=now,
    )
    db.session.add(token)
    db.session.commit()
    return raw_token


def send_verification(user, purpose, target_email):
    raw_token = _issue_verification_token(user, purpose, target_email)
    email_service.send_verification_email(target_email, user.first_name, user.language, purpose, raw_token)


def resend_cooldown_remaining(user, purpose):
    """Секунд до окончания кулдауна повторной отправки (0 - можно сразу)"""
    token = EmailVerificationToken.query.filter_by(user_id=user.id, purpose=purpose) \
        .order_by(EmailVerificationToken.last_sent_at.desc()).first()
    if not token:
        return 0
    elapsed = (datetime.utcnow() - token.last_sent_at).total_seconds()
    return max(0, int(RESEND_COOLDOWN_SECONDS - elapsed))


def validate_username(username):
    if not USERNAME_RE.match(username):
        return 'Логин может содержать только латинские буквы, цифры и нижнее подчёркивание, от 3 до 30 символов'
    return None


def validate_email_format(email):
    if not EMAIL_RE.match(email):
        return 'Введите корректный email'
    return None


def email_taken(email, exclude_user_id=None):
    """Занят ли email (подтверждённый или ожидающий) другим аккаунтом"""
    query = User.query.filter(
        db.or_(func.lower(User.email) == email, func.lower(User.pending_email) == email)
    )
    if exclude_user_id is not None:
        query = query.filter(User.id != exclude_user_id)
    return query.first() is not None
