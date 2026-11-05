"""Построение мультимодального GTFS-фида Москвы (автобусы, трамваи, метро, МЦК, МЦД) для OpenTripPlanner"""
import csv
import io
import math
import os
import re
import threading
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from itertools import combinations

import osmium
import requests

API = "https://apidata.mos.ru/v1"
MOS_API_KEY = os.environ["MOS_API_KEY"]
OSM_PBF = os.path.join(os.path.dirname(__file__), "..", "docker", "osrm-data", "central-fed-district-latest.osm.pbf")
OUT_ZIP = os.path.join(os.path.dirname(__file__), "..", "docker", "otp-data", "moscow-gtfs.zip")
SESSION = requests.Session()


def api_get(path, **params):
    # API понимает только OData-стиль $top/$skip
    for key in ("top", "skip"):
        if key in params:
            params[f"${key}"] = params.pop(key)
    params["api_key"] = MOS_API_KEY
    r = SESSION.get(f"{API}{path}", params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def seconds_to_gtfs_time(total_seconds):
    h = int(total_seconds // 3600)
    m = int((total_seconds % 3600) // 60)
    s = int(total_seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


class GTFS:
    def __init__(self):
        self.agency = []
        self.routes = []
        self.stops = {}  # stop_id -> row dict (dedup)
        self.trips = []
        self.stop_times = []
        self.frequencies = []
        self.pathways = []
        self.transfers = []
        self.calendar = [{
            "service_id": "ALWAYS",
            "monday": 1, "tuesday": 1, "wednesday": 1, "thursday": 1,
            "friday": 1, "saturday": 1, "sunday": 1,
            "start_date": "20250101", "end_date": "20301231",
        }]

    def add_stop(self, stop_id, name, lat, lon, location_type=0, parent_station=""):
        """location_type: 0 - платформа, 1 - станция, 2 - вход/выход; parent_station - родительская станция"""
        self.stops[stop_id] = {
            "stop_id": stop_id, "stop_name": name, "stop_lat": lat, "stop_lon": lon,
            "location_type": location_type, "parent_station": parent_station,
        }

    def add_pathway(self, pathway_id, from_stop_id, to_stop_id, traversal_time_s, mode=1):
        """Двунаправленная пешеходная связь вход <-> платформа"""
        self.pathways.append({
            "pathway_id": pathway_id, "from_stop_id": from_stop_id, "to_stop_id": to_stop_id,
            "pathway_mode": mode, "is_bidirectional": 1,
            "traversal_time": max(1, int(round(traversal_time_s))),
        })

    def add_transfer(self, from_stop_id, to_stop_id, min_transfer_time_s):
        """Явная пересадка между станциями разных линий метро"""
        self.transfers.append({
            "from_stop_id": from_stop_id, "to_stop_id": to_stop_id,
            "transfer_type": 2, "min_transfer_time": max(30, int(round(min_transfer_time_s))),
        })

    def add_route(self, route_id, agency_id, short_name, long_name, route_type):
        self.routes.append({
            "route_id": route_id, "agency_id": agency_id,
            "route_short_name": short_name or "", "route_long_name": long_name or "",
            "route_type": route_type,
        })

    def add_frequency_trip(self, trip_id, route_id, headsign, stop_seq, headway_s,
                            span_start_s, span_end_s, dwell_s=20):
        """stop_seq: list of (stop_id, offset_seconds_from_trip_start)"""
        if len(stop_seq) < 2:
            return
        self.trips.append({
            "route_id": route_id, "service_id": "ALWAYS", "trip_id": trip_id,
            "trip_headsign": headsign or "",
        })
        for i, (stop_id, offset) in enumerate(stop_seq):
            t = seconds_to_gtfs_time(offset)
            self.stop_times.append({
                "trip_id": trip_id, "arrival_time": t, "departure_time": t,
                "stop_id": stop_id, "stop_sequence": i,
            })
        self.frequencies.append({
            "trip_id": trip_id,
            "start_time": seconds_to_gtfs_time(span_start_s),
            "end_time": seconds_to_gtfs_time(span_end_s),
            "headway_secs": int(headway_s),
        })

    def write_zip(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tables = {
            "agency.txt": (self.agency, ["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang"]),
            "routes.txt": (self.routes, ["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"]),
            "stops.txt": (list(self.stops.values()),
                          ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"]),
            "trips.txt": (self.trips, ["route_id", "service_id", "trip_id", "trip_headsign"]),
            "stop_times.txt": (self.stop_times, ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]),
            "frequencies.txt": (self.frequencies, ["trip_id", "start_time", "end_time", "headway_secs"]),
            "pathways.txt": (self.pathways, ["pathway_id", "from_stop_id", "to_stop_id", "pathway_mode",
                                              "is_bidirectional", "traversal_time"]),
            "transfers.txt": (self.transfers, ["from_stop_id", "to_stop_id", "transfer_type", "min_transfer_time"]),
            "calendar.txt": (self.calendar, ["service_id", "monday", "tuesday", "wednesday", "thursday",
                                              "friday", "saturday", "sunday", "start_date", "end_date"]),
        }
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            for filename, (rows, fields) in tables.items():
                buf = io.StringIO()
                w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
                w.writeheader()
                for row in rows:
                    w.writerow(row)
                zf.writestr(filename, buf.getvalue())
        print(f"GTFS zip written: {path}")
        for filename, (rows, _f) in tables.items():
            print(f"  {filename}: {len(rows)} rows")


def _reuse_bus_tram_from_existing_feed(gtfs: GTFS, existing_zip_path):
    """Переиспользует автобусные и трамвайные данные из ранее собранного GTFS-архива"""
    with zipfile.ZipFile(existing_zip_path) as zf:
        def read_csv(name):
            with zf.open(name) as f:
                return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8")))

        old_routes = read_csv("routes.txt")
        bus_route_ids = {r["route_id"] for r in old_routes
                          if not r["route_id"].startswith("osm") and not r["route_id"].startswith("mcd_")}

        for a in read_csv("agency.txt"):
            if a["agency_id"] not in ("metro", "mcd"):
                gtfs.agency.append(a)
        for r in old_routes:
            if r["route_id"] in bus_route_ids:
                gtfs.routes.append(r)

        old_trips = read_csv("trips.txt")
        bus_trips = [t for t in old_trips if t["route_id"] in bus_route_ids]
        bus_trip_ids = {t["trip_id"] for t in bus_trips}
        gtfs.trips.extend(bus_trips)

        used_stop_ids = set()
        for st in read_csv("stop_times.txt"):
            if st["trip_id"] in bus_trip_ids:
                gtfs.stop_times.append(st)
                used_stop_ids.add(st["stop_id"])

        for fr in read_csv("frequencies.txt"):
            if fr["trip_id"] in bus_trip_ids:
                gtfs.frequencies.append(fr)

        for s in read_csv("stops.txt"):
            if s["stop_id"] in used_stop_ids:
                gtfs.stops[s["stop_id"]] = {
                    "stop_id": s["stop_id"], "stop_name": s["stop_name"],
                    "stop_lat": s["stop_lat"], "stop_lon": s["stop_lon"],
                    "location_type": s.get("location_type") or 0,
                    "parent_station": s.get("parent_station") or "",
                }

    print(f"   маршрутов: {len(bus_route_ids)}, рейсов: {len(bus_trips)}, "
          f"остановок: {len(used_stop_ids)}")


# 1. Автобусы и трамваи (apidata.mos.ru)

def build_surface_transport(gtfs: GTFS):
    for row in api_get("/datasets/60663/rows", top=100):
        c = row["Cells"]
        gtfs.agency.append({
            "agency_id": c["agency_code"], "agency_name": c["agency_name"],
            "agency_url": c.get("agency_url") or "https://transport.mos.ru",
            "agency_timezone": "Europe/Moscow", "agency_lang": "ru",
        })
    skip, top = 0, 1000
    for _ in range(50):
        # $skip=0 API не принимает (400) - для первой страницы параметр просто не передаём
        kwargs = {"top": top}
        if skip:
            kwargs["skip"] = skip
        page = api_get("/datasets/60662/features", **kwargs)
        feats = page.get("features", [])
        if not feats:
            break
        for f in feats:
            attrs = f["properties"]["attributes"]
            coords = f["geometry"]["coordinates"]
            gtfs.add_stop(f"s{attrs['stop_id']}", attrs["stop_name"], coords[1], coords[0])
        skip += len(feats)
        if len(feats) < top:
            break
    print(f"   остановок: {skip}")

    # Пересоздаём сессию: после окло 18 страниц GeoJSON запросы зависают
    global SESSION
    SESSION.close()
    SESSION = requests.Session()
    routes = api_get("/datasets/60664/rows", top=1000)  # $top не может быть больше 1000
    limit = os.environ.get("GTFS_ROUTE_LIMIT")
    if limit:
        routes = routes[:int(limit)]
    print(f"   маршрутов: {len(routes)}")

    def to_seconds(tstr):
        h, m, s = tstr.split(":")
        return int(h) * 3600 + int(m) * 60 + int(s)

    # У каждого потока своя requests.Session (общая зависала под нагрузкой)
    thread_local = threading.local()

    def _session():
        if not hasattr(thread_local, "session"):
            thread_local.session = requests.Session()
        return thread_local.session

    def _api_get_threaded(path, **params):
        for key in ("top", "skip"):
            if key in params:
                params[f"${key}"] = params.pop(key)
        params["api_key"] = MOS_API_KEY
        r = _session().get(f"{API}{path}", params=params, timeout=30)
        r.raise_for_status()
        return r.json()

    def fetch_route_frequencies(route_id):
        """Сетевая часть"""
        try:
            trips = _api_get_threaded("/datasets/60665/rows", top=500,
                                       **{"$filter": f"route_id eq '{route_id}'"})
        except requests.RequestException:
            return []
        if not trips:
            return []

        by_direction = defaultdict(list)
        for t in trips:
            by_direction[t["Cells"].get("direction_id", 0)].append(t["Cells"])

        results = []
        for direction, dtrips in by_direction.items():
            sample_trip = dtrips[0]
            trip_id = sample_trip["trip_id"]
            try:
                stimes = _api_get_threaded("/datasets/60661/rows", top=200,
                                            **{"$filter": f"trip_id eq '{trip_id}'"})
            except requests.RequestException:
                continue
            if len(stimes) < 2:
                continue
            stimes.sort(key=lambda r: r["Cells"]["stop_sequence"])

            first_s = to_seconds(stimes[0]["Cells"]["arrival_time"])
            stop_seq = []
            for st in stimes:
                sid = f"s{st['Cells']['stop_id']}"
                offset = to_seconds(st["Cells"]["arrival_time"]) - first_s
                if offset < 0:
                    offset += 24 * 3600
                stop_seq.append((sid, offset))
            if len(stop_seq) < 2:
                continue

            span_seconds = 17 * 3600
            headway = max(180, span_seconds / max(len(dtrips), 1))
            results.append({
                "trip_id": f"{route_id}_{direction}",
                "headsign": sample_trip.get("trip_headsign", ""),
                "stop_seq": stop_seq,
                "headway_s": headway,
            })
        return results

    surface_routes = [r["Cells"] for r in routes if r["Cells"]["route_type"] in (0, 3)]
    for c in surface_routes:
        gtfs.add_route(c["route_id"], c["agency_code"], c["route_short_name"],
                        c["route_long_name"], c["route_type"])

    done = 0
    # Один поток
    with ThreadPoolExecutor(max_workers=1) as pool:
        futures = {pool.submit(fetch_route_frequencies, c["route_id"]): c["route_id"]
                   for c in surface_routes}
        for fut in as_completed(futures):
            route_id = futures[fut]
            try:
                freq_trips = fut.result()
            except Exception as e:
                freq_trips = []
                print(f"   !! маршрут {route_id}: {e}")
            for ft in freq_trips:
                stop_seq = [(sid, off) for sid, off in ft["stop_seq"] if sid in gtfs.stops]
                if len(stop_seq) < 2:
                    continue
                gtfs.add_frequency_trip(
                    trip_id=ft["trip_id"], route_id=route_id, headsign=ft["headsign"],
                    stop_seq=stop_seq, headway_s=ft["headway_s"],
                    span_start_s=6 * 3600, span_end_s=23 * 3600,
                )
            done += 1
            if done%25 == 0:
                print(f"   ...обработано {done}/{len(surface_routes)} маршрутов")



# 2. Метро и МЦК (OSM)

METRO_HEADWAY_S = 150   # 2.5 мин, типичный интервал метро
MCC_HEADWAY_S = 300     # 5 мин, типичный интервал МЦК
RAIL_AVG_SPEED_MPS = 9.0  # ~32 км/ч с учётом остановок и разгона/торможения
DWELL_S = 25
SERVICE_SPAN = (6 * 3600, 24 * 3600)  # 06:00-24:00
ENTRANCES_DATASET_ID = 624  # Датасет входов и выходов вестибюлей метро
WALK_SPEED_MPS = 1.2  # Пешая скорость внутри станции, м/с


def _norm(s):
    """Нормализация названий станций и линий для сопоставления источников"""
    s = (s or "").strip().lower().replace("ё", "е").replace("«", "").replace("»", "")
    s = s.replace("\xa0", " ").replace("им.", "имени")
    s = re.sub(r"\bлиния\b", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _entrance_overhead_s(vestibule_type):
    """Надбавка на эскалатор или лестницу в вестибюле"""
    return 45 if "подземн" in (vestibule_type or "").lower() else 15


def _fetch_metro_entrances():
    """Координаты входов и выходов вестибюлей с apidata.mos.ru"""
    rows = []
    skip, top = 0, 1000
    for _ in range(5):
        kwargs = {"top": top}
        if skip:
            kwargs["skip"] = skip
        page = api_get(f"/datasets/{ENTRANCES_DATASET_ID}/rows", **kwargs)
        if not page:
            break
        rows.extend(page)
        skip += len(page)
        if len(page) < top:
            break
    print(f"   загружено вестибюлей: {len(rows)}")
    index = defaultdict(list)
    for row in rows:
        c = row.get("Cells", {})
        try:
            lat = float(c["Latitude_WGS84"])
            lon = float(c["Longitude_WGS84"])
        except (KeyError, TypeError, ValueError):
            continue
        station = _norm(c.get("NameOfStation"))
        line = _norm(c.get("Line"))
        if not station:
            continue
        index[(station, line)].append({
            "id": c.get("global_id"),
            "name": c.get("Name") or "",
            "lat": lat, "lon": lon,
            "vestibule_type": c.get("VestibuleType") or "",
        })
    return index


def _is_metro_like(tags):
    route = tags.get("route")
    network = tags.get("network") or ""
    if route == "subway":
        return True
    if route == "train" and "метрополитен" in network.lower():
        return True
    return False


class _RelationScan(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.relations = []

    def relation(self, r):
        tags = {t.k: t.v for t in r.tags}
        if tags.get("type") != "route" or not _is_metro_like(tags):
            return
        members = [(m.type, m.ref, m.role) for m in r.members]
        self.relations.append({
            "id": r.id, "name": tags.get("name") or f"route-{r.id}",
            "route": tags.get("route"), "members": members,
        })


class _NodeScan(osmium.SimpleHandler):
    def __init__(self, wanted_ids):
        super().__init__()
        self.wanted = wanted_ids
        self.coords = {}
        self.names = {}

    def node(self, n):
        if n.id in self.wanted:
            self.coords[n.id] = (n.location.lat, n.location.lon)
            tags = {t.k: t.v for t in n.tags}
            self.names[n.id] = tags.get("name", "")


def build_metro_and_mcc(gtfs: GTFS):
    scan = _RelationScan()
    scan.apply_file(OSM_PBF)
    print(f"   найдено линий: {len(scan.relations)}")

    gtfs.agency.append({
        "agency_id": "metro", "agency_name": "Московский метрополитен",
        "agency_url": "https://mosmetro.ru", "agency_timezone": "Europe/Moscow",
        "agency_lang": "ru",
    })

    ordered_by_rel = {}
    wanted_node_ids = set()
    for rel in scan.relations:
        stations = []
        for mtype, mref, mrole in rel["members"]:
            if mtype != "n":
                continue
            # Платформы привязываем по ролям stop, stop_entry_only, stop_exit_only
            if mrole not in ("stop", "stop_entry_only", "stop_exit_only"):
                continue
            if stations and stations[-1] == mref:
                continue
            stations.append(mref)
        if len(stations) < 2:
            continue
        ordered_by_rel[rel["id"]] = (rel, stations)
        wanted_node_ids.update(stations)

    print(f"   станций-узлов для поиска координат: {len(wanted_node_ids)}")
    nodes = _NodeScan(wanted_node_ids)
    nodes.apply_file(OSM_PBF, locations=False)

    entrances_by_station_line = _fetch_metro_entrances()
    # Станция уже обработана (оба направления линии делят узлы)
    stations_done = set()
    entrances_built = 0
    # (название станции, линия) -> [id платформ]
    station_index = defaultdict(list)

    built = 0
    for rel_id, (rel, station_ids) in ordered_by_rel.items():
        coords = [nodes.coords.get(sid) for sid in station_ids]
        if any(c is None for c in coords):
            # выкидываем стации без координат, а не всю линию
            filtered = [(sid, c) for sid, c in zip(station_ids, coords) if c is not None]
            if len(filtered) < 2:
                continue
            station_ids, coords = zip(*filtered)

        route_type = 2 if "МЦК" in rel["name"] or "Центральное Кольцо" in rel["name"] else 1
        route_id = f"osm{rel_id}"
        # Линия без уточнения направления обхода кольца
        line_name = rel["name"].split(":")[0].strip()
        line_name = re.sub(r"\s*\([^)]*\)\s*$", "", line_name).strip()
        gtfs.add_route(route_id, "metro", "", rel["name"], route_type)

        stop_seq = []
        t = 0.0
        for idx, (sid, (lat, lon)) in enumerate(zip(station_ids, coords)):
            gid = f"m{sid}"
            name = nodes.names.get(sid) or rel["name"]

            if sid not in stations_done:
                stations_done.add(sid)
                station_gid = f"mst{sid}"
                gtfs.add_stop(station_gid, name, lat, lon, location_type=1)
                gtfs.add_stop(gid, name, lat, lon, location_type=0, parent_station=station_gid)
                # Пересадки указывают на платформы (location_type=0), а не на станции
                station_index[(_norm(name), _norm(line_name))].append(gid)

                matches = entrances_by_station_line.get((_norm(name), _norm(line_name)), [])
                for entrance in matches:
                    if entrance["id"] is None:
                        continue
                    entrance_gid = f"e{entrance['id']}"
                    gtfs.add_stop(entrance_gid, entrance["name"] or name, entrance["lat"], entrance["lon"],
                                  location_type=2, parent_station=station_gid)
                    dist = haversine_m(entrance["lat"], entrance["lon"], lat, lon)
                    traversal_s = dist / WALK_SPEED_MPS + _entrance_overhead_s(entrance["vestibule_type"])
                    # id пути уникален для пары вход-платформа
                    gtfs.add_pathway(f"pw{entrance['id']}_{gid}", entrance_gid, gid, traversal_s)
                    entrances_built += 1
            else:
                # Платформа уже создана на встречном направлении
                gtfs.add_stop(gid, name, lat, lon, location_type=0, parent_station=f"mst{sid}")

            if idx > 0:
                plat, plon = coords[idx - 1]
                dist = haversine_m(plat, plon, lat, lon)
                t += dist / RAIL_AVG_SPEED_MPS + DWELL_S
            stop_seq.append((gid, t))

        headway = MCC_HEADWAY_S if route_type == 2 else METRO_HEADWAY_S
        gtfs.add_frequency_trip(
            trip_id=route_id, route_id=route_id, headsign=rel["name"],
            stop_seq=stop_seq, headway_s=headway,
            span_start_s=SERVICE_SPAN[0], span_end_s=SERVICE_SPAN[1],
        )
        built += 1

    print(f"   построено линий: {built}, станций: {len(stations_done)}, "
          f"входов-вестибюлей привязано: {entrances_built}")
    return station_index


METRO4ALL_BASE = "https://raw.githubusercontent.com/nextgis/metro4all/master/data/msk/"
STATIONS_DATASET_ID = 1488  # Датасет станций и линий apidata.mos.ru
TRANSFER_OVERHEAD_S = 60  # запас на лестницы/эскалаторы/повороты внутри перехода
MAX_TRANSFER_DISTANCE_M = 1500  # Отсекаем случайные совпадения названий станций


def _add_transfer_pair(gtfs: GTFS, ga, gb, seen):
    """True, если пересадка добавлена (не дубль и не случайное совпадение)"""
    if ga == gb or ga not in gtfs.stops or gb not in gtfs.stops:
        return False
    key = tuple(sorted((ga, gb)))
    if key in seen:
        return False
    sa, sb = gtfs.stops[ga], gtfs.stops[gb]
    dist = haversine_m(float(sa["stop_lat"]), float(sa["stop_lon"]),
                        float(sb["stop_lat"]), float(sb["stop_lon"]))
    if dist > MAX_TRANSFER_DISTANCE_M:
        return False
    seen.add(key)
    transfer_s = dist / WALK_SPEED_MPS + TRANSFER_OVERHEAD_S
    gtfs.add_transfer(ga, gb, transfer_s)
    gtfs.add_transfer(gb, ga, transfer_s)
    return True


MANUAL_TRANSFERS_FILE = os.path.join(os.path.dirname(__file__), "..", "backend", "data", "metro_transfers_manual.txt")

# Альтернативные названия линий в ручном списке пересадок
LINE_ALIASES = {
    "мцк": ["московское центральное кольцо"],
    "бкл": ["большая кольцевая"],
    "калининско-солнцевская": ["солнцевская", "калининская"],
}


def _resolve_transfer_station(station_index, mcd_index, name, line_label):
    """line_label может содержать варианты через '/'"""
    norm_name = _norm(name)
    for raw_line in line_label.split("/"):
        norm_line = _norm(raw_line)
        for cand in [norm_line] + LINE_ALIASES.get(norm_line, []):
            index = mcd_index if cand.startswith("мцд") else station_index
            gids = index.get((norm_name, cand))
            if gids:
                return gids
    return None


def build_manual_transfers(gtfs: GTFS, station_index, mcd_index, seen):
    """Пересадки из ручного списка backend/data/metro_transfers_manual.txt (в приоритете)"""
    if not os.path.exists(MANUAL_TRANSFERS_FILE):
        print(f"   !! файл {MANUAL_TRANSFERS_FILE} не найден, пропускаю")
        return 0

    with open(MANUAL_TRANSFERS_FILE, encoding="utf-8") as f:
        lines = [ln.rstrip("\n") for ln in f]

    row_pat = re.compile(r"^(.+?)\s*\(([^()]+)\)\s*→\s*(.+?)\s*\(([^()]+)\)(.*?)\s*—\s*(.+)$")
    time_pat = re.compile(r"(\d+(?:,\d+)?)\s*мин")

    built, unavailable, unresolved = 0, 0, 0
    for line in lines:
        if "→" not in line:
            continue
        m = row_pat.match(line)
        if not m:
            continue
        name_a, line_a, name_b, line_b, notes, timepart = (g.strip() for g in m.groups())
        if "закрыта" in (notes + timepart) or "нет пересад" in name_b.lower() or "нет прям" in line.lower():
            unavailable += 1
            continue
        tm = time_pat.search(timepart)
        if not tm:
            unavailable += 1
            continue
        minutes = float(tm.group(1).replace(",", "."))

        gids_a = _resolve_transfer_station(station_index, mcd_index, name_a, line_a)
        gids_b = _resolve_transfer_station(station_index, mcd_index, name_b, line_b)
        if not gids_a or not gids_b:
            unresolved += 1
            continue
        for ga in gids_a:
            for gb in gids_b:
                if ga == gb or ga not in gtfs.stops or gb not in gtfs.stops:
                    continue
                key = tuple(sorted((ga, gb)))
                if key in seen:
                    continue
                seen.add(key)
                gtfs.add_transfer(ga, gb, minutes * 60)
                gtfs.add_transfer(gb, ga, minutes * 60)
                built += 1

    print(f"   пересадок построено: {built}, без времени/закрыто: {unavailable}, "
          f"не удалось сопоставить станции: {unresolved}")
    return built


def build_all_metro_transfers(gtfs: GTFS, station_index, mcd_index):
    seen = set()
    manual_built = build_manual_transfers(gtfs, station_index, mcd_index, seen)
    auto_built = build_metro_transfers(gtfs, station_index, seen)
    print(f"   пересадок построено всего: {manual_built + auto_built} "
          f"(вручную проверено: {manual_built}, автоматически добито: {auto_built})")


def build_metro_transfers(gtfs: GTFS, station_index, seen):
    """Автоматические пересадки там, где ручной список не покрывает"""
    built = 0

    try:
        stations_csv = requests.get(METRO4ALL_BASE + "stations.csv", timeout=20).text
        lines_csv = requests.get(METRO4ALL_BASE + "lines.csv", timeout=20).text
        interchanges_csv = requests.get(METRO4ALL_BASE + "interchanges.csv", timeout=20).text

        lines_by_id = {row["id_line"]: row["name_ru"]
                       for row in csv.DictReader(io.StringIO(lines_csv), delimiter=";")}
        stations_by_id = {row["id_station"]: (row["name_ru"], lines_by_id.get(row["id_line"], ""))
                          for row in csv.DictReader(io.StringIO(stations_csv), delimiter=";")}

        source1_built, skipped = 0, 0
        for row in csv.DictReader(io.StringIO(interchanges_csv), delimiter=";"):
            a, b = row.get("station_from"), row.get("station_to")
            if a not in stations_by_id or b not in stations_by_id:
                continue
            name_a, line_a = stations_by_id[a]
            name_b, line_b = stations_by_id[b]
            gids_a = station_index.get((_norm(name_a), _norm(line_a)))
            gids_b = station_index.get((_norm(name_b), _norm(line_b)))
            if not gids_a or not gids_b:
                skipped += 1
                continue
            for ga in gids_a:
                for gb in gids_b:
                    if _add_transfer_pair(gtfs, ga, gb, seen):
                        source1_built += 1
        built += source1_built
        print(f"   Metro4All (12 классических линий): {source1_built} пересадок, "
              f"{skipped} пар без сопоставления станций")
    except requests.RequestException as e:
        print(f"   !! Metro4All недоступен: {e}")

    try:
        rows = api_get(f"/datasets/{STATIONS_DATASET_ID}/rows", top=1000)
        by_name = defaultdict(set)
        for row in rows:
            c = row.get("Cells", {})
            if c.get("ObjectStatus") != "действует":
                continue
            name, line = c.get("Station"), c.get("Line")
            if name and line:
                by_name[_norm(name)].add(_norm(line))

        source2_built = 0
        for norm_name, lines in by_name.items():
            if len(lines) < 2:
                continue
            for line_a, line_b in combinations(sorted(lines), 2):
                gids_a = station_index.get((norm_name, line_a))
                gids_b = station_index.get((norm_name, line_b))
                if not gids_a or not gids_b:
                    continue
                for ga in gids_a:
                    for gb in gids_b:
                        if _add_transfer_pair(gtfs, ga, gb, seen):
                            source2_built += 1
        built += source2_built
        print(f"   apidata.mos.ru/1488 (станции-тёзки на разных линиях, все 16 линий): "
              f"{source2_built} пересадок")
    except requests.RequestException as e:
        print(f"   !! apidata.mos.ru/1488 недоступен: {e}")

    print(f"   автоматических пересадок построено: {built}")
    return built



# 3. МЦД (apidata.mos.ru + OSM)

MCD_HEADWAY_S = 420  # 7 мин, типичный интервал МЦД
MOSCOW_BBOX = (55.0, 36.2, 56.4, 38.8)  # lat_min, lon_min, lat_max, lon_max


class _RailStationScan(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.by_name = defaultdict(list)

    def node(self, n):
        tags = {t.k: t.v for t in n.tags}
        # Станции с устаревшей разметкой disused/construction в OSM считаем действующими
        is_active = tags.get("railway") in ("station", "halt")
        is_stale_tagged = (tags.get("disused:railway") in ("station", "halt", "stop")
                            or tags.get("construction:railway") in ("station", "halt", "stop"))
        if not (is_active or is_stale_tagged):
            return
        lat, lon = n.location.lat, n.location.lon
        lat_min, lon_min, lat_max, lon_max = MOSCOW_BBOX
        if not (lat_min <= lat <= lat_max and lon_min <= lon <= lon_max):
            return
        name = tags.get("name")
        if not name:
            return
        self.by_name[name].append((lat, lon))


def _mcd_lookup_keys(name):
    """Варианты имени станции для сопоставления data.mos.ru и OSM"""
    base = _norm(name)
    no_parens = re.sub(r"\s*\([^)]*\)\s*$", "", base).strip()
    no_roman = re.sub(r"\s+[ivx]+$", "", no_parens).strip()
    keys = {base, no_parens, no_roman}
    if " - " in name or " — " in name:
        tail = re.split(r"\s*[-—]\s*", name)[-1]
        keys.add(_norm(tail))
    return keys


def build_mcd(gtfs: GTFS):
    rows = api_get("/datasets/62888/rows", top=500)
    by_diameter = defaultdict(list)
    for row in rows:
        c = row["Cells"]
        by_diameter[c["DiameterName"]].append(c["StationName"])
    print(f"   диаметров: {len(by_diameter)}, станций всего: {len(rows)}")
    scan = _RailStationScan()
    scan.apply_file(OSM_PBF)

    # Нормализованный индекс для нечёткого сопоставления (см. _mcd_lookup_keys)
    osm_by_key = defaultdict(list)
    for raw_name, coords in scan.by_name.items():
        for key in _mcd_lookup_keys(raw_name):
            osm_by_key[key].extend(coords)

    def resolve_mcd_coords(station_name):
        for key in _mcd_lookup_keys(station_name):
            if key in osm_by_key:
                return osm_by_key[key]
        return None

    gtfs.agency.append({
        "agency_id": "mcd", "agency_name": "Московские центральные диаметры",
        "agency_url": "https://mcd.mosmetro.ru", "agency_timezone": "Europe/Moscow",
        "agency_lang": "ru",
    })

    # (название станции, диаметр) -> [id платформ]
    mcd_index = defaultdict(list)
    built, skipped = 0, 0
    for diameter, station_names in by_diameter.items():
        stop_seq = []
        t = 0.0
        prev_coord = None
        for name in station_names:
            candidates = resolve_mcd_coords(name)
            if not candidates:
                skipped += 1
                continue
            lat, lon = candidates[0]
            gid = f"d{diameter}_{name}".replace(" ", "_")
            gtfs.add_stop(gid, f"{name} ({diameter})", lat, lon)
            mcd_index[(_norm(name), _norm(diameter))].append(gid)
            if prev_coord is not None:
                dist = haversine_m(prev_coord[0], prev_coord[1], lat, lon)
                t += dist / RAIL_AVG_SPEED_MPS + DWELL_S
            stop_seq.append((gid, t))
            prev_coord = (lat, lon)

        if len(stop_seq) < 2:
            continue
        route_id = f"mcd_{diameter}".replace(" ", "_")
        gtfs.add_route(route_id, "mcd", diameter, f"{diameter}", 2)
        gtfs.add_frequency_trip(
            trip_id=route_id, route_id=route_id, headsign=diameter,
            stop_seq=stop_seq, headway_s=MCD_HEADWAY_S,
            span_start_s=SERVICE_SPAN[0], span_end_s=SERVICE_SPAN[1],
        )
        built +=1

    print(f"   построено диаметров: {built}, станций без координат (пропущено): {skipped}")
    return mcd_index


if __name__ == "__main__":
    gtfs = GTFS()
    # Метро, МЦК и МЦД собираем раньше автобусов (сеть блокирует запросы после пагинации автобусов)
    station_index = build_metro_and_mcc(gtfs)
    mcd_index = build_mcd(gtfs)
    build_all_metro_transfers(gtfs, station_index, mcd_index)
    if os.environ.get("REUSE_BUS_DATA") and os.path.exists(OUT_ZIP):
        _reuse_bus_tram_from_existing_feed(gtfs, OUT_ZIP)
    else:
        build_surface_transport(gtfs)
    gtfs.write_zip(OUT_ZIP)
