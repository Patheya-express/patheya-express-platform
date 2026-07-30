# Prisma Development Standards

This document defines how Prisma is used within the Patheya Express backend. Its purpose is to establish repository-level conventions for database access so that persistence logic remains consistent, maintainable, and aligned with the architecture.

This document is not a Prisma tutorial. It describes how Prisma should be used in this repository.

---

# 1. Purpose

The purpose of this document is to make Prisma usage predictable and disciplined across the backend. It ensures that database access remains encapsulated, typed, and consistent with the repository pattern used throughout the platform.

---

# 2. Repository Ownership

Repositories own all Prisma interactions. This is a core architectural rule of the backend.

Services should never access Prisma directly. Controllers should never access Prisma. Database access must remain behind the repository boundary so that persistence concerns are isolated from business logic and transport concerns.

This separation keeps the system easier to maintain and easier to evolve as the platform grows.

---

# 3. Schema Management

Schema changes should be intentional and deliberate. Any change to the Prisma schema should be accompanied by the appropriate migration and reviewed for correctness.

The schema should remain consistent with the domain model and should reflect the real business rules of the platform. Changes should be made with consideration for backward compatibility, data integrity, and production impact.

---

# 4. Queries

Prisma queries should be typed and explicit. The repository layer should use clear query definitions that express the intent of the data access operation.

Raw SQL should be avoided unless there is a strong and documented reason to use it. When querying data, prefer explicit field selection and avoid unnecessary data retrieval. Query shapes should remain straightforward and predictable.

---

# 5. Transactions

Transactions should be used when multiple related database operations must succeed or fail together. This is especially important for workflows that span multiple writes or depend on atomic consistency.

Transactional boundaries should be clear and should reflect the business requirement rather than being applied indiscriminately.

---

# 6. Performance

Prisma usage should remain performance-conscious. The repository layer should avoid N+1 query patterns and should fetch only the fields that are required for the current operation.

Pagination should be used where result sets may grow large. Queries should prefer indexed lookups and avoid unnecessary joins or repeated round-trips when a more efficient approach is available.

---

# 7. Data Integrity

Data integrity is a critical requirement. Repositories should respect foreign keys and preserve referential integrity at the persistence boundary.

Business validation should occur before persistence, but the persistence layer should still enforce the structural and relational constraints defined by the schema.

---

# 8. Seeding

Seed scripts should remain idempotent where practical so they can be executed repeatedly without introducing inconsistent state.

Development data should be separated from production data. Seed data should support local development and verification without being treated as production content.

---

# 9. AI Guidance

AI agents should follow these expectations when working with Prisma in this repository:

- Extend existing repositories rather than introducing new persistence patterns.
- Avoid duplicate queries and repeated data access logic.
- Keep Prisma isolated within repositories.
- Preserve schema consistency with the domain model.
- Reuse existing models and repository conventions.

These practices help keep the backend reliable, maintainable, and aligned with the repository’s architecture.

# Migrations

Database schema changes should always be introduced through Prisma migrations.

Avoid modifying production databases manually.

Each migration should represent a meaningful business change and should be reviewed before deployment.

Schema changes should preserve existing data whenever practical.
