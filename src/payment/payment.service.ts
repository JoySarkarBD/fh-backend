import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MongoIdDto } from 'src/common/dto/mongoId.dto';
import { AuthUser } from 'src/common/interface/auth-user.interface';
import { config } from 'src/config/app.config';
import {
  Payment,
  PaymentDocument,
  PaymentStatus,
} from 'src/schemas/payment.schema';
import Stripe from 'stripe';
import { User, UserDocument } from '../schemas/user.schema';

@Injectable()
export class PaymentService {
  private stripe: Stripe;
  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {
    const secretKey = config.STRIPE_SECRET_KEY;
    if (!secretKey) throw new Error('STRIPE_SECRET_KEY not set');

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2026-02-25.clover',
    });
  }

  async createCheckoutSession(
    userId: string,
    options?: { successUrl?: string; cancelUrl?: string },
  ): Promise<{
    transactionId: string;
    checkoutSessionId: string;
    checkoutSessionUrl: string | null;
    successUrl: string;
    cancelUrl: string;
    amount: number;
    currency: string;
  }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.isSubscribed) {
      throw new BadRequestException('You already have lifetime access');
    }
    if (user.isSuspended) {
      throw new BadRequestException('Suspended users cannot create payments');
    }

    const stripePriceId = config.STRIPE_PRICE_ID;
    if (!stripePriceId) {
      throw new BadRequestException('STRIPE_PRICE_ID not set');
    }

    // Create pending payment in DB to link with Stripe session (for later verification in webhook)
    const pendingPayment = await this.paymentModel.create({
      user: new Types.ObjectId(userId),
      amount: 99, // TODO: USE ENV VARIABLE OR STRIPE API TO GET PRICE
      currency: 'usd',
      status: PaymentStatus.PENDING,
      transactionId: `txn_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });

    const frontendBaseUrl = config.FRONTEND_BASE_URL;

    const successUrl =
      options?.successUrl ||
      `${frontendBaseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = options?.cancelUrl || `${frontendBaseUrl}/payment/cancel`;

    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: pendingPayment._id.toString(), // very important for webhook
      metadata: { userId: userId.toString() },
    });

    // Save session id
    await this.paymentModel.findByIdAndUpdate(pendingPayment._id, {
      stripeCheckoutSessionId: session.id,
    });

    return {
      transactionId: pendingPayment.transactionId,
      checkoutSessionId: session.id,
      checkoutSessionUrl: session.url ?? null,
      successUrl,
      cancelUrl,
      amount: pendingPayment.amount,
      currency: pendingPayment.currency,
    };
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const webhookSecret = config.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set');

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        const paymentId = session.client_reference_id;
        if (!paymentId) {
          console.warn('No client_reference_id in session');
          return;
        }

        const payment = await this.paymentModel.findById(paymentId);
        if (!payment) {
          console.warn(`Payment not found: ${paymentId}`);
          return;
        }

        // Mark as completed
        const paymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : payment.transactionId;

        await this.paymentModel.findByIdAndUpdate(paymentId, {
          status: PaymentStatus.COMPLETED,
          transactionId: paymentIntentId,
          stripePaymentIntentId: paymentIntentId,
          lifetimeAccessGranted: true,
          paidAt: new Date(),
        });

        // Grant access
        await this.userModel.findByIdAndUpdate(payment.user, {
          isSubscribed: true,
        });

        console.log(`Lifetime access granted to user ${payment.user}`);
        break;
      }

      case 'checkout.session.expired':
        {
          const session = event.data.object as Stripe.Checkout.Session;
          const paymentId = session.client_reference_id;
          if (paymentId) {
            await this.paymentModel.findByIdAndUpdate(paymentId, {
              status: PaymentStatus.FAILED,
            });
          }
        }
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }
  }

  async create(user: AuthUser) {
    const data = await this.createCheckoutSession(user.userId, {
      successUrl: `${config.FRONTEND_BASE_URL}/dashboard/profile/subscription?payment=success`,
      cancelUrl: `${config.FRONTEND_BASE_URL}/payment/cancel`,
    });

    return {
      message: 'Checkout session created successfully',
      data,
    };
  }

  async findAll() {
    const payments = await this.paymentModel
      .find()
      .sort({ createdAt: -1 })
      .populate('user', 'name email role');

    return {
      message: 'Payments fetched successfully',
      data: payments,
    };
  }

  async findMyHistory(user: AuthUser) {
    this.ensureValidObjectId(user.userId);

    const payments = await this.paymentModel
      .find({ user: new Types.ObjectId(user.userId) })
      .sort({ createdAt: -1 });

    return {
      message: 'Payment history fetched successfully',
      data: payments,
    };
  }

  async findOne(id: MongoIdDto['id']) {
    this.ensureValidObjectId(id);

    const payment = await this.paymentModel
      .findById(id)
      .populate('user', 'name email role');
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return {
      message: 'Payment fetched successfully',
      data: payment,
    };
  }

  private ensureValidObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid id');
    }
  }
}
