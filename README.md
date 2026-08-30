# DIVYA System

DIVYA is an IoT-enabled overhead low-voltage grid fault monitoring system. The console receives device telemetry, updates operators in real time, and stores work orders, support tickets, dispatches, and fault history.

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`. Without `DATABASE_URL`, development records are stored in `data/runtime.json`. Set a PostgreSQL connection string for durable production storage.

## API

- `GET /api/health`
- `GET /api/events`
- `POST /api/faults` (send `x-device-api-key` when `DEVICE_API_KEY` is configured)
- `GET|POST /api/work-orders`
- `GET|POST /api/tickets`
- `GET|POST /api/dispatches`

Example device report:

```bash
curl -X POST http://localhost:3000/api/faults \
  -H "Content-Type: application/json" \
  -H "x-device-api-key: YOUR_DEVICE_API_KEY" \
  -d '{"moduleId":"ESP-01-01","ip":"192.168.1.12","voltage":0,"severity":"critical"}'
```

## Free deployment

Recommended architecture: Render web service + Neon PostgreSQL.

1. Create a free Neon database and copy its pooled connection string.
2. In Render, create a Blueprint from this repository. Render reads `render.yaml`.
3. Enter the Neon string as `DATABASE_URL`. Render generates `DEVICE_API_KEY`.
4. Deploy, then verify `https://YOUR-SERVICE.onrender.com/api/health`.
5. Copy the generated `DEVICE_API_KEY` into the IoT gateway configuration; never put it in frontend JavaScript.

The server creates the required PostgreSQL tables on first boot.
