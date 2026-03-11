interface config {
  FRONTEND_BASE_URL: string;
  MONGO_URI: string;
  PORT: number;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_PRICE_ID: string;
  STRIPE_WEBHOOK_SECRET: string;
  MAIL_USER: string;
  MAIL_PASS: string;
  MAIL_HOST: string;
  MAIL_PORT: string;
  CONTACT_RECEIVER_EMAIL: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  AWS_S3_BUCKET_NAME: string;
  AWS_SES_FROM_EMAIL: string;
  RABBITMQ_URL: string;
  RABBITMQ_MAIL_QUEUE: string;
  RABBITMQ_CHAT_QUEUE: string;
  REDIS_URL: string;
}
export const config: config = {
  PORT: parseInt(process.env.PORT as string, 10) || 5000,
  MONGO_URI: process.env.MONGO_URI as string,
  FRONTEND_BASE_URL: process.env.FRONTEND_BASE_URL as string,
  JWT_SECRET: process.env.JWT_SECRET as string,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN as string,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID as string,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET as string,
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY as string,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY as string,
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID as string,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET as string,
  MAIL_USER: process.env.MAIL_USER as string,
  MAIL_PASS: process.env.MAIL_PASS as string,
  MAIL_HOST: process.env.MAIL_HOST as string,
  MAIL_PORT: process.env.MAIL_PORT as string,
  CONTACT_RECEIVER_EMAIL: process.env.CONTACT_RECEIVER_EMAIL as string,
  AWS_S3_BUCKET_NAME: process.env.AWS_S3_BUCKET_NAME as string,
  AWS_SES_FROM_EMAIL: process.env.AWS_SES_FROM_EMAIL as string,
  AWS_REGION: process.env.AWS_REGION as string,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_ACCESS_KEY_ID as string,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID as string,
  RABBITMQ_URL: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
  RABBITMQ_MAIL_QUEUE: process.env.RABBITMQ_MAIL_QUEUE || 'mail_queue',
  RABBITMQ_CHAT_QUEUE: process.env.RABBITMQ_CHAT_QUEUE || 'chat_message_queue',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
};
