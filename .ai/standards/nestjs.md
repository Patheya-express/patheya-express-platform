# NestJS Development Standards

This document defines the NestJS development standards used throughout the Patheya Express backend. Its purpose is to ensure that backend features are implemented consistently, remain aligned with the repository architecture, and preserve clear responsibility boundaries.

This document is not a general NestJS tutorial. It describes how NestJS should be used in this repository.

---

# 1. Purpose

The purpose of this document is to provide repository-specific expectations for using NestJS in Patheya Express. It is intended to guide both human developers and AI coding agents when implementing backend functionality so that the codebase remains cohesive, maintainable, and production-ready.

---

# 2. Module Organization

Each business capability should be implemented as an independent NestJS module. Modules should remain cohesive and should own a single, clearly defined business responsibility.

Modules should be organized around domain capability rather than scattered technical concerns. A module should be easy to understand, easy to extend, and easy to test in isolation.

---

# 3. Layer Responsibilities

The backend should follow a clear layer-based separation of responsibilities.

Controller

- Accept incoming requests
- Delegate work to services
- Return responses to the client

Service

- Contain business logic
- Coordinate workflows and orchestration
- Enforce business rules and validations

Repository

- Handle persistence operations only
- Encapsulate database access
- Keep storage concerns out of services

This separation keeps controllers thin and ensures that business behavior remains in the appropriate layer.

---

# 4. Dependency Injection

Dependencies should always be provided through dependency injection. Manual object creation should be avoided.

Constructor injection is the preferred pattern for services, repositories, and other collaborators. This promotes testability, explicit dependencies, and a consistent application structure.

---

# 5. DTO Usage

DTOs define API contracts and should be used for request and response boundaries. They should be small, explicit, and focused on the data being exchanged.

DTOs should not contain business logic. They should remain simple data containers that describe the shape of the input or output contract.

---

# 6. Validation

Validation should occur at the API boundary. Controllers and request DTOs should enforce structural validation, while business validation should remain in services where appropriate.

This ensures that invalid input is rejected early while business rules remain in the domain logic layer.

---

# 7. Error Handling

Errors should be handled consistently and explicitly. Meaningful exceptions should be thrown when a failure requires attention, and generic failures should be avoided where possible.

The platform should not swallow errors silently. When an error reaches the API layer, it should produce a consistent and understandable response that preserves the important context.

---

# 8. Logging

Logging should be used to record meaningful operational events. It should support debugging, support, and monitoring without creating noise.

Logging should be concise and purposeful. Secrets, tokens, and sensitive values must never be logged.

---

# 9. Module Boundaries

Modules should communicate through services rather than through tight coupling or direct cross-module access. A module should not depend on another module’s repository directly unless a clear architectural need exists and the pattern is already established.

Well-defined module boundaries reduce coupling and protect the long-term maintainability of the platform.

---

# 10. AI Guidance

AI agents should follow these expectations when working in the NestJS backend:

- Reuse existing modules and patterns where possible.
- Keep controllers thin and focused on transport concerns.
- Keep services focused on business logic and workflow orchestration.
- Keep repositories responsible only for persistence.
- Preserve module boundaries and avoid bypassing architectural layers.
- Follow the repository’s established structure rather than introducing parallel patterns.

These standards are intended to preserve consistency across the backend as the platform evolves.

# API Documentation

All public REST endpoints should be documented using Swagger/OpenAPI.

Controllers are responsible for exposing accurate API contracts.

Changes to request or response DTOs should be reflected in the generated OpenAPI specification so that the frontend SDK remains synchronized.
