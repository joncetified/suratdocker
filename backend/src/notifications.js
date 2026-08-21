import nodemailer from 'nodemailer';

const deliveryMode = process.env.MAIL_DELIVERY_MODE ?? 'smtp';
const publicAppUrl = (process.env.PUBLIC_APP_URL ?? 'http://localhost:85').replace(/\/$/, '');

const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          }
        : undefined,
      connectionTimeout: 10000,
    })
  : null;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function recordDelivery(pool, {
  userId, channel, recipient, subject, status, error,
}) {
  await pool.query(
    `INSERT INTO notification_logs
      (user_id,channel,recipient,subject,status,error_message)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, channel, recipient, subject ?? null, status, error ?? null],
  );
}

async function sendEmail(pool, { user, subject, text, html, token }) {
  if (deliveryMode === 'test') {
    await recordDelivery(pool, {
      userId: user.id,
      channel: 'EMAIL',
      recipient: user.email,
      subject,
      status: 'SENT',
    });
    return { delivered: true, testToken: token };
  }
  if (!transporter) {
    throw new Error('Layanan SMTP belum dikonfigurasi.');
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? 'SuratBatam <noreply@suratbatam.local>',
      to: user.email,
      subject,
      text,
      html,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    await recordDelivery(pool, {
      userId: user.id,
      channel: 'EMAIL',
      recipient: user.email,
      subject,
      status: 'SENT',
    });
    return { delivered: true };
  } catch (error) {
    await recordDelivery(pool, {
      userId: user.id,
      channel: 'EMAIL',
      recipient: user.email,
      subject,
      status: 'FAILED',
      error: error.message,
    });
    throw error;
  }
}

async function sendWhatsApp(pool, { user, text, token }) {
  const recipient = String(user.phone ?? '').replace(/\D/g, '').replace(/^0/, '62');
  if (!recipient) throw new Error('Akun tidak mempunyai nomor WhatsApp.');
  if (deliveryMode === 'test') {
    await recordDelivery(pool, {
      userId: user.id,
      channel: 'WHATSAPP',
      recipient,
      status: 'SENT',
    });
    return { delivered: true, testToken: token };
  }
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) {
    throw new Error('Layanan WhatsApp belum dikonfigurasi.');
  }
  try {
    const response = await fetch(
      `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'text',
          text: { body: text, preview_url: false },
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`WhatsApp API menolak permintaan (${response.status}).`);
    }
    await recordDelivery(pool, {
      userId: user.id,
      channel: 'WHATSAPP',
      recipient,
      status: 'SENT',
    });
    return { delivered: true };
  } catch (error) {
    await recordDelivery(pool, {
      userId: user.id,
      channel: 'WHATSAPP',
      recipient,
      status: 'FAILED',
      error: error.message,
    });
    throw error;
  }
}

export async function sendActivationMessage(pool, user, token) {
  const link = `${publicAppUrl}/?verify=${encodeURIComponent(token)}`;
  const safeName = escapeHtml(user.name);
  return sendEmail(pool, {
    user,
    token,
    subject: 'Aktifkan akun SuratBatam',
    text: `Halo ${user.name}, aktifkan akun Anda melalui tautan berikut: ${link}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
        <h2>Aktivasi akun SuratBatam</h2>
        <p>Halo ${safeName},</p>
        <p>Klik tombol berikut untuk menghubungkan dan mengaktifkan akun Anda.</p>
        <p><a href="${link}" style="background:#176b4d;color:#fff;padding:12px 18px;
          border-radius:8px;text-decoration:none">Aktifkan akun</a></p>
        <p>Tautan berlaku selama 24 jam. Abaikan email ini jika Anda tidak mendaftar.</p>
      </div>`,
  });
}

export async function sendPasswordResetMessage(pool, user, token, channel) {
  const link = `${publicAppUrl}/?reset=${encodeURIComponent(token)}`;
  if (channel === 'WHATSAPP') {
    return sendWhatsApp(pool, {
      user,
      token,
      text: `Reset password SuratBatam: ${link}. Tautan berlaku 30 menit.`,
    });
  }
  const safeName = escapeHtml(user.name);
  return sendEmail(pool, {
    user,
    token,
    subject: 'Reset password SuratBatam',
    text: `Halo ${user.name}, reset password Anda melalui tautan berikut: ${link}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">
        <h2>Reset password SuratBatam</h2>
        <p>Halo ${safeName},</p>
        <p>Klik tombol berikut untuk membuat password baru.</p>
        <p><a href="${link}" style="background:#176b4d;color:#fff;padding:12px 18px;
          border-radius:8px;text-decoration:none">Reset password</a></p>
        <p>Tautan berlaku selama 30 menit. Abaikan pesan ini jika bukan Anda.</p>
      </div>`,
  });
}
