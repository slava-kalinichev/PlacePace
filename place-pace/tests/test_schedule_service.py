from datetime import date

from backend.services.schedule_service import ScheduleService

MONDAY = '2026-11-09'


def _check(places, day=MONDAY):
    assert date.fromisoformat(MONDAY).weekday() == 0
    return ScheduleService.check_schedules(places, day)


def test_plain_work_time_is_valid():
    result = _check([{'name': 'Музей', 'work_time': '10:00-18:00'}])
    assert [p['name'] for p in result['valid_places']] == ['Музей']
    assert not result['excluded_places']


def test_missing_or_round_the_clock_is_valid():
    places = [{'name': 'A', 'work_time': ''}, {'name': 'B', 'work_time': '-'}, {'name': 'C', 'work_time': 'Круглосуточно'}]
    assert len(_check(places)['valid_places']) == 3


def test_unparsable_work_time_is_excluded():
    result = _check([{'name': 'Тайное место', 'work_time': 'по записи'}])
    assert result['excluded_places'] and 'Тайное место' in result['warnings'][0]


def test_closed_on_weekday_is_excluded():
    schedule = {'Tue': {'from': '10:00', 'to': '18:00'}}
    result = _check([{'name': 'Музей', 'work_time': '10:00-18:00', 'schedule': schedule}])
    assert result['excluded_places']
    assert 'по понедельникам' in result['warnings'][0]


def test_day_hours_replace_default_work_time():
    schedule = {'Mon': {'from': '09:00', 'to': '20:00'}}
    result = _check([{'name': 'Парк', 'work_time': '10:00-18:00', 'schedule': schedule}])
    assert result['valid_places'][0]['work_time'] == '09:00-20:00'


def test_full_day_schedule_becomes_round_the_clock():
    schedule = {'Mon': {'from': '00:00', 'to': '24:00'}}
    result = _check([{'name': 'Парк', 'work_time': '10:00-18:00', 'schedule': schedule}])
    assert result['valid_places'][0]['work_time'] == 'Круглосуточно'


def test_holiday_closure_is_excluded():
    schedule = {'Mon': {'from': '10:00', 'to': '18:00'}, 'comment': '9 ноября - выходной день'}
    result = _check([{'name': 'Музей', 'work_time': '10:00-18:00', 'schedule': schedule}])
    assert result['excluded_places']


def test_holiday_with_changed_hours_only_warns():
    schedule = {'Mon': {'from': '10:00', 'to': '18:00'}, 'comment': '9 ноября 10:00-16:00'}
    result = _check([{'name': 'Музей', 'work_time': '10:00-18:00', 'schedule': schedule}])
    assert result['holiday_places'] == ['Музей']
    assert len(result['valid_places']) == 1


def test_invalid_date_falls_back_to_work_time():
    result = _check([{'name': 'Музей', 'work_time': '10:00-18:00'}], day='не дата')
    assert len(result['valid_places']) == 1
