import { Body, Controller, Headers, Post, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PaymentService } from './payment.service';

@Controller()
export class PaymentWebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('webhook')
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!signature) {
      return res.status(400).send('Missing stripe-signature');
    }

    try {
      await this.paymentService.handleStripeWebhook(
        req.rawBody as Buffer,
        signature,
      );
      return res.status(200).send('ok');
    } catch (err: any) {
      console.error('Webhook processing failed:', err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
}
