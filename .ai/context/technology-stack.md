# Technology Stack

This document defines the approved technology stack for Patheya Express. It exists to provide a clear and stable reference for both AI coding agents and human developers so that new work uses the technologies that the platform has already committed to.

All new development should use the documented technologies unless an architectural decision explicitly changes them.

---

# 1. Purpose

The purpose of this document is to identify the technologies that form the foundation of the Patheya Express platform. It is intentionally limited to technology selection and role description. It does not replace architecture, standards, or implementation documentation.

The stack reflects the platform’s need for reliability, maintainability, developer productivity, and long-term support.

---

# 2. Backend Stack

| Technology | Purpose |
| --- | --- |
| Node.js | Runtime environment for backend services and development tooling. |
| NestJS | Primary backend framework for building modular, structured server-side applications. |
| TypeScript | Main language for the backend, providing static typing and improved maintainability. |
| Prisma | Type-safe database toolkit used for schema management and data access. |
| PostgreSQL | Primary relational database for transactional application data. |
| Redis | In-memory data store used for caching, sessions, and fast shared state. |
| BullMQ | Background job and queue processing framework for asynchronous workloads. |
| Socket.IO | Real-time communication layer for live events and interactive features. |
| Swagger / OpenAPI | API documentation and contract generation for backend endpoints. |
| JWT | Token-based authentication mechanism for secure stateless identity handling. |
| bcrypt | Password hashing library for secure authentication workflows. |
| Cloudinary | Media storage and delivery provider for uploaded assets and file handling. |

---

# 3. Frontend Stack

| Technology | Purpose |
| --- | --- |
| Angular | Primary frontend framework for building rich client-side applications. |
| Nx Workspace | Monorepo tooling for organizing and managing multiple frontend applications and shared libraries. |
| TypeScript | Main language for frontend code, enabling strong typing and safer development. |
| Angular Signals | Reactive state mechanism used for component and application state management. |
| Standalone Components | Component model used to build modular and composable UI surfaces. |
| SCSS | Styling language used for application-level design and component styling. |
| Generated OpenAPI SDK | Type-safe API client generated from backend contracts for frontend integration. |
| Capacitor  | Enables building Android and iOS applications from the Angular applications using a shared codebase. |


---

# 4. Development Tools

| Tool | Purpose |
| --- | --- |
| pnpm | Package manager used for dependency installation and workspace management. |
| Git | Version control system for source code management and collaboration. |
| GitHub | Source hosting, pull request workflow, and repository collaboration. |
| GitHub Copilot | AI-assisted coding tool used to support development workflows. |
| Visual Studio Code | Primary integrated development environment for project work. |
| PADK | Patheya AI Development Kit, the repository’s AI knowledge base and engineering guidance system. |

---

# 5. Infrastructure

| Infrastructure Component | Purpose |
| --- | --- |
| PostgreSQL | Managed relational database service for production data storage. |
| Redis | Managed caching and realtime-ready data store for supporting services. |
| Docker | Containerization technology used for environment consistency and deployment workflows. |
| Render | Deployment platform used for hosting backend services and supporting workloads. |
| Vercel | Deployment platform used for frontend applications and associated assets. |

---

# 6. API Standards

REST APIs are documented using Swagger and OpenAPI. Frontend communication should use the generated OpenAPI SDK rather than relying on ad hoc HTTP client usage when a generated endpoint already exists.

The generated OpenAPI SDK is the single source of truth for backend communication.

Do not create custom HTTP services when an equivalent SDK endpoint exists.

---

# 7. Technology Selection Principles

Technology choices are guided by the following principles:

- Enterprise maturity: technologies should be appropriate for long-lived business systems.
- Long-term maintenance: selected technologies should be sustainable over time.
- Community support: strong ecosystem support reduces implementation and support risk.
- Strong TypeScript ecosystem: TypeScript-first tooling is preferred where practical.
- Scalability: the stack should support growth in traffic, users, and operational complexity.
- Security: technologies should support secure application development and deployment.
- Performance: the stack should allow efficient execution under production demands.
- Developer productivity: tools should improve speed and quality without introducing unnecessary complexity.

---

# 8. Updating the Technology Stack

This document should be updated whenever technologies are introduced, replaced, or removed. Major technology changes should also be recorded through an Architecture Decision Record so that the rationale and impact are preserved for future reference.
