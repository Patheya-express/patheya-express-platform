const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const updated = await prisma.deliveryProofOtp.updateMany({
    where: { orderId: '4bc146ae-318f-45df-9be4-2b837d933d8e', type: 'DELIVERY' },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });
  console.log('rows updated:', updated.count);
  await prisma.$disconnect();
})();
