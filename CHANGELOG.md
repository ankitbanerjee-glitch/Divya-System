# DIVYA System v3.3 changes

## v3.3 public prototype readiness

1. Added a Render deployment blueprint and public health endpoint.
2. Required MongoDB and private role credentials in production.
3. Blocked the original demonstration passwords from production deployments.
4. Added secure production cookies, HSTS, proxy awareness, and stricter login throttling.
5. Removed visible credentials from the login screen.

# DIVYA System v2.0 changes

## v2.2 network actions

1. Kept the combined Fault Repair + Dispatch Maintenance action.
2. Added a separate Fault Repair action that resolves the incident and normalizes telemetry without creating a work order.
3. Added a separate Dispatch Management action that opens Maintenance with the selected module and correct work-order priority already filled.
4. Added persistent fault-resolution records and live resolution updates across connected dashboards.
5. Disabled Fault Repair automatically when the selected module has no active fault.

## v2.1 maintenance workflow

1. Added a persistent Recent Work Orders area with status filtering.
2. Added four operational stages: Dispatched, En route, On site, and Completed.
3. Added controlled status-transition validation and timestamped status history.
4. Made critical-module and queue actions prepare the work-order form automatically.
5. Added an available-technician selector populated from the engineer directory.
6. Added module and schedule-date validation before dispatch.
7. Made completed maintenance restore the relevant module to healthy status in the active session.

## Interface

1. Unified every workspace under a premium dark command-centre design.
2. Added an at-a-glance grid status strip for total modules, healthy modules, active faults, and the latest packet.
3. Added live Socket.IO connection state to the header.
4. Added four-conductor telemetry, signal strength, update time, and recommended engineer details.
5. Improved responsive layouts for desktop, tablet, and mobile screens.
6. Increased important text sizes, contrast, focus visibility, and keyboard support.
7. Standardized all NEXGRID labels and protocol names to DIVYA.
8. Added non-blocking success and fault notifications.

## Operations

1. Connected incoming hardware fault reports to the dashboard in real time.
2. Added a controlled fault simulator for demonstrations.
3. Added registered-device validation by node ID, module code, or IP address.
4. Added nearest-available-engineer calculation for registered nodes.
5. Made emergency dispatch create a saved work order and acknowledge its incident.
6. Made maintenance work orders and support tickets persist through the backend.
7. Replaced placeholder report alerts with a downloadable grid-summary report.
8. Added health, bootstrap, activity, fault, work-order, ticket, acknowledgement, and report APIs.

## Reliability and safety

1. Added request-size limits, basic rate limiting, input cleanup, and safer response headers.
2. Added bounded runtime history and atomic JSON persistence.
3. Added explicit prototype boundaries for any use with live electrical equipment.
4. Removed the unused Google Maps key configuration.
5. Fixed unresolved Git conflict text in the original README.
6. Added a repeatable source syntax-check command.
# v3.0 role-based access

- Added a premium secure login screen with separate User and Admin access.
- Added backend sessions using secure, HTTP-only, same-site cookies.
- Restricted fault simulation, repair, dispatch, maintenance changes, work-order updates, and report downloads to administrators.
- Kept dashboard monitoring, network details, overview, alerts, and support ticket submission available to signed-in users.
- Added account identity and sign-out controls to the console.
# v3.1 MongoDB persistence

- Added MongoDB persistence for runtime incidents, work orders, tickets, registered modules, and engineers.
- Added automatic first-connection seeding from the existing JSON datasets.
- Added `.env` loading with `MONGODB_URI` and `MONGODB_DB` configuration.
- Added database connection state to the health and bootstrap APIs.
- Retained safe JSON fallback mode when MongoDB is not configured or temporarily unavailable.
# v3.2 Atlas connection setup

- Added the verified Cluster0 Atlas connection template for the dedicated `divya_app` user.
- Added a Windows setup script that securely prompts for the database password, URL-encodes it, creates the private `.env`, installs dependencies, and starts DIVYA.
- Kept the real database password out of the source archive and version history.
