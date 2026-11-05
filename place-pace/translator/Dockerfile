# Офлайн-переводчик ru <-> en (Argos Translate), сборка из корня репозитория
FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir argostranslate flask==2.3.3 gunicorn==21.2.0
RUN python -c "import argostranslate.package as p; p.update_package_index(); [p.install_from_path(x.download()) for x in p.get_available_packages() if (x.from_code, x.to_code) in {('ru','en'), ('en','ru')}]"
COPY translator/app.py .
EXPOSE 5003
CMD ["gunicorn", "--bind", "0.0.0.0:5003", "--workers", "1", "--threads", "4", "--timeout", "120", "app:app"]
