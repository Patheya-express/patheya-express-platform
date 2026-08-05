-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_userId_type_orderId_key" ON "wallet_transactions"("userId", "type", "orderId");
