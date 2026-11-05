import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import OnItApp from './onit/OnItApp.tsx'
import { detectDeviceKind, resolveForceOverride } from './utils/deviceDetect'
import { installUiScale } from './utils/uiScale'

// выбор между десктопной версией и On It до монтирования React
const forced = resolveForceOverride();
const deviceKind = forced ?? detectDeviceKind();
const isOnItPath = window.location.pathname === '/onit';
const shouldRenderOnIt = deviceKind === 'mobile';

// Путь в адресной строке соответствует смонтированной версии
if (shouldRenderOnIt && !isOnItPath) {
    window.history.replaceState({}, '', '/onit' + window.location.search);
} else if (!shouldRenderOnIt && isOnItPath) {
    window.history.replaceState({}, '', '/' + window.location.search);
}

// Масштаб интерфейса - только для десктопа
if (!shouldRenderOnIt) {
    installUiScale();
}

createRoot(document.getElementById('root')!).render(
    shouldRenderOnIt ? <OnItApp /> : <App />
)
