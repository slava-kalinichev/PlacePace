import { describe, expect, it } from 'vitest';
import { displayedWorkTime } from './workHours';

describe('displayedWorkTime', () => {
  it('показывает часы, по которым строилось расписание', () => {
    expect(displayedWorkTime({ workTime: '10:00-18:00', workTimeDay: '10:00-21:00' })).toBe('10:00-21:00');
  });

  it('у старых маршрутов остаются исходные часы', () => {
    expect(displayedWorkTime({ workTime: '10:00-18:00' })).toBe('10:00-18:00');
  });

  it('без часов возвращает undefined', () => {
    expect(displayedWorkTime({})).toBeUndefined();
  });
});
