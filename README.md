# DIVYA System

DIVYA is an IoT-enabled fault monitoring and field-response prototype for overhead low-voltage distribution grids. The project combines a real-time operational dashboard with a Node.js service that can receive device alerts, record operational activity, and notify connected control-room screens.

## What is included

- Live grid dashboard with PIN, feeder, section, parent-module, and child-node views
- Leaflet-based topology and satellite map layers
- Socket.IO fault updates without page refresh
- Registered-node validation for hardware fault reports
- Persistent fault activity, work orders, and support tickets
- Nearest-available-engineer recommendation for registered nodes
- Demonstration fault simulator for dashboard testing
- Maintenance, overview, report, dispatch, and support workspaces

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Connect MongoDB

On Windows, open PowerShell inside the project folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-mongodb.ps1
```

Enter the password created for the `divya_app` Atlas user when prompted. The script keeps the password hidden, URL-encodes it, creates the private `.env` file, installs dependencies, and starts DIVYA. The `.env` file is excluded from Git and from distributable ZIP files.

When connected, the terminal prints `MongoDB connected: divya_system` and `Data storage: mongodb`. On the first connection, the existing registered modules, engineers, incidents, work orders, and tickets are seeded automatically. If MongoDB is unavailable, DIVYA continues in JSON fallback mode and clearly reports that state in the terminal and health API.

## Sign-in roles

- User — monitoring, network status, overview, alerts, and support tickets
- Admin — full monitoring plus fault simulation, repair, dispatch, maintenance, work-order control, and reports

Run `setup-mongodb.ps1` to choose private credentials locally, or set the four login environment variables shown in `.env.example`. Never publish working passwords.

## Public prototype deployment

DIVYA supports Vercel's Express runtime. Add `MONGODB_URI`, the four private login values, and a long random `DIVYA_SESSION_SECRET` in the Vercel project settings; never commit them to GitHub. The hosted dashboard uses secure signed cookies and refreshes MongoDB-backed operational data automatically every six seconds.

The included `render.yaml` remains available for a traditional always-on Node.js deployment. Production startup intentionally fails if any required value is missing or either original demonstration password is used.

## Report a registered device fault

```bash
curl -X POST http://localhost:3000/report-fault \
  -H "Content-Type: application/json" \
  -d '{"ip":"192.168.1.12","faultType":"Phase voltage loss","telemetry":{"phaseR":0,"phaseY":231,"phaseB":229,"neutral":3.1,"rssi":-82}}'
```

The matching module changes state on every connected dashboard and the incident is recorded in `data/runtime.json`.

## Important boundary

This repository is a controlled demonstration and engineering prototype. It must not directly operate live distribution equipment until its sensing, isolation, protection logic, communications, enclosure, and switching interfaces have been reviewed and validated by qualified electrical-protection professionals.
