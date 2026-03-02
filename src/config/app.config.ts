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
  MAIL_USER:string;
  MAIL_PASS: string;
  MAIL_HOST:string;
  MAIL_PORT:string
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
  MAIL_USER:process.env.MAIL_USER as string,
  MAIL_PASS:process.env.MAIL_PASS as string,
  MAIL_HOST: process.env.MAIL_HOST as string,
  MAIL_PORT : process.env.MAIL_PORT as string,
};
