import { Resend } from 'resend';

class EmailService {
  private resend: Resend | null = null;
  private fromEmail: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.fromEmail = process.env.EMAIL_FROM || 'Sprinkl <notifications@sprinkl.biz>';

    if (apiKey && apiKey !== 're_mock_api_key') {
      this.resend = new Resend(apiKey);
    }
  }

  /**
   * Send email verification link
   */
  async sendVerificationEmail(email: string, fullName: string, token: string) {
    const domain = process.env.DOMAIN || 'https://sprinkl.biz';
    const verifyUrl = `${domain}/verify-email?token=${token}`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0f17; color: #f8fafc; padding: 40px 24px; border-radius: 16px; border: 1px solid #1e293b;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #10b981; font-size: 28px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">Sprinkl</h1>
          <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Automated Cash & Crypto Giveaways</p>
        </div>
        
        <div style="background-color: #131b2e; padding: 28px; border-radius: 12px; border: 1px solid #1e293b;">
          <h2 style="color: #ffffff; font-size: 18px; font-weight: 700; margin-top: 0;">Verify your email address</h2>
          <p style="color: #94a3b8; font-size: 14px; line-height: 22px;">
            Hello ${fullName},<br><br>
            Welcome to Sprinkl! To activate your host wallet and start launching giveaways, please verify your email address.
          </p>
          
          <div style="text-align: center; margin: 32px 0;">
            <a href="${verifyUrl}" style="background-color: #10b981; color: #022c22; font-weight: 700; font-size: 14px; text-decoration: none; padding: 14px 32px; border-radius: 10px; display: inline-block; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3);">
              Verify Email Address
            </a>
          </div>
          
          <p style="color: #64748b; font-size: 12px; line-height: 18px; word-break: break-all;">
            Or copy and paste this link in your browser:<br>
            <a href="${verifyUrl}" style="color: #10b981;">${verifyUrl}</a>
          </p>
          
          <p style="color: #64748b; font-size: 11px; margin-top: 24px;">
            This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.
          </p>
        </div>
      </div>
    `;

    if (!this.resend) {
      console.log(`[EmailService Dev Mock] Verification link for ${email}: ${verifyUrl}`);
      return { success: true, mock: true };
    }

    try {
      const data = await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: 'Verify your Sprinkl Host Account',
        html,
      });
      return { success: true, data };
    } catch (err: any) {
      console.error('[EmailService Error]', err);
      // Don't crash auth flow if email provider fails
      return { success: false, error: err.message };
    }
  }
}

export default new EmailService();
