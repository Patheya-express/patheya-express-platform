import { Injectable, NotFoundException } from '@nestjs/common';

import { FAQ } from '@prisma/client';

import { FaqRepository } from '../repositories/faq.repository';

import { CreateFaqDto } from '../dto/create-faq.dto';
import { UpdateFaqDto } from '../dto/update-faq.dto';
import { FaqResponseDto } from '../dto/faq-response.dto';

function toFaqResponse(faq: FAQ): FaqResponseDto {
  return {
    id: faq.id,
    category: faq.category,
    question: faq.question,
    answer: faq.answer,
  };
}

@Injectable()
export class FaqService {
  constructor(private readonly faqRepository: FaqRepository) {}

  async findActive(category?: string): Promise<FaqResponseDto[]> {
    const faqs = await this.faqRepository.findActive(category);
    return faqs.map(toFaqResponse);
  }

  async findAllForAdmin() {
    return this.faqRepository.findAllForAdmin();
  }

  async create(dto: CreateFaqDto) {
    return this.faqRepository.create(dto);
  }

  async update(id: string, dto: UpdateFaqDto) {
    const existing = await this.faqRepository.findById(id);

    if (!existing) {
      throw new NotFoundException('FAQ not found');
    }

    return this.faqRepository.update(id, dto);
  }

  async delete(id: string) {
    return this.faqRepository.delete(id);
  }
}
