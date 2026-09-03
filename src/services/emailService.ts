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

  /**
   * Send notification email to admin when a user submits a support chat message
   */
  async sendSupportNotificationEmail(params: {
    senderName: string;
    senderEmail: string;
    messageText: string;
    sessionId: string;
    attachments?: Array<{ filename: string; url: string; size: number }>;
  }) {
    const domain = process.env.DOMAIN || 'https://www.sprinkl.biz';
    const adminEmail = process.env.ADMIN_EMAIL || process.env.SUPPORT_EMAIL || 'notifications@sprinkl.biz';

    const attachmentListHtml =
      params.attachments && params.attachments.length > 0
        ? `
        <div style="margin-top: 16px; padding: 12px; background-color: #0b0f17; border-radius: 8px; border: 1px solid #334155;">
          <p style="color: #94a3b8; font-size: 12px; font-weight: 700; margin: 0 0 8px 0; text-transform: uppercase;">
            Attachments (${params.attachments.length}):
          </p>
          <ul style="margin: 0; padding-left: 20px; color: #38bdf8; font-size: 13px;">
            ${params.attachments
              .map(
                (att) =>
                  `<li style="margin-bottom: 6px;"><a href="${att.url}" target="_blank" style="color: #38bdf8; text-decoration: underline;">${att.filename}</a> (${Math.round(att.size / 1024)} KB)</li>`
              )
              .join('')}
          </ul>
        </div>
      `
        : '';

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0f17; color: #f8fafc; padding: 32px 20px; border-radius: 16px; border: 1px solid #1e293b;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #10b981; font-size: 24px; font-weight: 800; margin: 0;">Sprinkl Support Desk</h1>
          <p style="color: #f59e0b; font-size: 13px; font-weight: 700; margin-top: 4px;">⚠️ Live Agent Escalation Requested by ${params.senderName}</p>
        </div>

        <div style="background-color: #131b2e; padding: 24px; border-radius: 12px; border: 1px solid #1e293b;">
          <div style="border-bottom: 1px solid #1e293b; padding-bottom: 16px; margin-bottom: 16px;">
            <p style="color: #94a3b8; font-size: 13px; margin: 4px 0;"><strong>From:</strong> ${params.senderName} (<a href="mailto:${params.senderEmail}" style="color: #10b981;">${params.senderEmail}</a>)</p>
            <p style="color: #94a3b8; font-size: 13px; margin: 4px 0;"><strong>Session ID:</strong> <code style="background-color: #0b0f17; padding: 2px 6px; border-radius: 4px; color: #f1f5f9;">${params.sessionId}</code></p>
            <p style="color: #94a3b8; font-size: 13px; margin: 4px 0;"><strong>Received At:</strong> ${new Date().toLocaleString()}</p>
          </div>

          <p style="color: #cbd5e1; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px;">User Message / Request:</p>
          <div style="background-color: #0b0f17; padding: 16px; border-radius: 8px; border: 1px solid #1e293b; color: #f8fafc; font-size: 14px; line-height: 22px; white-space: pre-wrap;">${params.messageText}</div>

          ${attachmentListHtml}

          <div style="text-align: center; margin-top: 24px;">
            <a href="mailto:${params.senderEmail}?subject=Re:%20Sprinkl%20Support%20Inquiry%20(Session%20${params.sessionId})" style="background-color: #10b981; color: #022c22; font-weight: 700; font-size: 13px; text-decoration: none; padding: 10px 24px; border-radius: 8px; display: inline-block;">
              Reply Directly via Email
            </a>
          </div>
        </div>
      </div>
    `;

    if (!this.resend) {
      console.log(`[EmailService Dev Mock] Agent escalation email to ${adminEmail} from ${params.senderEmail}: "${params.messageText}"`);
      return { success: true, mock: true };
    }

    try {
      const data = await this.resend.emails.send({
        from: this.fromEmail,
        to: adminEmail,
        replyTo: params.senderEmail,
        subject: `[Sprinkl Support] Agent Requested by ${params.senderName}`,
        html,
      });
      return { success: true, data };
    } catch (err: any) {
      console.error('[EmailService Support Notification Error]', err);
      return { success: false, error: err.message };
    }
  }
}

export default new EmailService();
