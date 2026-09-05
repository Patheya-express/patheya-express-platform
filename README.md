# Patheya Express Backend

Enterprise backend platform for **Patheya Express**, built with NestJS, Prisma, PostgreSQL, Redis, BullMQ, Socket.IO, and OpenAPI.

This repository contains the backend services and API infrastructure used by the Patheya Express customer, restaurant/partner, delivery, and admin applications.

---

# 1. Project Overview

**Project:** Patheya Express
**Backend:** NestJS
**ORM:** Prisma
**Database:** PostgreSQL
**Cache:** Redis
**Queue:** BullMQ
**Realtime:** Socket.IO
**API Documentation:** Swagger / OpenAPI
**Package Manager:** pnpm
**Runtime:** Node.js
**Containerization:** Docker / Docker Compose

The backend follows an enterprise modular architecture.

Major responsibilities include:

* Authentication and authorization
* User management
* Restaurant management
* Menu management
* Order lifecycle
* Delivery dispatch
* Delivery partner management
* Order tracking
* Notifications
* Realtime communication
* Payments
* Storage
* Audit logging
* Background jobs
* Redis caching
* Event-driven processing
* API documentation

---

# 2. Repository Structure

The backend repository is structured as an Nx/Turborepo-style workspace.

Typical structure:

```text
patheya-express-platform/
│
├── apps/
│   └── api-gateway/
│       ├── src/
│       ├── test/
│       ├── project.json
│       └── ...
│
├── libs/
│   ├── ...
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── ...
│
├── docker/
│   └── ...
│
├── .env
├── .env.example
├── docker-compose.yml
├── package.json
├── pnpm-lock.yaml
├── nx.json
├── tsconfig.json
└── README.md
```

> Always verify the actual repository structure before creating new directories or modules.

---

# 3. Technology Stack

## Backend

* NestJS
* TypeScript
* Prisma ORM
* PostgreSQL
* Redis
* BullMQ
* Socket.IO
* JWT authentication
* Swagger / OpenAPI

## Infrastructure

* Docker Desktop
* PostgreSQL
* Redis
* Render for backend hosting
* Cloudinary / S3-compatible storage architecture

## Development

* Node.js
* pnpm
* Git
* VS Code
* Nx CLI / local Nx

---

# 4. Required Software

Install the following on a new developer machine.

## 4.1 Git

Verify:

```bash
git --version
```

---

## 4.2 Node.js

Use the project's required Node.js version.

Check:

```bash
node --version
```

Expected project version:

```text
Node.js 24.x
```

The exact version should match the version documented by the repository configuration if `.nvmrc`, Volta, or another version manager configuration exists.

---

## 4.3 pnpm

Install pnpm if it is not already installed.

Verify:

```bash
pnpm --version
```

Expected project version:

```text
pnpm 11.x
```

Prefer the version defined by the repository's `packageManager` field if present.

---

## 4.4 Docker Desktop

Docker Desktop is recommended for local infrastructure.

Verify:

```bash
docker --version
docker compose version
```

Docker will be used for infrastructure such as:

* PostgreSQL
* Redis

---

## 4.5 PostgreSQL

PostgreSQL may either be:

1. Run directly on the developer machine, or
2. Run through Docker.

The team should prefer one standard approach for local development.

---

## 4.6 Redis

Redis is required for:

* caching
* BullMQ
* background jobs
* realtime-related infrastructure where applicable

Docker is recommended for local Redis.

---

# 5. Clone the Repository

Clone the backend repository:

```bash
git clone <BACKEND_REPOSITORY_URL>
```

Enter the repository:

```bash
cd patheya-express-platform
```

Verify:

```bash
git status
```

---

# 6. Install Dependencies

Install dependencies using pnpm:

```bash
pnpm install
```

Do not use:

```bash
npm install
```

or:

```bash
yarn install
```

unless specifically required by the project.

The repository uses the committed `pnpm-lock.yaml` to maintain dependency consistency.

---

# 7. Environment Configuration

Create the local environment file from the example file if available:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

If `.env.example` does not exist, ask the project maintainer for the approved environment variables.

Never commit `.env`.

---

# 8. Environment Variables

The exact environment variable names must be taken from the current repository configuration.

Typical backend configuration includes:

```env
NODE_ENV=development
PORT=3000

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/patheya_express

REDIS_HOST=localhost
REDIS_PORT=6379

JWT_SECRET=<LOCAL_SECRET>
JWT_REFRESH_SECRET=<LOCAL_REFRESH_SECRET>

RAZORPAY_KEY_ID=<LOCAL_OR_TEST_KEY>
RAZORPAY_KEY_SECRET=<LOCAL_OR_TEST_SECRET>

CLOUDINARY_CLOUD_NAME=<VALUE>
CLOUDINARY_API_KEY=<VALUE>
CLOUDINARY_API_SECRET=<VALUE>
```

Additional variables may be required for:

* Socket.IO
* CORS
* Kafka/event infrastructure
* BullMQ
* storage
* email
* notifications
* payment webhooks
* external integrations

Do not copy production secrets into a developer machine unless explicitly required.

---

# 9. Secrets Policy

Never commit secrets.

Do not commit:

```text
.env
.env.local
.env.production
private keys
API secrets
JWT secrets
database passwords
payment secrets
Cloudinary secrets
cloud credentials
```

Use:

```text
.env.example
```

for documenting required variable names without exposing actual secrets.

---

# 10. Start Infrastructure

If the repository contains Docker Compose configuration, start infrastructure using:

```bash
docker compose up -d
```

Check running containers:

```bash
docker compose ps
```

Expected infrastructure may include:

```text
PostgreSQL
Redis
```

Depending on the current architecture, additional services may be present.

---

# 11. PostgreSQL

Verify PostgreSQL is running.

If PostgreSQL is running through Docker:

```bash
docker compose ps
```

You can inspect logs:

```bash
docker compose logs postgres
```

If the service has a different name, use the name defined in `docker-compose.yml`.

---

# 12. Redis

Verify Redis:

```bash
docker compose ps
```

Inspect Redis logs:

```bash
docker compose logs redis
```

If Redis is installed locally instead of Docker, verify that the configured host and port match `.env`.

Typical configuration:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

---

# 13. Database Setup

After PostgreSQL is running, configure the Prisma database connection.

Verify:

```bash
pnpm prisma validate
```

If Prisma is exposed through the workspace scripts, use the repository's documented Prisma command instead.

---

# 14. Prisma

Prisma is the ORM used by the backend.

Main files:

```text
prisma/schema.prisma
prisma/migrations/
```

Validate the schema:

```bash
pnpm prisma validate
```

Generate Prisma Client:

```bash
pnpm prisma generate
```

---

# 15. Apply Database Migrations

For a fresh development database:

```bash
pnpm prisma migrate dev
```

Do not manually modify the production database.

Do not delete existing migrations.

Do not reset a shared database unless explicitly instructed.

---

# 16. Prisma Studio

To inspect the local database:

```bash
pnpm prisma studio
```

This opens Prisma Studio for viewing and managing development data.

Use Prisma Studio carefully.

Do not modify production data through Prisma Studio.

---

# 17. Seed Data

If the repository contains a Prisma seed configuration, run the project's configured seed command.

For example:

```bash
pnpm prisma db seed
```

Only use this if a valid seed script exists.

---

# 18. Start the Backend

Start the development API:

```bash
pnpm dev
```

If the repository uses an Nx-specific target:

```bash
pnpm nx serve api-gateway
```

or:

```bash
pnpm exec nx serve api-gateway
```

Use the command defined by the current `package.json` and Nx configuration.

---

# 19. Backend URL

The local backend normally runs on:

```text
http://localhost:3000
```

The API base path is:

```text
http://localhost:3000/api/v1
```

Verify the actual configured port and prefix from the current application bootstrap/configuration before assuming these values.

---

# 20. Swagger / OpenAPI

Swagger is available for API documentation.

Typical development URL:

```text
http://localhost:3000/api/docs
```

Verify the actual Swagger route in the backend bootstrap configuration.

Swagger is useful for:

* testing APIs
* understanding request/response models
* inspecting authentication
* generating the frontend SDK
* validating API contracts

---

# 21. API Health Check

After starting the backend, verify the health endpoint if configured.

Example:

```text
GET /api/v1/health
```

Use the actual health route configured in the project.

A successful health response confirms that the application is running.

---

# 22. Authentication

The backend uses JWT-based authentication.

The authentication flow includes:

```text
Login
   ↓
Access Token
   ↓
Refresh Token
   ↓
Authenticated API Requests
```

Authentication-related responsibilities include:

* login
* registration
* access token validation
* refresh token handling
* authentication guards
* role-based authorization

Do not bypass authentication in production code for local convenience.

---

# 23. Authorization

Patheya Express uses role-aware authorization.

Different application roles may include:

```text
Customer
Restaurant / Partner
Delivery Partner
Admin
```

Authorization must be enforced server-side.

Never trust role information supplied directly by the client.

---

# 24. Main Backend Domains

The backend contains enterprise modules for the major platform domains.

## Authentication

Responsible for:

* registration
* login
* JWT
* refresh tokens
* user identity
* authorization

---

## Users

Responsible for user-related data and profile management.

---

## Restaurants

Responsible for:

* restaurant onboarding
* restaurant profile
* restaurant status
* restaurant ownership
* operational information

---

## Menu

Responsible for:

* menu categories
* menu items
* availability
* pricing
* restaurant menu management

---

## Orders

Responsible for the complete order lifecycle.

Example lifecycle:

```text
Order Placed
    ↓
Confirmed
    ↓
Preparing
    ↓
Ready
    ↓
Delivery Partner Assigned
    ↓
Picked Up
    ↓
Out for Delivery
    ↓
Delivered
```

The actual state machine in the repository is the source of truth.

Do not introduce arbitrary order states.

---

## Dispatch

Responsible for delivery assignment and redispatch behavior.

Important behaviors include:

* delivery partner assignment
* assignment ownership
* rejection
* redispatch
* assignment expiry
* online partner filtering

---

## Delivery

Responsible for delivery partner workflows.

Includes:

* delivery partner state
* assignment
* delivery lifecycle
* ownership validation
* delivery-related operations

---

## Tracking

Responsible for realtime order/delivery tracking where implemented.

The intended architecture uses Socket.IO/realtime infrastructure.

Do not introduce a second realtime architecture without architectural approval.

---

## Notifications

Responsible for notifications triggered by platform events.

---

## Payments

Payment integration includes Razorpay.

Payment processing must remain server-authoritative.

Never expose payment secrets to frontend applications.

---

## Storage

The backend uses a storage abstraction.

The architecture includes:

```text
StorageProvider
       ↓
StorageService
       ↓
Concrete Storage Provider
```

This allows storage implementations such as:

* local storage
* S3-compatible storage
* Cloudinary where applicable

Do not bypass the storage abstraction without a clear architectural reason.

---

## Audit

Audit functionality is used for traceability of important system actions.

Do not remove audit logging from protected business operations.

---

# 25. Redis

Redis is used by backend infrastructure for purposes such as:

* caching
* queue infrastructure
* BullMQ
* realtime-related state
* temporary state

Do not use Redis as a replacement for PostgreSQL transactional persistence unless the architecture explicitly requires it.

---

# 26. BullMQ

BullMQ provides background job processing.

Queues may include responsibilities such as:

```text
Dispatch
Notifications
Payments
```

Background jobs should be:

* idempotent where required
* observable
* retry-safe
* failure-aware

Do not introduce blocking long-running work directly into HTTP request handlers when the existing architecture expects a queue.

---

# 27. Event-Driven Architecture

The backend uses domain events for important workflows.

Examples include:

```text
order.placed
order.status.changed
order.ready
delivery.partner.assigned
```

Events can trigger:

* notifications
* dispatch processing
* realtime updates
* background jobs
* other domain reactions

Do not create duplicate event flows for functionality that already exists.

---

# 28. Realtime / Socket.IO

Socket.IO is used for realtime communication.

Typical use cases include:

* order updates
* delivery tracking
* admin notifications
* realtime state changes

Realtime communication must respect:

* authentication
* authorization
* room membership
* order ownership
* delivery ownership

Never expose another customer's order information through a realtime channel.

---

# 29. API SDK

The frontend SDK is generated from the backend OpenAPI/Swagger contract.

The normal flow is:

```text
NestJS Controllers
       ↓
Swagger / OpenAPI
       ↓
OpenAPI JSON
       ↓
Generated Angular SDK
       ↓
Frontend Applications
```

When changing an API:

1. Update backend DTO/controller/service.
2. Verify Swagger output.
3. Regenerate the frontend SDK.
4. Update frontend consumers.
5. Run builds/tests.

Do not manually maintain generated SDK models if they are generated from OpenAPI.

---

# 30. API Versioning

The backend API uses a versioned API prefix.

Current development configuration is expected to use:

```text
/api/v1
```

Example:

```text
http://localhost:3000/api/v1
```

Do not remove or change API versioning casually.

Breaking API changes require coordinated frontend/backend changes.

---

# 31. CORS

CORS configuration controls which frontend applications can access the backend.

Development may include local origins such as:

```text
http://localhost:4200
http://localhost:4201
http://localhost:4202
http://localhost:4203
```

The actual configured origins are the source of truth.

Production origins must be explicitly configured.

Do not use:

```text
*
```

for authenticated production APIs unless there is a documented architectural reason.

---

# 32. Local Development Workflow

Every day, a developer should normally follow:

```text
1. Pull latest code
2. Check branch
3. Install/update dependencies if required
4. Start PostgreSQL
5. Start Redis
6. Verify environment variables
7. Apply required Prisma migrations
8. Generate Prisma Client if schema changed
9. Start backend
10. Verify health endpoint
11. Verify Swagger
12. Start required frontend applications
```

---

# 33. Recommended Daily Commands

From the backend repository:

```bash
git pull
```

Check status:

```bash
git status
```

Install dependencies when required:

```bash
pnpm install
```

Start infrastructure:

```bash
docker compose up -d
```

Generate Prisma Client:

```bash
pnpm prisma generate
```

Run migrations when required:

```bash
pnpm prisma migrate dev
```

Start backend:

```bash
pnpm dev
```

---

# 34. New Developer First-Day Setup

A new developer should complete the following:

* [ ] Install Git
* [ ] Install Node.js
* [ ] Install pnpm
* [ ] Install Docker Desktop
* [ ] Clone backend repository
* [ ] Configure `.env`
* [ ] Start PostgreSQL
* [ ] Start Redis
* [ ] Install pnpm dependencies
* [ ] Generate Prisma Client
* [ ] Run database migrations
* [ ] Start backend
* [ ] Verify health endpoint
* [ ] Open Swagger
* [ ] Verify authentication
* [ ] Verify database connection
* [ ] Verify Redis connection
* [ ] Verify queues
* [ ] Verify realtime connection
* [ ] Start frontend repository
* [ ] Verify frontend → backend communication

---

# 35. Git Workflow

Before starting work:

```bash
git status
git pull
```

Create a feature branch:

```bash
git checkout -b feature/<feature-name>
```

Example:

```bash
git checkout -b feature/order-tracking
```

Do not directly develop features on the main production branch.

---

# 36. Before Committing

Run appropriate validation:

```bash
pnpm lint
```

Build:

```bash
pnpm build
```

Run tests:

```bash
pnpm test
```

If these commands are not available exactly as written, use the corresponding scripts from `package.json`.

Check:

```bash
git status
```

Review the changed files:

```bash
git diff
```

Do not commit:

```text
.env
logs
generated secrets
temporary files
IDE files
local database files
```

---

# 37. Database Migration Rules

Database changes must be treated carefully.

When changing `schema.prisma`:

1. Understand the impact.
2. Update the Prisma schema.
3. Create a migration.
4. Review the migration.
5. Generate Prisma Client.
6. Test locally.
7. Test affected APIs.
8. Coordinate frontend SDK changes if the API contract changes.

Never delete migrations just to make local development work.

Never modify production schemas manually unless following the approved deployment procedure.

---

# 38. Production Deployment

Production backend is hosted through the project's configured deployment infrastructure.

Current production API domain:

```text
https://api.patheyaexpress.in
```

The API base path is:

```text
https://api.patheyaexpress.in/api
```

Verify the current production configuration before making deployment changes.

Production deployment must include:

* environment variables
* database configuration
* Redis configuration
* queue configuration
* storage configuration
* payment configuration
* CORS configuration
* realtime configuration
* health monitoring
* logging

Never commit production secrets to Git.

---

# 39. Render Deployment

The backend is hosted on Render.

The Render service must be configured with the required environment variables.

Typical deployment flow:

```text
Git push
   ↓
Render build
   ↓
Dependency installation
   ↓
Prisma generation
   ↓
Application build
   ↓
Application startup
   ↓
Health verification
```

The exact Render build/start commands are defined by the deployment configuration.

Do not change deployment commands without verifying the current repository setup.

---

# 40. Production Database Safety

Never run destructive commands against production casually.

Avoid commands such as:

```bash
prisma migrate reset
```

against production.

Never execute:

```bash
DROP DATABASE
```

against a production database.

Always verify:

```text
Environment
Database URL
Deployment target
Branch
```

before running database commands.

---

# 41. Logging

The backend uses structured/application logging.

Logs should provide enough information to troubleshoot:

* authentication
* API requests
* orders
* dispatch
* payments
* queues
* realtime
* database failures

Do not log:

* passwords
* JWT secrets
* payment secrets
* sensitive credentials
* unnecessary personal data

---

# 42. Correlation IDs

Enterprise request tracing uses correlation/request identifiers where configured.

When troubleshooting a request across:

```text
API
→ service
→ event
→ queue
→ realtime
```

use the available correlation/request identifier to connect logs.

Do not remove correlation information from request flows.

---

# 43. Health Monitoring

Health monitoring is part of the enterprise backend hardening.

Health checks should help identify failures in infrastructure such as:

* application
* PostgreSQL
* Redis

Use the project's configured health endpoint rather than inventing a new endpoint.

---

# 44. Troubleshooting

## Backend does not start

Check:

```bash
node --version
pnpm --version
```

Then:

Full-stack (this repo + the `frontend` repo together)? The canonical, documented setup lives in the
frontend repo — see its `tools/dev/DEVELOPMENT.md` — and drives everything below for you.

Backend-only:

```bash
pnpm install
cp apps/api-gateway/.env.example apps/api-gateway/.env   # fill in local values
docker compose -f infrastructure/docker/docker-compose.yml up -d   # Postgres, Redis, Kafka (unused), AND api-gateway
pnpm --filter api-gateway run db:migrate                            # from the host, against the container's published port
```

That single `docker compose up -d` already starts `api-gateway` itself (see
`docs/infrastructure/docker.md`) — there is no separate `pnpm --filter api-gateway run start:dev`
step to run on top of it; doing so races the container for port 3000. Only run `start:dev`
yourself if you deliberately exclude `api-gateway` from Compose (`docker compose ... up postgres
redis kafka zookeeper`) to iterate on it natively instead.

## Running tests

```bash
git clone <BACKEND_REPOSITORY_URL>

cd patheya-express-platform

pnpm install

# Configure .env

docker compose up -d

pnpm prisma validate

pnpm prisma generate

pnpm prisma migrate dev

pnpm dev
```

Then verify:

```text
Backend:
http://localhost:3000

API:
http://localhost:3000/api/v1

Swagger:
<configured Swagger URL>

Health:
<configured health URL>
```

---

# 58. Repository Ownership

This README describes the development setup and engineering standards for the Patheya Express backend.

When the repository architecture changes, update this README together with the corresponding project configuration and developer documentation.

**The actual source code, configuration files, package.json, Nx configuration, Prisma schema, and deployment configuration are always the final source of truth.**
