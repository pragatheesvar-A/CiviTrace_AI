FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build   # emits ../frontend

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY --from=web /frontend /app/frontend
RUN mkdir -p /app/uploads
ENV CIVICPULSE_DB=sqlite+aiosqlite:////data/civicpulse.db
VOLUME ["/data", "/app/uploads"]
EXPOSE 8010
WORKDIR /app/backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8010"]
