    # Project Overview

    Patheya Express is an enterprise-grade online food delivery platform designed to support the full lifecycle of food commerce in a modern digital marketplace. The platform is inspired by services such as Swiggy, Zomato, and Uber Eats, but it is being built as a deliberate, production-oriented system rather than a lightweight prototype. Its purpose is to provide a scalable and maintainable foundation for customers, restaurants, delivery partners, support teams, and administrators.

    The platform is intended to support real-world operations at enterprise scale. This includes reliable order handling, role-based access, secure payments, delivery coordination, communication flows, and operational oversight. It is being developed with enterprise architecture principles from the beginning, and the project does not rely on MVP shortcuts or temporary implementation patterns that would undermine long-term quality.

    ---

    # 1. Project Overview

    Patheya Express exists to connect the core participants in a digital food delivery ecosystem. Customers need a reliable way to discover restaurants, browse menus, place orders, and track progress. Restaurants need tools to present offers, manage availability, and fulfill orders efficiently. Delivery partners need a dependable workflow for accepting and completing assignments. Administrators and support teams need clear operational visibility and the ability to manage exceptions.

    The platform is being designed as a durable product foundation that can support growth, change, and future enhancement without requiring repeated rework. Its scope spans both customer-facing experiences and operational back-office capabilities.

    ---

    # 2. Project Vision

    The long-term vision for Patheya Express is to become a production-ready, enterprise-first delivery platform that can scale with demand and evolve with business needs. The system is intended to be:

    - production-ready from day one
    - architected for enterprise use
    - highly scalable
    - secure by design
    - modular and extensible
    - maintainable over time
    - suitable for cloud deployment and operational growth
    - supported by AI-assisted development practices through PADK

    This vision reflects the expectation that the platform will be used as a serious business system, not as a temporary experiment. The architecture, engineering standards, and documentation practices are therefore designed to support longevity and operational excellence.

    ---

    # 3. Business Domains

    Patheya Express is organized around a set of core business domains that reflect the main responsibilities of the platform.

    - Authentication: user identity, sign-in, session handling, access control, and security boundaries.
    - Customer: customer accounts, profiles, preferences, browsing behavior, and order history.
    - Restaurant: restaurant and branch information, business profiles, service availability, and operational configuration.
    - Menu: catalog structure, categories, items, modifiers, availability, and pricing.
    - Cart: selection, quantity management, and temporary order composition.
    - Checkout: order submission, address handling, payment initiation, and confirmation.
    - Orders: lifecycle management, fulfillment states, status updates, and operational visibility.
    - Dispatch: assignment and routing of delivery work to available partners.
    - Delivery: delivery execution, tracking, handoff, and completion flows.
    - Payments: payment capture, transaction handling, reconciliation, and settlement-related concerns.
    - Notifications: customer and partner communication through email, SMS, push, or in-app channels.
    - Reviews and Ratings: feedback, quality signals, and customer sentiment.
    - Administration: back-office control, operational management, and administrative workflows.
    - Reporting and Analytics: business insights, monitoring, and operational reporting.
    - Support: exception handling, issue resolution, and service operations support.

    These domains are interrelated and are expected to evolve together as the system grows.

    ---

    # 4. Repository Overview

    The solution is organized across multiple repositories that together form the platform ecosystem.

    ## Backend Repository

    Name: patheya-express-platform

    Purpose: This repository contains the backend services, APIs, database access layers, background jobs, integrations, and supporting infrastructure required to operate the platform.

    ## Frontend Repository

    Name: patheya-express-frontend

    Purpose: This repository contains the frontend applications and the shared frontend libraries that provide the user experience for customers, restaurants, delivery partners, and administrators.

    The separation reflects a modern product architecture in which backend services and user-facing applications are developed and evolved in parallel while remaining aligned through shared contracts and business logic boundaries.

    ---

    # 5. Applications

    The frontend experience is expected to be delivered through a small set of purpose-built applications.

    - Customer App: the primary experience for end users who browse restaurants, place orders, and track deliveries.
    - Restaurant App: the operational experience for restaurant teams to manage menus, availability, fulfillment, and business settings.
    - Delivery App: the interface for delivery partners to receive assignments, update progress, and complete deliveries.
    - Admin App: the management experience for operators, support personnel, and administrators overseeing the platform.

    Each application is designed to serve a distinct stakeholder group while sharing common platform capabilities where appropriate.

    ---

    # 6. Shared Libraries

    The frontend ecosystem also includes shared libraries that support reuse and consistency across applications.

    - api-sdk: shared client-facing contracts and generated API access for backend communication.
    - auth: authentication-related logic and shared identity handling.
    - shared-ui: reusable interface components, layouts, forms, dialogs, and visual building blocks.
    - core: shared platform utilities, abstractions, and cross-cutting application services.
    - shared-models: shared data structures, domain types, interfaces, and enumerations.

    These libraries help reduce duplication and preserve consistency across the user experience.

    ---

    # 7. Current Development Status

    The project infrastructure has been established and the platform foundation is in place. Authentication, SDK generation, and the shared application foundation have been completed, providing a stable base for further feature development.

    Current work is focused on implementing business features on top of that foundation. This includes extending the platform’s functional coverage in a way that remains consistent with the architecture and long-term quality objectives.

    The document intentionally avoids listing implementation details that may become obsolete as the platform evolves.

    ---

    # 8. Engineering Philosophy

    Patheya Express is being built with a disciplined engineering philosophy that emphasizes long-term sustainability. The project values:

    - enterprise architecture
    - reuse over duplication
    - strong typing and clear contracts
    - layered architectural thinking
    - simplicity where it supports clarity
    - long-term maintainability
    - production readiness
    - consistency across implementations

    This philosophy guides both the technical direction of the platform and the documentation practices that support it.

    ---

    # 9. Relationship with PADK

    This document provides the high-level project context for Patheya Express. It is intended to help both AI coding agents and human developers understand the purpose, scope, and direction of the platform.

    More detailed information is maintained in the PADK knowledge base:

    - Architecture is documented under .ai/architecture
    - Engineering standards are documented under .ai/standards
    - Development workflows are documented under .ai/workflows

    Together, these documents form a structured body of knowledge that supports continued delivery and consistent implementation across the platform.
