import AddressAutocomplete from '../AddressAutocomplete';
import { MinusCircleIcon, PlusCircleIcon, InfoCircleIcon } from '../sfSymbols';
import React from 'react';

export interface RenderStep2Context {
  currentStep: number;
  endPoint: string;
  endPointToggle: boolean;
  endTime: string;
  endTimeInfoArrowOffset: number;
  endTimeInfoTooltipRef: React.RefObject<HTMLDivElement | null>;
  endWithStartPoint: boolean;
  handleBack: () => void;
  handleOptimize: () => Promise<void>;
  homeAddressInfo: { address: string; lat: number; lon: number; } | null;
  peopleCount: number;
  routeDate: string;
  setEndPoint: React.Dispatch<React.SetStateAction<string>>;
  setEndPointCoords: React.Dispatch<React.SetStateAction<{ lat: number; lon: number; } | null>>;
  setEndPointToggle: React.Dispatch<React.SetStateAction<boolean>>;
  setEndTime: React.Dispatch<React.SetStateAction<string>>;
  setEndWithStartPoint: React.Dispatch<React.SetStateAction<boolean>>;
  setPeopleCount: React.Dispatch<React.SetStateAction<number>>;
  setRouteDate: React.Dispatch<React.SetStateAction<string>>;
  setShowEndTimeInfo: React.Dispatch<React.SetStateAction<boolean>>;
  setStartPoint: React.Dispatch<React.SetStateAction<string>>;
  setStartPointCoords: React.Dispatch<React.SetStateAction<{ lat: number; lon: number; } | null>>;
  setStartPointToggle: React.Dispatch<React.SetStateAction<boolean>>;
  setStartTime: React.Dispatch<React.SetStateAction<string>>;
  setValidationErrors: React.Dispatch<React.SetStateAction<{ date?: boolean; startPoint?: boolean; startTime?: boolean; endPoint?: boolean; }>>;
  showEndTimeInfo: boolean;
  startPoint: string;
  startPointToggle: boolean;
  startTime: string;
  t: (ru: string) => string;
  validationErrors: { date?: boolean; startPoint?: boolean; startTime?: boolean; endPoint?: boolean; };
}

export const renderStep2 = (ctx: RenderStep2Context) => {
  const { currentStep, endPoint, endPointToggle, endTime, endTimeInfoArrowOffset, endTimeInfoTooltipRef, endWithStartPoint, handleBack, handleOptimize, homeAddressInfo, peopleCount, routeDate, setEndPoint, setEndPointCoords, setEndPointToggle, setEndTime, setEndWithStartPoint, setPeopleCount, setRouteDate, setShowEndTimeInfo, setStartPoint, setStartPointCoords, setStartPointToggle, setStartTime, setValidationErrors, showEndTimeInfo, startPoint, startPointToggle, startTime, t, validationErrors } = ctx;
  const showEndWithStartToggle = !startPointToggle && !endPointToggle;

  return (
    <div className="min-w-full h-full flex flex-col p-6 overflow-y-auto" inert={currentStep !== 1}>
      <div className="mb-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">2/4</span>
          <h2 className="text-xl font-semibold text-gray-800">{t('Параметры маршрута')}</h2>
        </div>
        <p className="text-sm text-gray-500 mt-1">{t('Укажите данные о маршруте')}</p>
      </div>

      <div className="flex-1 flex flex-col gap-4 max-w-2xl mx-auto w-full justify-center">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700 w-40 flex-shrink-0">{t('Дата прохождения:')}</label>
          <input
            type="date"
            value={routeDate}
            onChange={(e) => {
              setRouteDate(e.target.value);
              setValidationErrors(prev => ({ ...prev, date: false }));
            }}
            className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm ${
              validationErrors.date ? 'border-red-500 ring-2 ring-red-200' : 'border-gray-200'
            }`}
          />
        </div>

        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700 w-40 flex-shrink-0">{t('Начальная точка:')}</label>
          <div className="flex-1 flex items-center gap-3">
            <AddressAutocomplete
              value={startPoint}
              onChange={(text) => {
                setStartPoint(text);
                setValidationErrors(prev => ({ ...prev, startPoint: false }));
              }}
              onResolve={(confirmed) => setStartPointCoords(confirmed ? { lat: confirmed.lat, lon: confirmed.lon } : null)}
              placeholder={t('Введите адрес')}
              disabled={startPointToggle}
              hasError={!!validationErrors.startPoint}
              homeAddress={homeAddressInfo}
            />
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-gray-500">{t('Согласовать с первой точкой маршрута')}</span>
              <button
                onClick={() => {
                  setStartPointToggle(!startPointToggle);
                  if (!startPointToggle) {
                    setStartPoint('');
                    setStartPointCoords(null);
                  }
                  if (!startPointToggle) {
                    setEndWithStartPoint(false);
                  }
                  setValidationErrors(prev => ({ ...prev, startPoint: false }));
                }}
                className={`relative w-[3.15rem] h-[1.434375rem] rounded-full transition-colors flex-shrink-0 ${
                  startPointToggle ? 'bg-[#007AFF]' : 'bg-gray-300'
                }`}
              >
                <div className={`
                  absolute top-[0.140625rem] w-[1.8rem] h-[1.153125rem] bg-white rounded-full shadow-sm transition-all
                  ${startPointToggle ? 'left-[1.19375rem]' : 'left-[0.15625rem]'}
                `} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700 w-40 flex-shrink-0">{t('Время начала:')}</label>
          <input
            type="time"
            value={startTime}
            onChange={(e) => {
              setStartTime(e.target.value);
              setValidationErrors(prev => ({ ...prev, startTime: false }));
            }}
            className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm ${
              validationErrors.startTime ? 'border-red-500 ring-2 ring-red-200' : 'border-gray-200'
            }`}
          />
        </div>

        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700 w-40 flex-shrink-0">{t('Количество человек:')}</label>
          <div className="flex-1 flex items-center gap-3">
            <button
              onClick={() => setPeopleCount(Math.max(1, peopleCount - 1))}
              className="w-8 h-8 rounded-full flex items-center justify-center text-black"
            >
              <MinusCircleIcon size={24} />
            </button>
            <span className="text-lg font-medium text-gray-800 w-8 text-center">{peopleCount}</span>
            <button
              onClick={() => setPeopleCount(peopleCount + 1)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-black"
            >
              <PlusCircleIcon size={24} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700 w-40 flex-shrink-0">{t('Конечная точка:')}</label>
          <div className="flex-1 flex items-center gap-3">
            <AddressAutocomplete
              value={endPoint}
              onChange={(text) => {
                setEndPoint(text);
                setValidationErrors(prev => ({ ...prev, endPoint: false }));
              }}
              onResolve={(confirmed) => setEndPointCoords(confirmed ? { lat: confirmed.lat, lon: confirmed.lon } : null)}
              placeholder={t('Введите адрес')}
              disabled={endPointToggle || endWithStartPoint}
              hasError={!!validationErrors.endPoint}
              homeAddress={homeAddressInfo}
            />
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-gray-500">{t('Согласовать с последней точкой маршрута')}</span>
              <button
                onClick={() => {
                  setEndPointToggle(!endPointToggle);
                  if (!endPointToggle) {
                    setEndPoint('');
                    setEndPointCoords(null);
                  }
                  if (!endPointToggle) {
                    setEndWithStartPoint(false);
                  }
                  setValidationErrors(prev => ({ ...prev, endPoint: false }));
                }}
                className={`relative w-[3.15rem] h-[1.434375rem] rounded-full transition-colors flex-shrink-0 ${
                  endPointToggle ? 'bg-[#007AFF]' : 'bg-gray-300'
                }`}
              >
                <div className={`
                  absolute top-[0.140625rem] w-[1.8rem] h-[1.153125rem] bg-white rounded-full shadow-sm transition-all
                  ${endPointToggle ? 'left-[1.19375rem]' : 'left-[0.15625rem]'}
                `} />
              </button>
            </div>
          </div>
        </div>

        <div className={`
          flex items-center gap-4 pl-[11rem] transition-all duration-300 overflow-hidden
          ${showEndWithStartToggle ? 'max-h-12 opacity-100' : 'max-h-0 opacity-0'}
        `}>
          <div className="flex-1 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{t('Согласовать с начальной точкой маршрута')}</span>
              <button
                onClick={() => {
                  setEndWithStartPoint(!endWithStartPoint);
                  if (!endWithStartPoint) {
                    setEndPoint('');
                    setEndPointCoords(null);
                  }
                  setValidationErrors(prev => ({ ...prev, endPoint: false }));
                }}
                className={`relative w-[3.15rem] h-[1.434375rem] rounded-full transition-colors flex-shrink-0 ${
                  endWithStartPoint ? 'bg-[#007AFF]' : 'bg-gray-300'
                }`}
              >
                <div className={`
                  absolute top-[0.140625rem] w-[1.8rem] h-[1.153125rem] bg-white rounded-full shadow-sm transition-all
                  ${endWithStartPoint ? 'left-[1.19375rem]' : 'left-[0.15625rem]'}
                `} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className={`text-sm font-medium w-40 flex-shrink-0 ${endTime ? 'text-gray-700' : 'text-gray-400'}`}>{t('Время окончания:')}</label>
          <div className="flex-1 flex items-center gap-2">
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={`flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm ${
                endTime ? 'text-gray-800' : 'text-gray-400'
              }`}
              placeholder={t('Необязательно')}
            />
            <div className="relative">
              <button
                onMouseEnter={() => setShowEndTimeInfo(true)}
                onMouseLeave={() => setShowEndTimeInfo(false)}
                className="w-6 h-6 rounded-full text-gray-400 flex items-center justify-center"
              >
                <InfoCircleIcon size={20} />
              </button>
              {showEndTimeInfo && (
                <div
                  ref={endTimeInfoTooltipRef}
                  className="pp-tooltip-wrap absolute bottom-full mb-2 left-1/2 w-64"
                  style={{ transform: `translateX(calc(-50% + ${endTimeInfoArrowOffset}px))` }}
                >
                  <div className="pp-tooltip">
                    {t('Модель постарается уложиться в указанное время по мере возможности')}
                  </div>
                  <div
                    className="pp-tooltip-arrow pp-tooltip-arrow--bottom"
                    style={{ left: `calc(50% - ${endTimeInfoArrowOffset}px)` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between mt-4 pt-3 border-t border-gray-100 flex-shrink-0">
        <button
          onClick={handleBack}
          className="pp-btn-white px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-medium transition-colors"
        >
          {t('Назад')}
        </button>
        <button
          onClick={handleOptimize}
          className="px-6 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          {t('Оптимизировать')}
        </button>
      </div>
    </div>
  );
};
