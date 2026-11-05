"""Сжатие сохранённых обложек маршрутов (по умолчанию dry-run, запись только с флагом)"""
import argparse
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))
from sqlalchemy import update
from backend import create_app
from backend.models import db, Route
from backend.services.image_service import normalize_cover_image


def shrink(apply):
    app = create_app()
    with app.app_context():
        # Только id и cover_image
        rows = db.session.query(Route.id, Route.cover_image) \
            .filter(Route.cover_image.isnot(None)).order_by(Route.id).all()

        total_before = total_after = changed = 0
        for route_id, cover in rows:
            try:
                new_cover = normalize_cover_image(cover)
            except ValueError as exc:
                print(f"маршут {route_id}: {exc} - пропущен")
                total_before += len(cover)
                total_after += len(cover)
                continue

            before, after = len(cover), len(new_cover)
            total_before += before
            total_after += after
            if new_cover == cover:
                print(f"маршрут {route_id}: {before / 1024:.0f} КБ - уже в норме")
                continue

            changed += 1
            print(f"   маршрут {route_id}: {before / 1024:.0f} КБ -> {after / 1024:.0f} КБ")
            if apply:
                # updated_at=Route.updated_at
                db.session.execute(
                    update(Route).where(Route.id == route_id)
                    .values(cover_image=new_cover, updated_at=Route.updated_at)
                )

        if apply:
            db.session.commit()
        mode = "Записано" if apply else "Dry-run, в базу НЕ записано"
        print(f"{mode}: изменится {changed} из {len(rows)} обложек, "
              f"{total_before / 1024 / 1024:.2f} МБ -> {total_after / 1024 / 1024:.2f} МБ")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--apply', action='store_true', help='записать изменения в базу')
    shrink(parser.parse_args().apply)
