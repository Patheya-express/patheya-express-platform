import { Module } from '@nestjs/common';

import { WalletController } from './controllers/wallet.controller';
import { WalletService } from './services/wallet.service';
import { WalletRepository } from './repositories/wallet.repository';
import { WalletEventListener } from './listeners/wallet-event.listener';

import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [NotificationsModule, AuditModule],

  controllers: [WalletController],

  providers: [WalletService, WalletRepository, WalletEventListener],

  exports: [WalletService],
})
export class WalletModule {}
