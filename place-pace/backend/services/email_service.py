# Отправка писем: подтверждение email, смена email, сброс пароля (на языке аккаунта)
import html
import logging
import smtplib
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from email.utils import parseaddr
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from flask import current_app

# Пул потоков для SMTP с жёстким пределом ожидания результата
_EMAIL_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix='email-send')
_SEND_HARD_TIMEOUT_S = 15

logger = logging.getLogger(__name__)

_TEXT = {
    'register': {
        'ru': {
            'subject': 'Подтверждение почты — Place Pace',
            'preheader': 'Осталось подтвердить почту, чтобы завершить регистрацию',
            'heading': 'Подтвердите почту',
            'greeting': 'Здравствуйте, {name}!',
            'body': 'Вы зарегистрировались в Place Pace. Чтобы завершить регистрацию и войти в аккаунт, подтвердите эту почту — нажмите на кнопку ниже.',
            'button': 'Подтвердить',
            'fallback': 'Если кнопка не работает, перейдите по ссылке:',
            'ignore': 'Если вы не регистрировались в Place Pace, просто проигнорируйте это письмо — аккаунт не будет создан.',
            'expires': 'Ссылка действительна 24 часа.',
        },
        'en': {
            'subject': 'Confirm your email — Place Pace',
            'preheader': 'Confirm your email to finish creating your account',
            'heading': 'Confirm your email',
            'greeting': 'Hi {name},',
            'body': 'You signed up for Place Pace. To finish creating your account and sign in, please confirm this email address — click the button below.',
            'button': 'Confirm',
            'fallback': "If the button doesn't work, use this link:",
            'ignore': "If you didn't sign up for Place Pace, just ignore this email — no account will be created.",
            'expires': 'This link is valid for 24 hours.',
        },
    },
    'change_email': {
        'ru': {
            'subject': 'Подтверждение нового email — Place Pace',
            'preheader': 'Осталось подтвердить новый email аккаунта',
            'heading': 'Подтвердите новый email',
            'greeting': 'Здравствуйте, {name}!',
            'body': 'Вы запросили смену email аккаунта Place Pace на этот адрес. Чтобы подтвердить изменение, нажмите на кнопку ниже.',
            'button': 'Подтвердить',
            'fallback': 'Если кнопка не работает, перейдите по ссылке:',
            'ignore': 'Если вы не запрашивали смену email, просто проигнорируйте это письмо — адрес аккаунта не изменится.',
            'expires': 'Ссылка действительна 24 часа.',
        },
        'en': {
            'subject': 'Confirm your new email — Place Pace',
            'preheader': 'Confirm the new email address for your account',
            'heading': 'Confirm your new email',
            'greeting': 'Hi {name},',
            'body': 'You requested to change your Place Pace account email to this address. To confirm the change, click the button below.',
            'button': 'Confirm',
            'fallback': "If the button doesn't work, use this link:",
            'ignore': "If you didn't request this change, just ignore this email — your account email will stay the same.",
            'expires': 'This link is valid for 24 hours.',
        },
    },
    'reset_password': {
        'ru': {
            'subject': 'Восстановление пароля — Place Pace',
            'preheader': 'Ссылка для сброса пароля вашего аккаунта',
            'heading': 'Восстановление пароля',
            'greeting': 'Здравствуйте, {name}!',
            'body': 'Мы получили запрос на сброс пароля вашего аккаунта Place Pace. Чтобы задать новый пароль, нажмите на кнопку ниже.',
            'button': 'Сбросить пароль',
            'fallback': 'Если кнопка не работает, перейдите по ссылке:',
            'ignore': 'Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо — пароль останется прежним.',
            'expires': 'Ссылка действительна 24 часа.',
        },
        'en': {
            'subject': 'Reset your password — Place Pace',
            'preheader': 'Link to reset your account password',
            'heading': 'Reset your password',
            'greeting': 'Hi {name},',
            'body': 'We received a request to reset your Place Pace account password. To set a new password, click the button below.',
            'button': 'Reset password',
            'fallback': "If the button doesn't work, use this link:",
            'ignore': "If you didn't request a password reset, just ignore this email — your password will stay the same.",
            'expires': 'This link is valid for 24 hours.',
        },
    },
}


def _html_body(text: dict, link: str) -> str:
    # Инлайновые стили: почтовые клиенты вырезают <style>
    return f"""\
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>{text['subject']}</title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;">{text['preheader']}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px 32px;text-align:center;">
          <div style="font-size:20px;font-weight:700;color:#111827;">Place Pace</div>
        </td></tr>
        <tr><td style="padding:16px 32px 0 32px;">
          <h1 style="margin:0 0 16px 0;font-size:20px;color:#111827;">{text['heading']}</h1>
          <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#374151;">{text['greeting']}</p>
          <p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#374151;">{text['body']}</p>
        </td></tr>
        <tr><td style="padding:0 32px 24px 32px;text-align:center;">
          <a href="{link}" style="display:inline-block;padding:12px 32px;background-color:#007AFF;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;border-radius:12px;">{text['button']}</a>
        </td></tr>
        <tr><td style="padding:0 32px 8px 32px;">
          <p style="margin:0 0 4px 0;font-size:12px;line-height:1.5;color:#9CA3AF;">{text['fallback']}</p>
          <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="{link}" style="color:#007AFF;">{link}</a></p>
        </td></tr>
        <tr><td style="padding:16px 32px 32px 32px;border-top:1px solid #F3F4F6;">
          <p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:#9CA3AF;">{text['expires']}</p>
          <p style="margin:8px 0 0 0;font-size:12px;line-height:1.5;color:#9CA3AF;">{text['ignore']}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _text_body(text: dict, link: str) -> str:
    return (
        f"{text['heading']}\n\n"
        f"{text['body']}\n\n"
        f"{text['button']}: {link}\n\n"
        f"{text['expires']}\n"
        f"{text['ignore']}"
    )


def send_email(to_email: str, subject: str, html_body: str, text_body: str) -> None:
    smtp_host = current_app.config['SMTP_HOST']

    if not smtp_host:
        # Без SMTP письмо пишется в лог
        logger.info('[email_service] SMTP не настроен, письмо не отправлено.\nКому: %s\nТема: %s\n\n%s',
                    to_email, subject, text_body)
        return

    smtp_from = current_app.config['SMTP_FROM']
    # Конверт-отправитель должен быть голым адресом без имени
    smtp_from_addr = parseaddr(smtp_from)[1] or smtp_from

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = smtp_from
    msg['To'] = to_email
    msg.attach(MIMEText(text_body, 'plain', 'utf-8'))
    msg.attach(MIMEText(html_body, 'html', 'utf-8'))

    port = current_app.config['SMTP_PORT']
    user = current_app.config['SMTP_USER']
    password = current_app.config['SMTP_PASSWORD']
    use_tls = current_app.config['SMTP_USE_TLS']
    raw_message = msg.as_string()

    def _do_send():
        # Порт 465 - implicit TLS, остальные - STARTTLS
        if port == 465:
            with smtplib.SMTP_SSL(smtp_host, port, timeout=10) as server:
                if user:
                    server.login(user, password)
                server.sendmail(smtp_from_addr, [to_email], raw_message)
        else:
            with smtplib.SMTP(smtp_host, port, timeout=10) as server:
                if use_tls:
                    server.starttls()
                if user:
                    server.login(user, password)
                server.sendmail(smtp_from_addr, [to_email], raw_message)

    try:
        # Отправка в отдельном потоке с жёстким таймаутом
        _EMAIL_EXECUTOR.submit(_do_send).result(timeout=_SEND_HARD_TIMEOUT_S)
    except FutureTimeoutError:
        logger.error('[email_service] Отправка письма на %s не уложилась в %sс (похоже на зависший DNS/сеть) - прервано',
                      to_email, _SEND_HARD_TIMEOUT_S)
    except Exception:
        # Сбой SMTP не роняет запрос: пользователь запросит письмо повторно
        logger.exception('[email_service] Не удалось отправить письмо на %s', to_email)


def send_verification_email(to_email: str, first_name: str, language: str, purpose: str, raw_token: str) -> None:
    """purpose: 'register', 'change_email' или 'reset_password' (ссылка ведёт на разные параметры)"""
    lang = language if language in ('ru', 'en') else 'ru'
    base = _TEXT[purpose][lang]
    param = 'reset_token' if purpose == 'reset_password' else 'verify_token'
    link = f"{current_app.config['FRONTEND_URL']}/?{param}={raw_token}"
    subject = base['subject']
    # Имя экранируется для HTML-версии, в текстовой версии - как есть
    html_text = {**base, 'greeting': base['greeting'].format(name=html.escape(first_name))}
    plain_text = {**base, 'greeting': base['greeting'].format(name=first_name)}
    html_body = _html_body(html_text, link)
    text_body = _text_body(plain_text, link)
    send_email(to_email, subject, html_body, text_body)
