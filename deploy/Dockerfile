FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --user-group --create-home app
COPY backend /app/backend
COPY data/catalog.json /app/data/catalog.json
COPY shared/upstream-fixtures.json /app/shared/upstream-fixtures.json
COPY LICENSE THIRD_PARTY_NOTICES.md /app/
COPY licenses /app/licenses
USER 10001
WORKDIR /app/backend
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "2", "--timeout", "30", "--access-logfile", "-", "--error-logfile", "-"]
