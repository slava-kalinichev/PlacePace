# Place Pace

Платформа умных туристических маршрутов по Москве: подбор достопримечательностей, оптимизация порядка и времени посещения, расчёт перемещений (пешком, общественный транспорт, такси, речной транспорт), публикация маршрутов и режим пошагового прохождения On It.

## Стек

- Фронтенд: React, TypeScript, Vite, Tailwind CSS
- Бэкенд: Flask, SQLAlchemy, OR-Tools (оптимизация маршрута)
- Маршрутизация: OSRM (пешком), OpenTripPlanner (общественный транспорт)
- Перевод маршрутов ru ↔ en: офлайн-контейнер `translator/`

## Структура

```
backend/      Flask-приложение: routes/ (эндпоинты по темам), services/ (логика), models.py, data/
src/          React-приложение: components/ (окна и createRoute/ - части мастера маршрута),
              api/, services/, utils/, i18n/, onit/ (мобильный режим On It)
scripts/      Служебные скрипты (загрузка мест, сборка GTFS, сжатие обложек)
translator/   Сервис офлайн-перевода
deploy/       Dockerfile и nginx-конфиг фронтенда
tests/        Модульные тесты бэкенда (pytest); тесты фронтенда лежат рядом с кодом (*.test.ts)
docker/       Данные OSRM и OpenTripPlanner (не хранятся в репозитории)
```

## Запуск в Docker

```bash
cp .env.example .env              # при необходимости заполнить ключи
docker compose up --build         # http://localhost:8080
docker compose --profile routing up   # дополнительно OSRM и OpenTripPlanner (~5.5 ГБ)
```

## Запуск для разработки

```bash
# Бэкенд (порт 5001)
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/load_places.py   # загрузка каталога мест в БД
.venv/bin/python run.py

# Фронтенд (порт 5173)
npm install
npm run dev
```

Настройки окружения читаются из `.env`.

## Проверки

```bash
pip install -r requirements-dev.txt && pytest   # тесты бэкенда
npm test                                        # тесты фронтенда
npm run build                                   # проверка типов и сборка фронтенда
npm run lint
```

## CI/CD (GitHub Actions)

- `ci.yml` — один пайплайн на каждый push и pull request: тесты бэкенда и фронтенда, линт, сборка, проверка `docker compose up`; в ветке main затем публикация образов в GHCR.
- `deploy.yml` — деплой на сервер, запускается вручную. Нужны секреты репозитория: `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_KNOWN_HOSTS`, `VITE_YANDEX_MAPS_API_KEY`.

Откат на сервере: бэкенд — `BACKEND_IMAGE=place-pace-backend:prev docker compose --profile routing --env-file .env.production.backend -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build --no-deps backend`, фронтенд — поменять местами `dist` и `dist.prev` в `/var/www/place-pace`.
