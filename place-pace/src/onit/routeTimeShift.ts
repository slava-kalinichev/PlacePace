// Клиентский предпросмотр каскадного сдвига времени (без сетевых вызовов)

// Плейсхолдеры "времени нет" не сдвигаем
function isRealTime(value: unknown): value is string {
  return typeof value === 'string' && value !== '-' && value !== '--:--';
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

// Минуты в 'HH:MM' без заворота за полночь
export function minutesToTime(minutes: number): string {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = ((rounded % 60) + 60) % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function shiftField(value: unknown, delta: number): unknown {
  if (!isRealTime(value)) return value;
  return minutesToTime(timeToMinutes(value) + delta);
}

// Новый массив: отредактированная точка меняется напрямую, всё после неё сдвигается на delta
export function shiftStopTime(
  routeData: any[],
  stopItemId: string | number,
  newStart: number,
  newEnd: number,
  _syncEnabled: boolean
): any[] {
  const idx = routeData.findIndex(item => item.id === stopItemId);
  if (idx === -1) return routeData;

  const edited = routeData[idx];
  const oldEnd = timeToMinutes(edited.endTime);
  const delta = newEnd - oldEnd;

  return routeData.map((item, i) => {
    if (i < idx) return item;
    if (i === idx) {
      return {
        ...item,
        time: minutesToTime(newStart),
        endTime: minutesToTime(newEnd),
        // Длительность считается из фактических значений
        duration: newEnd - newStart,
      };
    }
    if (delta === 0) return item;
    return {
      ...item,
      time: shiftField(item.time, delta),
      endTime: shiftField(item.endTime, delta),
    };
  });
}
