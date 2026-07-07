# Completed Modules and Capabilities

This document serves as the inventory of completed platform capabilities for Patheya Express. Its purpose is to help AI coding agents and human developers understand what already exists so that new work can extend the platform instead of re-creating functionality that is already available.

AI agents should consult this document before implementing any feature to avoid duplicate implementations and to maximize reuse of established capabilities.

---

# 1. Purpose

The purpose of this document is to provide a high-level view of the platform capabilities that have already been completed and are considered part of the shared foundation of the system.

This document is intentionally focused on completed capabilities rather than file-level implementation detail. It is meant to help future work align with what already exists and to make reuse the default approach.

---

# 2. Backend Capabilities

| Capability | Status | Notes |
| --- | --- | --- |
| Authentication | Completed | Includes JWT authentication, refresh token support, session persistence, and role-based access control. |
| Restaurant Management | Completed | Includes the restaurant module, public restaurant listing API, and restaurant seed data. |
| API Platform | Completed | Includes Swagger/OpenAPI documentation, OpenAPI JSON generation, OpenAPI YAML generation, and SDK generation support. |
| Database | Completed | Includes Prisma ORM integration, PostgreSQL support, and seed infrastructure. |
| Infrastructure | Completed | Includes Redis integration, BullMQ integration, Socket.IO foundation, and configuration management. |

---

# 3. Frontend Capabilities

| Capability | Status | Notes |
| --- | --- | --- |
| Authentication | Completed | Includes login, registration, session restoration, token storage, JWT interceptor, authentication guards, and role guards. |
| Shared UI | Completed | Includes reusable components such as button, text input, password input, avatar, dropdown, header, footer, desktop navigation, mobile navigation, user menu, app shell, and auth card. |
| Application Foundation | Completed | Includes theme tokens, responsive layout, navigation, and generated SDK integration. |

---

# 4. Reusable Libraries

| Library | Purpose | Status |
| --- | --- | --- |
| api-sdk | Shared API client layer for backend communication. | Completed |
| auth | Shared authentication logic and identity handling. | Completed |
| core | Shared application utilities, abstractions, and platform services. | Completed |
| shared-ui | Reusable UI building blocks and application shell components. | Completed |
| shared-models | Shared domain types, interfaces, and enums. | Completed |

---

# 5. Current Development Focus

The shared infrastructure and platform foundation are now in place. Current development is focused on implementing business features on top of the existing architecture and reusable libraries.

AI agents should extend the existing platform rather than introducing parallel implementations or rebuilding capabilities that already exist. The emphasis should remain on integrating new features into the established system in a way that is consistent, maintainable, and reusable.

---

# 6. AI Guidance

AI agents should follow these expectations when contributing to the platform:

- Search existing implementations first before introducing new ones.
- Reuse completed capabilities wherever appropriate.
- Extend existing modules and services when the existing functionality can support the new requirement.
- Avoid duplicate implementations that fragment the platform.
- Preserve the established architecture and responsibility boundaries.
- Never redesign completed modules without explicit instruction.

These practices are essential for keeping the platform coherent as it evolves.

---

# 7. Maintaining This Document

This document should be updated whenever a significant capability reaches production-ready status. It should not be used to track minor implementation detail or short-lived work.

Only completed platform capabilities that future work is expected to reuse should be recorded here. The document is intended to remain stable, useful, and aligned with the actual maturity of the system.
