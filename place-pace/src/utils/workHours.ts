// Часы работы точки для показа: по которым строилось расписание на дату маршрута, иначе исходные

export const displayedWorkTime = (item: { workTime?: string; workTimeDay?: string }): string | undefined =>
  item.workTimeDay ?? item.workTime;
