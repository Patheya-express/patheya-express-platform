-- Additive only: new indexes, no column/table changes, no data migration.
--
-- orders(deliveryPartnerId): DeliveryRepository.getDeliveryStatsForUserIds groups/filters orders
-- by deliveryPartnerId + status on every admin delivery-partner listing request — previously
-- unindexed, relying on the deliveryPartner relation's implicit FK constraint alone.
-- orders(createdAt): the natural sort/filter key for recent-orders listings (admin search,
-- restaurant dashboard) — previously unindexed.
CREATE INDEX "orders_deliveryPartnerId_idx" ON "orders"("deliveryPartnerId");
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- delivery_partners(status, isVerified): DispatchRepository.findAvailablePartners filters on
-- exactly this pair on every automatic dispatch cycle (the dispatch hot path) — previously only
-- a single-column index on status existed.
CREATE INDEX "delivery_partners_status_isVerified_idx" ON "delivery_partners"("status", "isVerified");
