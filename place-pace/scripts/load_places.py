import json
import os
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))
from backend import create_app
from backend.models import db, Place


def load_places():
    """Синхронизизация таблицы places с backend/data/places.json"""
    app = create_app()
    with app.app_context():
        json_path = Path(__file__).parent.parent / 'backend' / 'data' / 'places.json'

        with open(json_path, 'r', encoding='utf-8') as f:
            places_data = json.load(f)

        existing_by_name = {p.name: p for p in Place.query.all()}
        json_names = set()

        created = updated = reactivated = 0
        for place_data in places_data:
            name = place_data['name']
            json_names.add(name)
            fields = dict(
                description=place_data.get('description'),
                address=place_data.get('address'),
                latitude=place_data.get('latitude'),
                longitude=place_data.get('longitude'),
                category=place_data.get('category'),
                work_time=place_data.get('work_time'),
                ticket_price=place_data.get('ticket_price', 0),
                recommended_duration=place_data.get('recommended_duration', 60),
            )

            place = existing_by_name.get(name)
            if place is None:
                db.session.add(Place(name=name, is_active=True, **fields))
                created += 1
                continue

            if not place.is_active:
                place.is_active = True
                reactivated += 1
            if any(getattr(place, k) != v for k, v in fields.items()):
                for k, v in fields.items():
                    setattr(place, k, v)
                updated += 1

        deactivated = 0
        for name, place in existing_by_name.items():
            if name not in json_names and place.is_active:
                place.is_active = False
                deactivated += 1

        db.session.commit()
        print(f"Синхронизировано: {created} добавлено, {updated} обновлено, "
              f"{reactivated} реактивировано, {deactivated} деактивировано "
              f"(итого в JSON: {len(places_data)})")


if __name__ == '__main__':
    load_places()