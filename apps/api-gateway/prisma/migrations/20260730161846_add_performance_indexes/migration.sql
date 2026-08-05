-- CreateIndex
CREATE INDEX "orders_restaurantId_placedAt_idx" ON "orders"("restaurantId", "placedAt");

-- CreateIndex
CREATE INDEX "orders_customerId_createdAt_idx" ON "orders"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_branchId_idx" ON "orders"("branchId");

-- CreateIndex
CREATE INDEX "orders_placedAt_idx" ON "orders"("placedAt");

-- CreateIndex
CREATE INDEX "payments_createdAt_idx" ON "payments"("createdAt");

-- CreateIndex
CREATE INDEX "restaurants_status_isActive_idx" ON "restaurants"("status", "isActive");

-- CreateIndex
CREATE INDEX "support_tickets_status_escalatedAt_idx" ON "support_tickets"("status", "escalatedAt");
