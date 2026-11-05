// Экспорт маршрута: PDF, JSON, ссылка

import { withUiScaleSuspended } from './uiScale';

export const sanitizeFilename = (name: string) => name.trim().replace(/[/\\:*?"<>|]/g, '_');

export const computeRouteAggregates = (routeData: any[]) => {
  if (!routeData || routeData.length === 0) return { duration: 0, cost: 0 };
  const [sh, sm] = (routeData[0].time || '00:00').split(':').map(Number);
  const [eh, em] = (routeData[routeData.length - 1].time || '00:00').split(':').map(Number);
  let duration = (eh * 60 + em) - (sh * 60 + sm);
  if (duration < 0) duration += 1440;
  // round убирает погрешность float
  const cost = Math.round(routeData.reduce((sum, item) => sum + (item.cost || 0), 0));
  return { duration, cost };
};

// Снимок маршрута -> PDF (A4, разрез между блоками строк)
export const exportRoutePDF = (containerEl: HTMLElement, filenameBase: string) =>
  // На время рендера масштаб интерфейса отключается
  withUiScaleSuspended(() => renderRoutePDF(containerEl, filenameBase));

const renderRoutePDF = async (containerEl: HTMLElement, filenameBase: string) => {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  // Границы блоков измеряем до рендера в canvas
  const containerRect = containerEl.getBoundingClientRect();
  const blockBottomsCss = Array.from(containerEl.querySelectorAll<HTMLElement>('[data-row-block]'))
    .map(el => el.getBoundingClientRect().bottom - containerRect.top);

  const canvas = await html2canvas(containerEl, { scale: 2, backgroundColor: '#ffffff' });
  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'pt', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  // Переводим CSS-пиксели в pt
  const ptPerCssPx = imgWidth / containerRect.width;
  const blockBottomsPt = blockBottomsCss.map(b => b * ptPerCssPx);

  // Разрез страницы - по последней границе блока, помещающейся на страницу
  const cuts: number[] = [];
  let cursor = 0;
  while (cursor < imgHeight) {
    const budget = cursor + pageHeight;
    if (budget >= imgHeight) {
      cuts.push(imgHeight);
      break;
    }
    const candidates = blockBottomsPt.filter(b => b > cursor && b <= budget);
    cuts.push(candidates.length > 0 ? candidates[candidates.length - 1] : budget);
    cursor = cuts[cuts.length - 1];
  }

  // addImage рисует изображение целиком, лишнее обрезает страница
  let pageStart = 0;
  cuts.forEach((cutEnd, idx) => {
    if (idx > 0) pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, -pageStart, imgWidth, imgHeight);
    const localCutY = cutEnd - pageStart;
    if (localCutY < pageHeight) {
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, localCutY, pageWidth, pageHeight - localCutY, 'F');
    }
    pageStart = cutEnd;
  });

  pdf.save(`${filenameBase}.pdf`);
};

export const downloadJSON = (payload: object, filenameBase: string) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filenameBase}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Ссылка на главную с ?route=<uuid>
export const copyRouteLink = async (publicId: string): Promise<boolean> => {
  const link = `${window.location.origin}/?route=${publicId}`;
  try {
    await navigator.clipboard.writeText(link);
    return true;
  } catch (e) {
    return false;
  }
};

// Копирование ссылки, id которой появится позже (запись в буфер стартует в жесте пользователя)
export const copyRouteLinkDeferred = async (idPromise: Promise<string>): Promise<boolean> => {
  const toLink = (id: string) => `${window.location.origin}/?route=${id}`;
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = idPromise.then((id) => new Blob([toLink(id)], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return true;
    } catch {
      // при ошибке используем запасной путь ниже
    }
  }
  try {
    return await copyRouteLink(await idPromise);
  } catch {
    return false;
  }
};
