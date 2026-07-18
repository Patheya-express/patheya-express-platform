-- Additive only: adds one new UserRole enum value used by the manual dispatch-assignment
-- admin endpoints (POST /admin/orders/:orderId/assign). No existing enum value is renamed or
-- removed, no table/column changes — every existing User row and every existing role check
-- (CUSTOMER/RESTAURANT_OWNER/RESTAURANT_MANAGER/DELIVERY_PARTNER/SUPPORT_AGENT/ADMIN/SUPER_ADMIN)
-- is unaffected.
ALTER TYPE "UserRole" ADD VALUE 'DISPATCH_MANAGER';
