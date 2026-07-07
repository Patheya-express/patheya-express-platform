# Backend Architecture

This document defines the backend architecture used throughout the Patheya Express platform. It serves as the architectural reference for implementing new backend capabilities and for understanding how existing backend features are organized.

The architecture is intentionally high-level and focuses on responsibilities, boundaries, and flow rather than implementation detail.

---

# 1. Purpose

The purpose of this document is to describe the backend structure that supports the platform’s services and integrations. It provides a shared architectural understanding for both AI coding agents and human developers so that new features are introduced in a way that fits the existing system.

The document is meant to guide extension of the backend without replacing the platform’s established architectural model.

---

# 2. Architectural Overview

The backend follows a layered architecture built around clear separation of responsibilities. The design is based on a progression from request handling to persistence and back again.

Request

↓

Controller

↓

Service

↓

Repository

↓

Prisma

↓

PostgreSQL

In this model, each layer has a distinct responsibility and communicates with adjacent layers rather than bypassing the structure. This keeps the platform easier to reason about, extend, and operate in production.

---

# 3. Layer Responsibilities

| Layer | Responsibility |
| --- | --- |
| Controller | Handles inbound requests, coordinates request parsing, delegates work to services, and returns responses. |
| Service | Contains business-oriented orchestration logic and enforces the core rules of the application. |
| Repository | Encapsulates persistence access and provides a boundary around database operations. |
| Prisma | Provides the typed data access layer used by repositories to interact with the persistence layer. |
| Database | Stores durable application data, including transactional records and domain state. |

This layering ensures that the request boundary remains thin while the business logic is located in the appropriate service layer.

---

# 4. Supporting Infrastructure

The backend architecture also includes supporting infrastructure that provides cross-cutting capabilities for runtime behavior, reliability, and observability.

| Component | Purpose |
| --- | --- |
| Redis | Supports caching, shared ephemeral state, and fast access patterns for supporting services. |
| BullMQ | Provides background job processing and asynchronous task execution. |
| Socket.IO | Enables real-time communication for interactive and event-driven functionality. |
| Swagger / OpenAPI | Provides API documentation and a standard contract surface for backend endpoints. |
| Configuration | Centralizes environment-driven settings and runtime configuration. |
| Logging | Captures operational information for diagnosis, monitoring, and support. |
| File Storage | Supports media and document handling where persistent file assets are required. |

These infrastructure components are not part of the business domain itself, but they are essential to the platform’s operational behavior.

# Event-Driven Architecture

The backend supports an event-driven architecture for workflows that span multiple modules or require asynchronous processing.

Typical examples include:

- Order lifecycle events
- Payment events
- Delivery assignment events
- Notification events

Events are used to decouple business modules while maintaining clear ownership of responsibilities.

Business logic should remain inside the owning module. Events communicate outcomes rather than replace direct business logic.

# Dependency Direction

Dependencies should always flow downward through the architecture.

Controller
↓

Service
↓

Repository
↓

Prisma

Higher layers may depend on lower layers.

Lower layers must never depend on higher layers.

Repositories must not depend on Controllers.

Services must not depend on presentation concerns.

---

# 5. Module Organization

Backend functionality is organized into business modules so that related capabilities remain cohesive and maintainable. Typical modules include:

- Authentication
- Restaurants
- Menu
- Orders
- Payments
- Dispatch
- Delivery
- Notifications
- Administration

Each module should remain focused on its own business capability and should not become a catch-all container for unrelated logic. A well-structured module boundary improves clarity, maintainability, and long-term evolution.

---

# 6. Request Lifecycle

A normal request follows a predictable lifecycle through the backend layers.

Client Request

↓

Controller

↓

Validation

↓

Service

↓

Repository

↓

Database

↓

Service

↓

Controller

↓

HTTP Response

The request enters through the controller, is validated at the boundary, is processed by the service layer, and may interact with persistence through repositories. The result is then returned to the client through the controller layer in a structured response.

---

# 7. Design Principles

The backend architecture is guided by the following principles:

- Clear separation of concerns
- Layered architecture
- Strong typing
- Reusable services
- Repository pattern
- Dependency Injection
- Modular design
- Production readiness

These principles help preserve consistency as the system grows and ensure that cross-cutting concerns remain controlled and understandable.

---

# 8. AI Guidance

AI coding agents should follow the architecture described here when implementing backend features.

AI agents should:

- Follow the existing layered architecture.
- Extend existing modules where appropriate.
- Keep business logic inside Services.
- Keep Controllers thin.
- Keep Repositories responsible for persistence.
- Reuse shared infrastructure.
- Avoid bypassing architectural layers.
- Preserve module boundaries.

This guidance helps ensure that new work remains consistent with the platform’s architectural model.

---

# 9. Relationship with PADK

This document is part of the broader PADK knowledge base for Patheya Express.

- Project context is documented under .ai/context
- Frontend architecture is documented under .ai/architecture/frontend.md
- Coding rules are documented under .ai/standards
- Development workflows are documented under .ai/workflows

Together, these documents provide a complete architectural and operational reference for the platform.
