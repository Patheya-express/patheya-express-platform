# Patheya Express Backend Setup Guide (New Laptop)

## Project Information

Project: Patheya Express Platform

Architecture:

* Turborepo Monorepo
* NestJS API Gateway
* Prisma ORM
* PostgreSQL
* Redis
* BullMQ
* Kafka
* Docker Desktop
* pnpm Workspace

Repository Root:

```text
patheya-express-platform
```

Backend App:

```text
apps/api-gateway
```

---

# Phase 1 - Required Software Installation

Install the following applications in order.

## 1. Git

Download and install Git.

Verify:

```powershell
git --version
```

Expected:

```text
git version x.x.x
```

---

## 2. Node.js LTS

Install Node.js LTS.

Verify:

```powershell
node -v
npm -v
```

---

## 3. pnpm

Install globally:

```powershell
npm install -g pnpm
```

Verify:

```powershell
pnpm -v
```

Current project version:

```text
pnpm 11.4.0
```

---

## 4. Docker Desktop

Install Docker Desktop.

Enable:

* WSL2 Backend
* Hyper-V

Verify:

```powershell
docker --version
docker ps
```

---

## 5. WSL2

Install:

```powershell
wsl --install
```

Verify:

```powershell
wsl --status
```

Expected:

```text
Default Version: 2
```

---

## 6. Visual Studio Code

Install:

* VS Code
* Docker Extension
* Prisma Extension
* ESLint Extension
* Prettier Extension

---

# Phase 2 - Clone Repository

Create workspace:

```powershell
mkdir C:\Projects
cd C:\Projects
```

Clone:

```powershell
git clone <repository-url>
```

Enter project:

```powershell
cd patheya-express-platform
```

---

# Phase 3 - Install Dependencies

Install workspace packages:

```powershell
pnpm install
```

---

# Phase 4 - Start Infrastructure

Navigate:

```powershell
cd infrastructure/docker
```

Docker Compose contains:

* PostgreSQL 16
* Redis 7
* Zookeeper
* Kafka

Start infrastructure:

```powershell
docker compose up -d
```

Verify:

```powershell
docker ps
```

Expected containers:

```text
patheya-express-postgres
patheya-express-redis
patheya-express-zookeeper
patheya-express-kafka
```

---

# Phase 5 - Configure Environment

Location:

```text
apps/api-gateway/.env
```

Contents:

```env
NODE_ENV=development

PORT=3000

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/patheya_express_db?schema=public"

REDIS_HOST=localhost
REDIS_PORT=6379

JWT_ACCESS_SECRET=CHANGE_ME_ACCESS_SECRET
JWT_REFRESH_SECRET=CHANGE_ME_REFRESH_SECRET

RAZORPAY_KEY_ID=YOUR_KEY
RAZORPAY_KEY_SECRET=YOUR_SECRET

CLOUDINARY_CLOUD_NAME=YOUR_NAME
CLOUDINARY_API_KEY=YOUR_KEY
CLOUDINARY_API_SECRET=YOUR_SECRET

STORAGE_DRIVER=local

KAFKA_BROKER=localhost:9092
```

Important:

One environment variable per line.

---

# Phase 6 - Generate Prisma Client

Navigate:

```powershell
cd apps/api-gateway
```

Generate:

```powershell
pnpm exec prisma generate
```

Verify database:

```powershell
pnpm exec prisma db pull
```

Expected:

```text
✔ Introspected models
```

---

# Phase 7 - Start Backend

Run:

```powershell
pnpm start:dev
```

Expected:

```text
Nest application successfully started
```

---

# Troubleshooting Encountered During Setup

## Problem 1

PowerShell blocked npm and npx.

Error:

```text
running scripts is disabled on this system
```

Fix:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## Problem 2

npm failed.

Error:

```text
EBADDEVENGINES
```

Cause:

Project uses pnpm.

Fix:

```powershell
npm install -g pnpm
```

Use pnpm instead of npm.

---

## Problem 3

Docker Desktop failed.

Cause:

WSL2 not installed.

Fix:

```powershell
wsl --install
```

Restart machine.

---

## Problem 4

Prisma P1000 Authentication Failed

Error:

```text
Authentication failed against database server
```

Root Cause:

A local PostgreSQL 18 Windows service was running and occupying port 5432.

Service:

```text
postgresql-x64-18
```

Prisma connected to the local PostgreSQL instance instead of Docker PostgreSQL.

Fix:

Open Services:

```text
services.msc
```

Stop:

```text
postgresql-x64-18
```

Verify:

```powershell
netstat -ano | findstr :5432
```

Only Docker should remain.

---

# Verification Checklist

Verify Git:

```powershell
git --version
```

Verify Node:

```powershell
node -v
```

Verify pnpm:

```powershell
pnpm -v
```

Verify Docker:

```powershell
docker ps
```

Verify PostgreSQL:

```powershell
docker exec -it patheya-express-postgres psql -U postgres -d patheya_express_db
```

Verify Prisma:

```powershell
pnpm exec prisma db pull
```

Verify Backend:

```powershell
pnpm start:dev
```

Verify Health Endpoint:

```text
http://localhost:3000/api/v1/health
```

Verify Swagger:

```text
http://localhost:3000/api/docs
```


NODE_ENV=development

PORT=3000

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/patheya_express_db?schema=public"

REDIS_HOST=localhost
REDIS_PORT=6379

JWT_ACCESS_SECRET=CHANGE_ME_ACCESS_SECRET
JWT_REFRESH_SECRET=CHANGE_ME_REFRESH_SECRET
RAZORPAY_KEY_ID=rzp_test_Sop8avBtckAdw2
RAZORPAY_KEY_SECRET=gidf04yEr6QIklRQ6OR2vjPv

CLOUDINARY_CLOUD_NAME=dusymh787 
CLOUDINARY_API_KEY=177447387236522 
CLOUDINARY_API_SECRET=UWtUbcSUqd6CVSn1mRCq1YnYYNU
STORAGE_DRIVER=local

KAFKA_BROKER=localhost:9092
