from ortools.constraint_solver import routing_enums_pb2, pywrapcp
import logging

from .time_windows import parse_work_time

logger = logging.getLogger(__name__)


class OptimizationService:
    def __init__(self):
        self.time_limit_seconds = 10

    def optimize_route(self, places, travel_matrix, start_time, end_time=None,
                        start_place_index=None, end_place_index=None,
                        start_terminal_costs=None, end_terminal_costs=None,
                        force_edges=None, time_limit_seconds=None):
        """Оптимизация маршрута (OR-Tools) с временными окнами; force_edges - пары мест, идущие строго подряд"""
        num_places = len(places)
        if num_places == 0:
            return {'order': [], 'schedule': [], 'total_time': 0, 'total_cost': 0}

        start_minutes = self._time_to_minutes(start_time)
        end_minutes = self._get_end_time(places, end_time)

        logger.info(f"Доступное время: {start_minutes} - {end_minutes} минут")
        logger.info(f"Количество мест: {num_places}")

        # Фиктивный депо-узел как старт и финиш, если точки не заданы
        depot_node = num_places
        start_node = start_place_index if start_place_index is not None else depot_node
        end_node = end_place_index if end_place_index is not None else depot_node

        manager = pywrapcp.RoutingIndexManager(num_places + 1, 1, [start_node], [end_node])
        routing = pywrapcp.RoutingModel(manager)

        # Время в пути плюс длительность осмотра; рёбра депо учитывают адресные терминалы
        def time_callback(from_index, to_index):
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            if from_node >= num_places and to_node >= num_places:
                return 0
            if from_node >= num_places:
                return start_terminal_costs[to_node] if start_terminal_costs else 0
            if to_node >= num_places:
                return end_terminal_costs[from_node] if end_terminal_costs else 0
            duration = places[from_node].get('recommended_duration', 60)
            return travel_matrix[from_node][to_node] + duration

        transit_callback_index = routing.RegisterTransitCallback(time_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

        # Временные окна; slack позволяет ждать открытия места
        time_dimension_name = 'Time'
        routing.AddDimension(
            transit_callback_index,
            240,
            1440,
            False,
            time_dimension_name
        )
        time_dimension = routing.GetDimensionOrDie(time_dimension_name)

        # Старт тура фиксирован на времени начала
        start_index = routing.Start(0)
        time_dimension.CumulVar(start_index).SetRange(start_minutes, start_minutes)

        # Окна мест; пустое окно делает оптимизацию неуспешной
        infeasible_window_place = None
        for place_index in range(num_places):
            index = manager.NodeToIndex(place_index)
            work_time = places[place_index].get('work_time', '00:00-23:59')
            window_start, window_end = self._parse_work_time(work_time)

            window_start = max(window_start, start_minutes)
            # CumulVar - время прибытия, поэтому вычитаем длительность осмотра
            duration = places[place_index].get('recommended_duration', 60)
            window_end = min(window_end, end_minutes) - duration

            # Окно нулевой ширины допустимо
            if window_start > window_end:
                logger.warning(f"Некорректное окно для {places[place_index]['name']}: {window_start}-{window_end}")
                if infeasible_window_place is None:
                    infeasible_window_place = places[place_index]['name']
                continue

            time_dimension.CumulVar(index).SetRange(window_start, window_end)
            logger.info(f"{places[place_index]['name']}: окно {window_start}-{window_end}")

        if infeasible_window_place is not None:
            return {
                'error': f"Указанного времени недостаточно, чтобы успеть посетить «{infeasible_window_place}» "
                         f"(и, возможно, другие точки) до выбранного времени окончания маршрута"
            }

        # Возвращение к терминалу финиша тоже укладывается в end_time
        if end_terminal_costs is not None:
            end_index = routing.End(0)
            time_dimension.CumulVar(end_index).SetRange(0, end_minutes)

        # Принудительные пары мест подряд
        for from_node, to_node in (force_edges or []):
            from_index = manager.NodeToIndex(from_node)
            to_index = manager.NodeToIndex(to_node)
            routing.NextVar(from_index).SetValues([to_index])

        # Настройка поиска
        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
        search_parameters.time_limit.seconds = time_limit_seconds or self.time_limit_seconds
        search_parameters.first_solution_strategy = (
            routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
        )
        search_parameters.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        )

        solution = routing.SolveWithParameters(search_parameters)

        if not solution:
            logger.warning("Не найдено решение для маршрута")
            suggested = self._suggest_start_time(places, start_minutes)
            if suggested is not None:
                return {
                    'error': f"С таким временем начала маршрут не построить - "
                             f"часть мест ещё закрыта. Попробуйте начать не раньше {suggested}",
                    'suggested_start_time': suggested,
                }
            return {'error': 'Не удалось найти оптимальный маршрут. Попробуйте изменить параметры.'}

        logger.info("Решение найдено!")
        result = self._extract_solution(places, manager, routing, solution, time_dimension)

        # Финальная проверка часов работы
        for item in result['schedule']:
            place = next((p for p in places if p['id'] == item['place_id']), None)
            if place:
                work_time = place.get('work_time', '00:00-23:59')
                if work_time and work_time != '-' and work_time != 'Круглосуточно':
                    try:
                        parts = work_time.split('-')
                        if len(parts) == 2:
                            open_str = parts[0].strip()
                            close_str = parts[1].strip()
                            open_minutes = self._time_to_minutes(open_str)
                            close_minutes = self._time_to_minutes(close_str)
                            arrival_minutes = self._time_to_minutes(item['arrival'])
                            departure_minutes = self._time_to_minutes(item['departure'])

                            if arrival_minutes < open_minutes:
                                logger.warning(
                                    f"{place['name']} открывается в {open_str}, а прибытие в {item['arrival']}")
                                return {
                                    'error': f"«{place['name']}» открывается в {open_str}, "
                                             f"а по расчёту вы будете там уже в {item['arrival']}"
                                }

                            if departure_minutes > close_minutes:
                                logger.warning(
                                    f"{place['name']} закрывается в {close_str}, а посещение до {item['departure']}")
                                return {
                                    'error': f"«{place['name']}» закрывается в {close_str}, "
                                             f"а по расчёту вы будете там до {item['departure']}"
                                }
                    except:
                        pass

        return result

    def _suggest_start_time(self, places, start_minutes):
        """Ближайшее время открытия мест, если старт слишком ранний"""
        opening_times = []
        for place in places:
            window_start, _ = self._parse_work_time(place.get('work_time', '00:00-23:59'))
            opening_times.append(window_start)

        if not opening_times:
            return None

        earliest_open = min(opening_times)
        if earliest_open <= start_minutes:
            # проблема не в часах работы - подсказать нечего
            return None

        return self._minutes_to_time(earliest_open)

    def _parse_work_time(self, work_time_str):
        """Разбор часов работы (общий модуль time_windows)"""
        return parse_work_time(work_time_str)

    def _time_to_minutes(self, time_str):
        """Преобразование строки времени в минуты"""
        if not time_str:
            return 0
        try:
            parts = time_str.split(':')
            return int(parts[0]) * 60 + int(parts[1])
        except:
            return 0

    def _get_end_time(self, places, user_end_time):
        """Определение конечного времени маршрута"""
        if user_end_time:
            return self._time_to_minutes(user_end_time)

        max_end = 0
        for place in places:
            work_time = place.get('work_time', '00:00-23:59')
            if work_time and work_time != '-' and work_time != 'Круглосуточно':
                try:
                    if '-' in work_time:
                        parts = work_time.split('-')
                        if len(parts) == 2:
                            end = self._time_to_minutes(parts[1].strip())
                            if end > max_end:
                                max_end = end
                except:
                    continue

        if max_end == 0:
            max_end = 1440

        return max_end

    def _extract_solution(self, places, manager, routing, solution, time_dimension):
        """Извлечение решения из OR-Tools"""
        order = []
        schedule = []
        total_time = 0
        total_cost = 0

        index = routing.Start(0)
        while not routing.IsEnd(index):
            node_index = manager.IndexToNode(index)
            if node_index < len(places):
                place = places[node_index]
                order.append(place['id'])

                time_var = time_dimension.CumulVar(index)
                arrival_minutes = solution.Value(time_var)
                duration = place.get('recommended_duration', 60)
                departure_minutes = arrival_minutes + duration

                schedule.append({
                    'place_id': place['id'],
                    'arrival': self._minutes_to_time(arrival_minutes),
                    'departure': self._minutes_to_time(departure_minutes),
                    'duration': duration
                })

                total_time += duration
                total_cost += place.get('ticket_price', 0)

            index = solution.Value(routing.NextVar(index))

        return {
            'order': order,
            'schedule': schedule,
            'total_time': total_time,
            'total_cost': total_cost
        }

    def _minutes_to_time(self, minutes):
        """Минуты в 'HH:MM' (после полуночи 00:05, а не 24:05)"""
        wrapped = minutes % 1440
        hours = wrapped // 60
        mins = wrapped % 60
        return f"{hours:02d}:{mins:02d}"