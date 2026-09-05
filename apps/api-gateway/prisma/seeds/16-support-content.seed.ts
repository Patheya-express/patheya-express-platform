import { PrismaClient } from '@prisma/client';

/**
 * Static FAQ content (FaqRepository / faq.controller.ts) covering the categories a developer is
 * most likely to poke at locally: order tracking, cancellation/refunds, delivery, restaurant
 * onboarding, delivery partner onboarding, and general account help.
 */
const FAQS: Array<{
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
}> = [
  {
    category: 'Orders',
    question: 'How do I track my order?',
    answer:
      'Open the order from your order history — live status and, once a delivery partner is assigned, their location are shown on the tracking screen.',
    sortOrder: 0,
  },
  {
    category: 'Orders',
    question: 'Can I cancel an order after placing it?',
    answer:
      'You can cancel while the order is still PENDING or CONFIRMED. Once it moves to PREPARING or later, cancellation is no longer available from the app — contact support instead.',
    sortOrder: 1,
  },
  {
    category: 'Orders',
    question: 'How long does a refund take?',
    answer:
      'Refunds for cancelled or failed orders are issued to your original payment method and typically reflect within 5-7 business days, depending on your bank.',
    sortOrder: 2,
  },
  {
    category: 'Delivery',
    question: 'How is my delivery fee calculated?',
    answer:
      'Delivery fee is a flat amount set per order at checkout, shown in the order summary before you pay — it does not change after the order is placed.',
    sortOrder: 0,
  },
  {
    category: 'Delivery',
    question: 'What do I do if my delivery partner is delayed?',
    answer:
      'Check the live tracking screen for an updated ETA. If the delay looks unusual, use in-app support to reach out and we will follow up with the delivery partner.',
    sortOrder: 1,
  },
  {
    category: 'Restaurant Onboarding',
    question: 'How do I list my restaurant on Patheya Express?',
    answer:
      'Sign up as a restaurant owner and complete the onboarding flow — business details, documents, and bank account verification. Our team reviews and approves new restaurants before they go live.',
    sortOrder: 0,
  },
  {
    category: 'Delivery Partner Onboarding',
    question: 'How do I become a delivery partner?',
    answer:
      'Register with the delivery partner role and complete onboarding — vehicle details, license, and identity verification. Once verified, you can set yourself AVAILABLE to start receiving deliveries.',
    sortOrder: 0,
  },
  {
    category: 'Account',
    question: 'How do I reset my password?',
    answer:
      'Use "Forgot password" on the login screen to receive a reset link by email. The link expires after a short time for security, so request a new one if it lapses.',
    sortOrder: 0,
  },
];

export async function seedSupportContent(prisma: PrismaClient): Promise<void> {
  console.log('❓ Seeding FAQ content...');

  let faqCount = 0;

  for (const faq of FAQS) {
    const existing = await prisma.fAQ.findFirst({
      where: { category: faq.category, question: faq.question },
    });

    if (existing) {
      continue;
    }

    await prisma.fAQ.create({
      data: {
        category: faq.category,
        question: faq.question,
        answer: faq.answer,
        sortOrder: faq.sortOrder,
        isActive: true,
      },
    });

    faqCount++;
  }

  console.log(`✅ ${faqCount} FAQ entries seeded.`);
}
