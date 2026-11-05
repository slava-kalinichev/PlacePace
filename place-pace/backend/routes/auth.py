"""Регистрация, вход, подтверждение почты, сброс пароля"""

from datetime import datetime
from flask import jsonify, request, session
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash
from ..models import db, EmailVerificationToken, User
from ..services.account_service import (
    DUMMY_PASSWORD_HASH,
    email_taken,
    hash_token,
    purge_expired_unconfirmed_users,
    resend_cooldown_remaining,
    send_verification,
    validate_email_format,
    validate_username,)
from ..services.app_settings_service import load_app_settings
from .blueprint import api_bp


def user_public_dict(user):
    return {
        'id': user.id,
        'username': user.username,
        'first_name': user.first_name,
        'last_name': user.last_name,
    }


@api_bp.route('/register', methods=['POST'])
def register():
    purge_expired_unconfirmed_users()

    data = request.json or {}
    first_name = (data.get('first_name') or '').strip()
    last_name = (data.get('last_name') or '').strip()
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    home_address = (data.get('home_address') or '').strip()

    if not first_name or not last_name or not username or not password:
        return jsonify({'success': False, 'error': 'Заполните все поля'}), 400

    username_error = validate_username(username)
    if username_error:
        return jsonify({'success': False, 'error': username_error, 'field': 'username'}), 400

    email_required = load_app_settings().require_email_verification
    if email_required and not email:
        return jsonify({'success': False, 'error': 'Укажите email', 'field': 'email'}), 400

    if email:
        email_error = validate_email_format(email)
        if email_error:
            return jsonify({'success': False, 'error': email_error, 'field': 'email'}), 400

    if User.query.filter_by(username=username).first():
        return jsonify({
            'success': False,
            'error': 'Данный логин уже существует. Попробуйте другой вариант',
            'field': 'username',
        }), 409

    if email and email_taken(email):
        return jsonify({
            'success': False,
            'error': 'Данная почта уже используется другим аккаунтом',
            'field': 'email',
        }), 409

    # Email подтверждается , только если он указан
    needs_email_flow = bool(email)

    user = User(
        username=username,
        first_name=first_name,
        last_name=last_name,
        email=email or None,
        password_hash=generate_password_hash(password),
        account_confirmed=not needs_email_flow,
    )
    if home_address:
        user.home_address = home_address
        user.home_lat = data.get('home_lat')
        user.home_lon = data.get('home_lon')
    db.session.add(user)
    db.session.commit()

    if needs_email_flow:
        send_verification(user, 'register', email)
        # Ключ сессии для ожидающей регистрации (аккаунт ещё не авторизован)
        session['pending_registration_user_id'] = user.id
        return jsonify({'success': True, 'pending_email_confirmation': True, 'email': email}), 201

    session['user_id'] = user.id
    return jsonify({'success': True, 'immediate': True, **user_public_dict(user)}), 201


@api_bp.route('/verify-email', methods=['POST'])
def verify_email():
    """Подтверждение по ссылке из письма (регистрация и смена email)"""
    data = request.json or {}
    raw_token = (data.get('token') or '').strip()
    if not raw_token:
        return jsonify({'success': False, 'error': 'Ссылка недействительна'}), 400

    token = EmailVerificationToken.query.filter_by(token_hash=hash_token(raw_token)).first()
    if not token:
        return jsonify({'success': False, 'error': 'Ссылка недействительна или устарела'}), 400
    if token.consumed_at is not None:
        return jsonify({'success': False, 'error': 'Эта ссылка уже была использована'}), 400
    if token.expires_at < datetime.utcnow():
        return jsonify({'success': False, 'error': 'Ссылка устарела, запросите новое письмо'}), 400

    user = User.query.get(token.user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Ссылка недействительна или устарела'}), 400

    token.consumed_at = datetime.utcnow()

    if token.purpose == 'register':
        user.account_confirmed = True
        db.session.commit()
        session.pop('pending_registration_user_id', None)
        session['user_id'] = user.id
        return jsonify({'success': True, 'purpose': 'register', **user_public_dict(user)}), 200

    if token.purpose == 'change_email':
        had_previous_email = bool(user.email)
        user.email = token.target_email
        user.pending_email = None
        db.session.commit()
        return jsonify({
            'success': True,
            'purpose': 'change_email',
            'message_variant': 'changed' if had_previous_email else 'linked',
            **user_public_dict(user),
        }), 200

    db.session.commit()
    return jsonify({'success': False, 'error': 'Ссылка недействительна или устарела'}), 400


@api_bp.route('/resend-verification', methods=['POST'])
def resend_verification():
    """Повторная отправка письма: получатель определяется только по сессии"""
    data = request.json or {}
    new_email = (data.get('new_email') or '').strip().lower()
    current = get_current_user()

    if current:
        if not current.pending_email:
            return jsonify({'success': True}), 200
        target = current.pending_email
        if new_email and new_email != target:
            email_error = validate_email_format(new_email)
            if email_error:
                return jsonify({'success': False, 'error': email_error}), 400
            if email_taken(new_email, exclude_user_id=current.id):
                return jsonify({'success': False, 'error': 'Данная почта уже используется другим аккаунтом'}), 409
            current.pending_email = new_email
            db.session.commit()
            target = new_email
            send_verification(current, 'change_email', target)
            return jsonify({'success': True, 'email': target}), 200

        remaining = resend_cooldown_remaining(current, 'change_email')
        if remaining > 0:
            return jsonify({'success': False, 'error': 'Подождите перед повторной отправкой', 'retry_after': remaining}), 429
        send_verification(current, 'change_email', target)
        return jsonify({'success': True, 'email': target}), 200

    pending_user_id = session.get('pending_registration_user_id')
    if not pending_user_id:
        return jsonify({'success': True}), 200

    user = User.query.get(pending_user_id)
    if not user or user.account_confirmed:
        session.pop('pending_registration_user_id', None)
        return jsonify({'success': True}), 200

    if new_email and new_email != (user.email or '').lower():
        email_error = validate_email_format(new_email)
        if email_error:
            return jsonify({'success': False, 'error': email_error}), 400
        if email_taken(new_email, exclude_user_id=user.id):
            return jsonify({'success': False, 'error': 'Данная почта уже используется другим аккаунтом'}), 409
        user.email = new_email
        db.session.commit()
        send_verification(user, 'register', new_email)
        return jsonify({'success': True, 'email': new_email}), 200

    remaining = resend_cooldown_remaining(user, 'register')
    if remaining > 0:
        return jsonify({'success': False, 'error': 'Подождите перед повторной отправкой', 'retry_after': remaining}), 429

    send_verification(user, 'register', user.email)
    return jsonify({'success': True, 'email': user.email}), 200


@api_bp.route('/registration-status', methods=['GET'])
def registration_status():
    """Опрос статуса подтверждения (оно могло пройти на другом устройстве)"""
    pending_user_id = session.get('pending_registration_user_id')
    if not pending_user_id:
        return jsonify({'confirmed': False}), 200

    user = User.query.get(pending_user_id)
    if not user or not user.account_confirmed:
        return jsonify({'confirmed': False}), 200

    session.pop('pending_registration_user_id', None)
    session['user_id'] = user.id
    return jsonify({'confirmed': True, **user_public_dict(user)}), 200


@api_bp.route('/request-password-reset', methods=['POST'])
def request_password_reset():
    """Сброс пароля: ответ всегда одинаковый, чтобы не раскрывать наличие email"""
    data = request.json or {}
    email = (data.get('email') or '').strip().lower()

    if email:
        user = User.query.filter(func.lower(User.email) == email).first()
        if user and resend_cooldown_remaining(user, 'reset_password') <= 0:
            send_verification(user, 'reset_password', user.email)

    return jsonify({'success': True}), 200


@api_bp.route('/reset-password', methods=['POST'])
def reset_password():
    """Установка нового пароля по токену из письма"""
    data = request.json or {}
    raw_token = (data.get('token') or '').strip()
    new_password = data.get('new_password') or ''

    if not raw_token or not new_password:
        return jsonify({'success': False, 'error': 'Заполните все поля'}), 400

    token = EmailVerificationToken.query.filter_by(token_hash=hash_token(raw_token), purpose='reset_password').first()
    if not token:
        return jsonify({'success': False, 'error': 'Ссылка недействительна или устарела'}), 400
    if token.consumed_at is not None:
        return jsonify({'success': False, 'error': 'Эта ссылка уже была использована'}), 400
    if token.expires_at < datetime.utcnow():
        return jsonify({'success': False, 'error': 'Ссылка устарела, запросите новое письмо'}), 400

    user = User.query.get(token.user_id)
    if not user:
        return jsonify({'success': False, 'error': 'Ссылка недействительна или устарела'}), 400

    token.consumed_at = datetime.utcnow()
    user.password_hash = generate_password_hash(new_password)
    db.session.commit()

    session['user_id'] = user.id
    return jsonify({'success': True, **user_public_dict(user)}), 200


@api_bp.route('/login', methods=['POST'])
def login():
    """Одинаковый ответ для неверного логина и пароля; пароль проверяется всегда"""
    data = request.json or {}
    identifier = (data.get('login') or '').strip()
    password = data.get('password') or ''

    if '@' in identifier:
        user = User.query.filter(func.lower(User.email) == identifier.lower()).first()
    else:
        user = User.query.filter_by(username=identifier).first()

    password_hash = user.password_hash if user else DUMMY_PASSWORD_HASH
    password_ok = check_password_hash(password_hash, password)

    if not user or not password_ok:
        return jsonify({'success': False, 'error': 'Неверный логин или пароль'}), 401

    if not user.account_confirmed:
        # Пароль верный: повторно отправляем письмо подтверждения с учётом кулдауна
        if resend_cooldown_remaining(user, 'register') <= 0:
            send_verification(user, 'register', user.email)
        return jsonify({
            'success': False,
            'error': 'Подтвердите email, отправленный на',
            'needs_confirmation': True,
            'email': user.email,
        }), 403

    session['user_id'] = user.id

    return jsonify({'success': True, **user_public_dict(user)}), 200


@api_bp.route('/logout', methods=['POST'])
def logout():
    session.pop('user_id', None)
    return jsonify({'success': True}), 200


@api_bp.route('/me', methods=['GET'])
def me():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'authenticated': False}), 401

    user = User.query.get(user_id)
    if not user:
        session.pop('user_id', None)
        return jsonify({'authenticated': False}), 401

    return jsonify({'authenticated': True, **user_public_dict(user)}), 200


def get_current_user():
    user_id = session.get('user_id')
    if not user_id:
        return None
    return User.query.get(user_id)
