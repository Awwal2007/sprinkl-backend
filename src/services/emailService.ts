import { Resend } from 'resend';

class EmailService {
  private resend: Resend | null = null;
  private fromEmail: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.fromEmail = process.env.EMAIL_FROM || 'Sprinkl <onboarding@sprinkl.biz>';

    if (apiKey && apiKey !== 're_mock_api_key') {
      this.resend = new Resend(apiKey);
    }
  }

  /**
   * Helper to render a copy-ready verification code email template
   */
  private renderCodeTemplate({
    title,
    subtitle,
    fullName,
    code,
    description,
    expiryMinutes = 10,
    actionUrl,
    actionText,
  }: {
    title: string;
    subtitle: string;
    fullName: string;
    code: string;
    description: string;
    expiryMinutes?: number;
    actionUrl?: string;
    actionText?: string;
  }) {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0f17; color: #f8fafc; padding: 40px 24px; border-radius: 16px; border: 1px solid #1e293b;">
        <div style="text-align: center; margin-bottom: 28px;">
          <h1 style="color: #10b981; font-size: 28px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">Sprinkl</h1>
          <p style="color: #64748b; font-size: 13px; margin-top: 4px;">${subtitle}</p>
        </div>
        
        <div style="background-color: #131b2e; padding: 28px; border-radius: 14px; border: 1px solid #1e293b; text-align: center;">
          <h2 style="color: #ffffff; font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 12px;">${title}</h2>
          <p style="color: #94a3b8; font-size: 14px; line-height: 22px; margin: 0 0 24px 0; text-align: left;">
            Hello ${fullName || 'Host'},<br><br>
            ${description}
          </p>
          
          <!-- Copy-ready Verification Code Container -->
          <div style="margin: 24px auto; text-align: center;">
            <div style="display: inline-block; background-color: #0b0f17; border: 2px solid #10b981; border-radius: 12px; padding: 16px 36px; user-select: all; -webkit-user-select: all;">
              <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 36px; font-weight: 900; letter-spacing: 6px; color: #10b981; user-select: all; -webkit-user-select: all;">${code}</span>
            </div>
            <div style="margin-top: 12px;">
              <p style="color: #64748b; font-size: 12px; margin: 0;">
                Click or tap the code to copy directly:
              </p>
              <div style="margin-top: 6px; display: inline-block; background-color: #1e293b; padding: 6px 14px; border-radius: 6px; border: 1px dashed #334155;">
                <code style="color: #38bdf8; font-family: monospace; font-size: 15px; font-weight: 700; user-select: all; -webkit-user-select: all;">${code}</code>
              </div>
            </div>
          </div>

          ${
            actionUrl && actionText
              ? `
            <div style="margin: 28px 0 16px 0;">
              <a href="${actionUrl}" style="background-color: #10b981; color: #022c22; font-weight: 700; font-size: 14px; text-decoration: none; padding: 14px 32px; border-radius: 10px; display: inline-block; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3);">
                ${actionText}
              </a>
            </div>
            <p style="color: #64748b; font-size: 11px; line-height: 16px; word-break: break-all; margin-top: 12px;">
              Or copy link: <a href="${actionUrl}" style="color: #10b981;">${actionUrl}</a>
            </p>
            `
              : ''
          }
          
          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #1e293b;">
            <p style="color: #64748b; font-size: 12px; margin: 0; line-height: 18px;">
              This code expires in <strong>${expiryMinutes} minutes</strong>. If you did not initiate this request, please change your password immediately or contact support.
            </p>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Send login verification code (2FA)
   */
  async sendLoginOtpEmail(email: string, fullName: string, otp: string) {
    const html = this.renderCodeTemplate({
      title: 'Login Verification Code',
      subtitle: 'Host Account Security',
      fullName,
      code: otp,
      description: 'A sign-in attempt was requested for your Sprinkl account. Enter the verification code below to complete your login:',
      expiryMinutes: 10,
    });

    if (!this.resend) {
      console.log(`[EmailService Dev Mock] Login verification OTP for ${email}: ${otp}`);
      return { success: true, mock: true };
    }

    try {
      const data = await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: `${otp} — Your Sprinkl Login Verification Code`,
        html,
      });
      return { success: true, data };
    } catch (err: any) {
      console.error('[EmailService Login OTP Error]', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Send email verification link and copyable 6-digit code
   */
  async sendVerificationEmail(
    email: string,
    fullName: string,
    token: string,
    clientOrigin?: string,
    code?: string
  ) {
    const domain = clientOrigin || process.env.DOMAIN || 'https://www.sprinkl.biz';
    const verifyUrl = `${domain}/verify-email?token=${token}`;
    const displayCode = code || token.slice(0, 6).toUpperCase();

    const html = this.renderCodeTemplate({
      title: 'Verify Your Email Address',
      subtitle: 'Automated Cash & Crypto Giveaways',
      fullName,
      code: displayCode,
      description: 'Welcome to Sprinkl! To activate your host wallet and start launching giveaways, verify your email using this 6-digit code or the button below:',
      expiryMinutes: 60 * 24, // 24 hours
      actionUrl: verifyUrl,
      actionText: 'Verify Email Address',
    });

    if (!this.resend) {
      console.log(`[EmailService Dev Mock] Verification link for ${email}: ${verifyUrl} | Code: ${displayCode}`);
      return { success: true, mock: true };
    }

    try {
      const data = await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: `${displayCode} — Verify your Sprinkl Host Account`,
        html,
      });
      return { success: true, data };
    } catch (err: any) {
      console.error('[EmailService Verification Error]', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Send a 6-digit password reset OTP to the user's email
   */
  async sendPasswordResetOtpEmail(email: string, fullName: string, otp: string) {
    const html = this.renderCodeTemplate({
      title: 'Reset Your Password',
      subtitle: 'Host Account Security',
      fullName,
      code: otp,
      description: 'We received a request to reset your Sprinkl password. Enter the 6-digit code below to set your new password:',
      expiryMinutes: 15,
    });

    if (!this.resend) {
      console.log(`[EmailService Dev Mock] Password reset OTP for ${email}: ${otp}`);
      return { success: true, mock: true };
    }

    try {
      const data = await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: `${otp} — Your Sprinkl Password Reset Code`,
        html,
      });
      return { success: true, data };
    } catch (err: any) {
      console.error('[EmailService Reset OTP Error]', err);
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

          <div style="text-align: center; margin-top: 24px; display: flex; justify-content: center; gap: 12px;">
            <a href="${domain}/admin?tab=support&session=${params.sessionId}" style="background-color: #10b981; color: #022c22; font-weight: 700; font-size: 13px; text-decoration: none; padding: 10px 20px; border-radius: 8px; display: inline-block;">
              Open in Admin Chat Desk
            </a>
            <a href="mailto:${params.senderEmail}?subject=Re:%20Sprinkl%20Support%20Inquiry%20(Session%20${params.sessionId})" style="background-color: #1e293b; color: #f8fafc; font-weight: 600; font-size: 13px; text-decoration: none; padding: 10px 20px; border-radius: 8px; display: inline-block; border: 1px solid #334155;">
              Reply via Email
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
        subject: `[Sprinkl Support] Message from ${params.senderName}`,
        html,
      });
      return { success: true, data };
    } catch (err: any) {
      console.error('[EmailService Support Notification Error]', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Send notification to user when an admin replies to their support chat
   */
  async sendAdminReplyNotificationEmail(params: {
    userName: string;
    userEmail: string;
    adminName: string;
    replyText: string;
    sessionId: string;
  }) {
    if (!params.userEmail || params.userEmail.includes('@guest') || params.userEmail.includes('support-guest')) {
      return { success: false, reason: 'Guest email, skipped' };
    }

    const domain = process.env.DOMAIN || 'https://www.sprinkl.biz';
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b0f17; color: #f8fafc; padding: 32px 20px; border-radius: 16px; border: 1px solid #1e293b;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #10b981; font-size: 24px; font-weight: 800; margin: 0;">Sprinkl Support</h1>
          <p style="color: #94a3b8; font-size: 13px; margin-top: 4px;">New reply from our support team</p>
        </div>

        <div style="background-color: #131b2e; padding: 24px; border-radius: 12px; border: 1px solid #1e293b;">
          <p style="color: #cbd5e1; font-size: 14px; margin-top: 0;">
            Hello ${params.userName || 'there'},<br><br>
            <strong>${params.adminName || 'A support specialist'}</strong> from Sprinkl has replied to your conversation:
          </p>

          <div style="background-color: #0b0f17; padding: 16px; border-radius: 8px; border: 1px solid #1e293b; color: #f8fafc; font-size: 14px; line-height: 22px; margin: 16px 0; white-space: pre-wrap;">${params.replyText}</div>

          <div style="text-align: center; margin-top: 24px;">
            <a href="${domain}" style="background-color: #10b981; color: #022c22; font-weight: 700; font-size: 13px; text-decoration: none; padding: 12px 28px; border-radius: 8px; display: inline-block;">
              View Chat & Reply
            </a>
          </div>
        </div>
      </div>
    `;

    if (!this.resend) {
      console.log(`[EmailService Dev Mock] Admin reply email to user ${params.userEmail}: "${params.replyText}"`);
      return { success: true, mock: true };
    }

    try {
      const data = await this.resend.emails.send({
        from: this.fromEmail,
        to: params.userEmail,
        subject: `Re: Sprinkl Support - New message from ${params.adminName}`,
        html,
      });
      return { success: true, data };
    } catch (err: any) {
      console.error('[EmailService User Reply Error]', err);
      return { success: false, error: err.message };
    }
  }
}

export default new EmailService();
