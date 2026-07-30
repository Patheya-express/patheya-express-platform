import { Injectable, Logger } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { createTransport, Transporter } from 'nodemailer';

interface SmtpConfig {
  host?: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

/**
 * Minimal SMTP email delivery — currently used only by the forgot-password flow. Not a general
 * multi-channel notification system (push/SMS remain out of scope for this phase); this is
 * deliberately small and single-purpose. Config is read lazily per-call, not cached at
 * construction time, so a missing SMTP configuration fails clearly only when an email is
 * actually sent, matching the pattern already used for S3 and the bank-account encryption key.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    const transporter = this.createTransporter();

    const { from } = this.requireConfig();

    await transporter.sendMail({
      from,
      to,
      subject: 'Reset your Patheya Express password',
      text: `We received a request to reset your Patheya Express password. This link expires in 30 minutes and can only be used once:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
      html: `
        <p>We received a request to reset your Patheya Express password.</p>
        <p><a href="${resetUrl}">Reset your password</a></p>
        <p>This link expires in 30 minutes and can only be used once.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    });

    this.logger.log(`Password reset email sent to ${to}`);
  }

  private createTransporter(): Transporter {
    const { host, port, user, pass } = this.requireConfig();

    return createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  private requireConfig(): SmtpConfig {
    const smtp = this.config.get<SmtpConfig>('email.smtp');

    if (!smtp?.host) {
      throw new Error(
        'SMTP_HOST is not configured — cannot send email. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM.',
      );
    }

    return smtp;
  }
}
