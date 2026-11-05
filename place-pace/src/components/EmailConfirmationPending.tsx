// Экран ожидания подтверждения почты (регистрация и смена email)
import { useEffect, useRef, useState } from 'react';
import { EnvelopeIcon } from './sfSymbols';
import { showInfoPlaque } from './InfoPlaque';
import { useTranslation} from '../i18n/LanguageContext';

// Кулдаун повторной отправки, как на бэкенде
const RESEND_COOLDOWN_SECONDS = 120;

interface ResendOutcome {
  success: boolean;
  error?: string;
  retry_after?: number;
  email?: string;
}

interface EmailConfirmationPendingProps {
  email: string;
  variant: 'register' | 'change';
  // Исправление адреса и повторная отправка письма
  onChangeEmail: (newEmail: string) => Promise<ResendOutcome>;
  onResend: () => Promise<ResendOutcome>;
}

const EmailConfirmationPending = ({ email, variant, onChangeEmail, onResend }: EmailConfirmationPendingProps) => {
  const { t } = useTranslation();
  const [cooldown, setCooldown] = useState(() => ({
    availableAt: Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
    durationMs: RESEND_COOLDOWN_SECONDS * 1000,
    key: 0,
  }));
  const [now, setNow] = useState(() => Date.now());
  // Полоска таймера стартует полной и сжимается на следующем кадре
  const [shrinking, setShrinking] = useState(false);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftEmail, setDraftEmail] = useState(email);
  const [savingEmail, setSavingEmail] = useState(false);
  const isFirstEmail = useRef(true);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setShrinking(false);
    const raf = requestAnimationFrame(() => setShrinking(true));
    return () => cancelAnimationFrame(raf);
  }, [cooldown.key]);

  // Адрес изменился: кулдаун стартует заново (первый рендер пропускаем)
  useEffect(() => {
    if (isFirstEmail.current) {
      isFirstEmail.current = false;
      return;
    }
    setDraftEmail(email);
    setCooldown(prev => ({
      availableAt: Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
      durationMs: RESEND_COOLDOWN_SECONDS * 1000,
      key: prev.key + 1,
    }));
  }, [email]);

  const remainingMs = Math.max(0, cooldown.availableAt - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const canResend = remainingMs <= 0 && !sending;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeLabel = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  const handleConfirmChange = async () => {
    const trimmed = draftEmail.trim().toLowerCase();
    if (!trimmed || trimmed === email.toLowerCase()) {
      setEditing(false);
      setDraftEmail(email);
      return;
    }
    setSavingEmail(true);
    const result = await onChangeEmail(trimmed);
    setSavingEmail(false);
    if (result.success) {
      setEditing(false);
      showInfoPlaque(t('Письмо отправлено повторно'), 'info');
    } else if (result.error) {
      showInfoPlaque(t(result.error), 'error');
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setSending(true);
    const result = await onResend();
    setSending(false);
    if (result.success) {
      setCooldown(prev => ({
        availableAt: Date.now() + RESEND_COOLDOWN_SECONDS * 1000,
        durationMs: RESEND_COOLDOWN_SECONDS * 1000,
        key: prev.key+ 1,
      }));
      showInfoPlaque(t('Письмо отправлено повторно'), 'info');
    } else {
      const retryMs = (result.retry_after ?? RESEND_COOLDOWN_SECONDS) * 1000;
      setCooldown(prev => ({ availableAt: Date.now() + retryMs, durationMs: retryMs, key: prev.key + 1 }));
      if (result.error) showInfoPlaque(t(result.error), 'error');
    }
  };

  return (
    <div className="w-full max-w-md flex flex-col items-center text-center">
      <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-5 flex-shrink-0">
        <EnvelopeIcon size={28} color="#007AFF" />
      </div>
      <h3 className="text-lg font-semibold text-gray-800 mb-3">{t('Подтвердите почту')}</h3>
      <p className="text-sm text-gray-500 leading-relaxed mb-1">
        {variant === 'register'
          ? t('Мы отправили письмо со ссылкой для подтверждения на')
          : t('Мы отправили письмо со ссылкой для подтверждения нового email на')}
      </p>
      <p className="text-sm font-medium text-gray-800 mb-1 break-all">{email}</p>
      <p className="text-xs text-gray-400 mb-6">{t('Перейдите по ссылке из письма, чтобы продолжить')}</p>

      {editing ? (
        <div className="w-full flex flex-col items-stretch gap-2 mb-6">
          <input
            type="email"
            value={draftEmail}
            onChange={(e) => setDraftEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirmChange(); } }}
            className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm text-center"
            autoFocus
          />
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => { setEditing(false); setDraftEmail(email); }}
              className="pp-plain text-sm text-gray-500 hover:text-gray-600 cursor-pointer transition-colors"
            >
              {t('Отмена')}
            </button>
            <button
              type="button"
              onClick={handleConfirmChange}
              disabled={savingEmail}
              className="pp-plain text-sm text-blue-500 hover:text-blue-600 cursor-pointer transition-colors"
            >
              {t('Сохранить')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="pp-plain text-sm text-blue-500 hover:text-blue-600 cursor-pointer transition-colors mb-6"
        >
          {t('Я ошибся, изменить email')}
        </button>
      )}

      <div className="w-full">
        <button
          type="button"
          onClick={handleResend}
          disabled={!canResend}
          className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors ${
            canResend ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          {canResend ? t('Отправить письмо повторно') : `${t('Отправить повторно через')} ${timeLabel}`}
        </button>
        {!canResend && (
          <div className="relative h-0.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
            <div
              key={cooldown.key}
              className="absolute inset-y-0 left-0 w-full bg-blue-400 rounded-full"
              style={{
                transformOrigin: 'left',
                transform: shrinking ? 'scaleX(0)' : 'scaleX(1)',
                transition: shrinking ? `transform ${cooldown.durationMs}ms linear` : 'none',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default EmailConfirmationPending;
