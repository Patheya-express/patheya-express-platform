import { PrismaService }
from '../prisma.service';

export abstract class BaseRepository {

  constructor(

    protected readonly prisma:
      PrismaService,

  ) {}

}