import { useEffect, useRef, useState } from 'react';
import { mapService } from '../services/mapService';
import { useTranslation } from '../i18n/LanguageContext';

interface Suggestion {
  title: string;
  subtitle: string;
}

interface ResolvedAddress {
  address: string;
  lat: number;
  lon: number;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (text: string) => void;
  onResolve: (confirmed: ResolvedAddress | null) => void;
  disabled?: boolean;
  placeholder?: string;
  hasError?: boolean;
  // Адрес дома или отеля из личного кабинета (подставляется по Enter)
  homeAddress?: ResolvedAddress | null;
  // 16px шрифт на мобильном, чтобы iOS не зумила страницу
  fullBleedMobile?: boolean;
}

// Поле адреса с подсказками Геосаджеста; правка текста сбрасывает подтверждение
const AddressAutocomplete = ({ value, onChange, onResolve, disabled, placeholder, hasError, homeAddress, fullBleedMobile }: AddressAutocompleteProps) => {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const text = value.trim();
    if (text.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const results = await mapService.suggestAddress(text);
      setSuggestions(results);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [value]);

  const handleSelect = async (suggestion: Suggestion) => {
    setShowDropdown(false);
    setSuggestions([]);
    setResolveError(null);
    // Координаты получаем геокодированием текста подсказки
    const queryText = suggestion.subtitle
      ? `${suggestion.subtitle}, ${suggestion.title}`
      : suggestion.title;
    const resolved = await mapService.resolveAddress(queryText);
    if ('error' in resolved) {
      setResolveError(t(resolved.error));
      onResolve(null);
    } else {
      onChange(resolved.address);
      onResolve(resolved);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onResolve(null);
          setResolveError(null);
        }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => {
          // Задержка, чтобы список не закрылся до клика
          blurTimer.current = setTimeout(() => setShowDropdown(false), 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && homeAddress?.address) {
            e.preventDefault();
            setShowDropdown(false);
            setSuggestions([]);
            setResolveError(null);
            onChange(homeAddress.address);
            onResolve(homeAddress);
          }
        }}
        disabled={disabled}
        placeholder={placeholder}
        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 ${fullBleedMobile ? 'text-base' : 'text-sm'} ${
          disabled
            ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
            : hasError
              ? 'border-red-500 ring-2 ring-red-200'
              : 'border-gray-200'
        }`}
      />
      {resolveError && (
        <div className="mt-1 text-xs text-red-500 whitespace-nowrap overflow-hidden text-ellipsis">{resolveError}</div>
      )}
      {hasError && !resolveError && (
        <div className="mt-1 text-xs text-red-500 whitespace-nowrap overflow-hidden text-ellipsis">{t('Выберите адрес из списка')}</div>
      )}
      {showDropdown && !disabled && (loading || suggestions.length > 0) && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {loading && suggestions.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">{t('Поиск адресов...')}</div>
          )}
          {suggestions.map((s, i) => (
            <button
              key={`${s.title}_${s.subtitle}_${i}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(s)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0"
            >
              <div className="text-sm text-gray-800">{s.title}</div>
              {s.subtitle && <div className="text-xs text-gray-400">{s.subtitle}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AddressAutocomplete;
