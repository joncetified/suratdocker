import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import bcrypt from 'bcryptjs';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { pool, initializeDatabase } from './db.js';
import {
  sendActivationMessage,
  sendPasswordResetMessage,
} from './notifications.js';
import { registerSystemRoutes } from './system-routes.js';

const jwtSecret = process.env.JWT_SECRET?.trim();
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET wajib diisi dengan minimal 32 karakter.');
}

const app = Fastify({
  logger: true,
  bodyLimit: 12 * 1024 * 1024,
  trustProxy: true,
});
const uploadDir = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
const backupDir = process.env.BACKUP_DIR ?? join(process.cwd(), 'backups');
const jwtExpiresIn = process.env.JWT_EXPIRES_IN?.trim() || '8h';
const allowedFiles = {
  'application/pdf': {
    extension: '.pdf',
    valid: (buffer) => buffer.subarray(0, 5).toString() === '%PDF-',
  },
  'image/jpeg': {
    extension: '.jpg',
    valid: (buffer) => buffer.length >= 3
      && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  'image/png': {
    extension: '.png',
    valid: (buffer) =>
      buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
};

async function removeNewFiles(files) {
  await Promise.allSettled(
    files.map((file) => unlink(join(uploadDir, file.storedName))),
  );
}

await app.register(cors, {
  origin: (process.env.CORS_ORIGIN ?? 'http://localhost:85')
    .split(',')
    .map((origin) => origin.trim()),
});
await app.register(sensible);
await app.register(jwt, { secret: jwtSecret });
await app.register(rateLimit, {
  global: false,
  errorResponseBuilder: (_request, context) => ({
    statusCode: 429,
    code: 'RATE_LIMITED',
    message: `Terlalu banyak percobaan. Coba kembali dalam ${context.after}.`,
  }),
});
await app.register(multipart, {
  limits: { files: 5, fileSize: 5 * 1024 * 1024 },
});

const publicAuthLimits = {
  register: { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
  verify: { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
  resend: { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } } },
  login: { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
  resetRequest: { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
  resetConfirm: { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
};

app.decorate('authenticate', async (request, reply) => {
  await request.jwtVerify();
  const tokenSessionVersion = request.user.sessionVersion;
  const { rows } = await pool.query(
    `SELECT * FROM users
     WHERE id=$1 AND is_active=TRUE AND deleted_at IS NULL`,
    [request.user.id],
  );
  if (!rows[0]) throw app.httpErrors.unauthorized('Sesi tidak lagi aktif.');
  if (tokenSessionVersion !== rows[0].session_version) {
    throw app.httpErrors.unauthorized('Sesi sudah diperbarui. Silakan login kembali.');
  }
  request.user = await buildSessionUser(rows[0]);
});

function allow(...roles) {
  return async (request, reply) => {
    await app.authenticate(request, reply);
    if (request.user.role !== 'SUPER_ADMIN' && !roles.includes(request.user.role)) {
      return reply.forbidden('Anda tidak mempunyai hak akses untuk tindakan ini.');
    }
  };
}

function allowPage(pageCode, ...roles) {
  return async (request, reply) => {
    await app.authenticate(request, reply);
    if (!request.user.pagePermissions.includes(pageCode)) {
      return reply.forbidden('Akses halaman ini tidak diberikan kepada akun Anda.');
    }
    if (roles.length && request.user.role !== 'SUPER_ADMIN'
      && !roles.includes(request.user.role)) {
      return reply.forbidden('Role Anda tidak berwenang menjalankan tindakan ini.');
    }
  };
}

const cleanUser = (user) => ({
  id: user.id,
  nik: user.nik,
  name: user.name,
  email: user.email,
  role: user.role,
  employeeNumber: user.employee_number,
  position: user.position,
  phone: user.phone,
  address: user.address,
  isActive: user.is_active,
  sessionVersion: user.session_version,
  emailVerifiedAt: user.email_verified_at,
  lastLoginAt: user.last_login_at,
});

async function getPagePermissions(user, client = pool) {
  if (user.role === 'SUPER_ADMIN') {
    const { rows } = await client.query(
      'SELECT code FROM page_definitions ORDER BY sort_order,code',
    );
    return rows.map((item) => item.code);
  }
  const { rows } = await client.query(
    `SELECT p.code
     FROM page_definitions p
     LEFT JOIN role_page_permissions rp
       ON rp.page_code=p.code AND rp.role=$2
     LEFT JOIN user_page_permissions up
       ON up.page_code=p.code AND up.user_id=$1
     WHERE COALESCE(up.allowed,rp.allowed,FALSE)=TRUE
     ORDER BY p.sort_order,p.code`,
    [user.id, user.role],
  );
  return rows.map((item) => item.code);
}

async function buildSessionUser(user, client = pool) {
  return {
    ...cleanUser(user),
    pagePermissions: await getPagePermissions(user, client),
  };
}

async function addAudit(client, actorId, action, entityType, entityId, details = null) {
  await client.query(
    `INSERT INTO audit_logs
      (actor_id,action,entity_type,entity_id,details)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [
      actorId ?? null,
      action,
      entityType,
      entityId === undefined || entityId === null ? null : String(entityId),
      details ? JSON.stringify(details) : null,
    ],
  );
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const createToken = () => randomBytes(32).toString('hex');

const applicationSelect = `
  SELECT a.*, u.name AS applicant_name, u.email AS applicant_email,
    COALESCE(
      json_agg(DISTINCT jsonb_build_object(
        'id', d.id, 'type', d.type, 'name', d.original_name,
        'mimeType', d.mime_type, 'size', d.size_bytes
      )) FILTER (WHERE d.id IS NOT NULL), '[]'
    ) AS documents
  FROM applications a
  JOIN users u ON u.id = a.applicant_id
  LEFT JOIN documents d ON d.application_id = a.id
`;

async function getApplication(id, user) {
  const params = [id];
  let where = 'WHERE a.id = $1 AND a.deleted_at IS NULL';
  if (user.role === 'WARGA') {
    params.push(user.id);
    where += ' AND a.applicant_id = $2';
  }
  const { rows } = await pool.query(
    `${applicationSelect} ${where} GROUP BY a.id, u.id`,
    params,
  );
  return rows[0];
}

async function addHistory(client, applicationId, actorId, action, from, to, note) {
  await client.query(
    `INSERT INTO action_history
      (application_id, actor_id, action, from_status, to_status, note)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [applicationId, actorId, action, from, to, note || null],
  );
}

function normalizeApplicationFields(fields, user) {
  const data = {
    nik: String(fields.nik ?? '').trim(),
    fullName: String(fields.fullName ?? '').trim(),
    birthPlace: String(fields.birthPlace ?? '').trim(),
    birthDate: String(fields.birthDate ?? '').trim(),
    originAddress: String(fields.originAddress ?? '').trim(),
    domicileAddress: String(fields.domicileAddress ?? '').trim(),
    neighborhood: String(fields.neighborhood ?? '').trim(),
    village: String(fields.village ?? '').trim(),
    district: String(fields.district ?? '').trim(),
    stayDuration: String(fields.stayDuration ?? '').trim(),
    purpose: String(fields.purpose ?? '').trim(),
  };
  if (!/^\d{16}$/.test(data.nik)) {
    throw app.httpErrors.badRequest('NIK harus terdiri dari tepat 16 digit.');
  }
  if (data.nik !== user.nik || data.fullName !== user.name) {
    throw app.httpErrors.badRequest('NIK dan nama pemohon harus sama dengan akun warga.');
  }
  if (data.birthPlace.length < 2 || data.birthPlace.length > 80) {
    throw app.httpErrors.badRequest('Tempat lahir harus terdiri dari 2 sampai 80 karakter.');
  }
  const birthDate = new Date(`${data.birthDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.birthDate)
    || Number.isNaN(birthDate.getTime())
    || birthDate.toISOString().slice(0, 10) !== data.birthDate
    || data.birthDate > new Date().toISOString().slice(0, 10)) {
    throw app.httpErrors.badRequest('Tanggal lahir tidak valid.');
  }
  if (data.originAddress.length < 10 || data.domicileAddress.length < 10) {
    throw app.httpErrors.badRequest('Alamat asal dan alamat domisili minimal 10 karakter.');
  }
  if (data.neighborhood.length > 20) {
    throw app.httpErrors.badRequest('RT/RW maksimal 20 karakter.');
  }
  if (data.village !== 'Belian' || data.district !== 'Batam Kota') {
    throw app.httpErrors.badRequest(
      'Layanan ini hanya untuk wilayah Kelurahan Belian, Kecamatan Batam Kota.',
    );
  }
  if (data.stayDuration.length < 2 || data.stayDuration.length > 80) {
    throw app.httpErrors.badRequest('Lama tinggal harus terdiri dari 2 sampai 80 karakter.');
  }
  if (data.purpose.length < 5) {
    throw app.httpErrors.badRequest('Tujuan pembuatan surat minimal 5 karakter.');
  }
  return data;
}

app.get('/api/health', async () => {
  const { rows } = await pool.query('SELECT NOW() AS database_time');
  return { status: 'ok', service: 'SuratApp Batam API', databaseTime: rows[0].database_time };
});

app.post('/api/auth/register', publicAuthLimits.register, async (request, reply) => {
  const {
    nik, name, email, password, phone, address, acceptedTerms,
  } = request.body ?? {};
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const normalizedName = String(name ?? '').trim();
  const normalizedPhone = String(phone ?? '').trim();
  const normalizedAddress = String(address ?? '').trim();
  if (!/^\d{16}$/.test(nik ?? '')) {
    return reply.badRequest('NIK harus terdiri dari tepat 16 digit.');
  }
  if (normalizedName.length < 3) {
    return reply.badRequest('Nama lengkap minimal 3 karakter.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return reply.badRequest('Format alamat email tidak valid.');
  }
  if (!/^(\+62|62|0)8\d{8,12}$/.test(normalizedPhone)) {
    return reply.badRequest('Nomor telepon Indonesia tidak valid.');
  }
  if (normalizedAddress.length < 10) {
    return reply.badRequest('Alamat lengkap minimal 10 karakter.');
  }
  if (acceptedTerms !== true) {
    return reply.badRequest('Pernyataan kebenaran data wajib disetujui.');
  }
  if (!password || password.length < 8 || !/[A-Z]/.test(password)
    || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return reply.badRequest(
      'Password minimal 8 karakter dan harus memuat huruf besar, huruf kecil, serta angka.',
    );
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const activationToken = createToken();
  const client = await pool.connect();
  let registeredUser;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users
       (nik,name,email,password_hash,role,phone,address,terms_accepted_at)
       VALUES ($1,$2,$3,$4,'WARGA',$5,$6,NOW()) RETURNING *`,
      [
        nik, normalizedName, normalizedEmail, passwordHash,
        normalizedPhone, normalizedAddress,
      ],
    );
    registeredUser = rows[0];
    await client.query(
      `UPDATE users SET created_by=id,updated_by=id WHERE id=$1`,
      [registeredUser.id],
    );
    await client.query(
      `INSERT INTO email_verification_tokens
        (user_id,token_hash,expires_at)
       VALUES ($1,$2,NOW()+INTERVAL '24 hours')`,
      [registeredUser.id, hashToken(activationToken)],
    );
    await addAudit(
      client,
      registeredUser.id,
      'REGISTER',
      'USER',
      registeredUser.id,
      { email: registeredUser.email },
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return reply.conflict('NIK atau email sudah terdaftar.');
    throw error;
  } finally {
    client.release();
  }
  try {
    const delivery = await sendActivationMessage(pool, registeredUser, activationToken);
    return reply.code(201).send({
      message: 'Akun dibuat. Buka email Anda untuk mengaktifkan akun sebelum login.',
      email: registeredUser.email,
      ...(delivery.testToken ? { testVerificationToken: delivery.testToken } : {}),
    });
  } catch (error) {
    request.log.error(error);
    return reply.serviceUnavailable(
      'Akun tersimpan, tetapi email aktivasi belum dapat dikirim. Gunakan kirim ulang aktivasi.',
    );
  }
});

app.post('/api/auth/verify-email', publicAuthLimits.verify, async (request, reply) => {
  const token = String(request.body?.token ?? '').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return reply.badRequest('Token aktivasi tidak valid.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT t.*,u.email_verified_at
       FROM email_verification_tokens t
       JOIN users u ON u.id=t.user_id
       WHERE t.token_hash=$1 AND t.used_at IS NULL
         AND t.expires_at>NOW() AND u.deleted_at IS NULL
       FOR UPDATE OF t`,
      [hashToken(token)],
    );
    const verification = rows[0];
    if (!verification) {
      throw app.httpErrors.badRequest('Token aktivasi tidak ditemukan atau sudah kedaluwarsa.');
    }
    await client.query(
      'UPDATE email_verification_tokens SET used_at=NOW() WHERE id=$1',
      [verification.id],
    );
    await client.query(
      `UPDATE users SET email_verified_at=COALESCE(email_verified_at,NOW()),
        updated_at=NOW() WHERE id=$1`,
      [verification.user_id],
    );
    await addAudit(
      client,
      verification.user_id,
      'VERIFY_EMAIL',
      'USER',
      verification.user_id,
    );
    await client.query('COMMIT');
    return { message: 'Email berhasil diverifikasi. Akun sekarang aktif dan dapat digunakan.' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/auth/resend-activation', publicAuthLimits.resend, async (request, reply) => {
  const email = String(request.body?.email ?? '').trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT * FROM users
     WHERE email=$1 AND email_verified_at IS NULL AND deleted_at IS NULL`,
    [email],
  );
  const user = rows[0];
  if (!user) {
    return {
      message: 'Jika akun belum aktif ditemukan, email aktivasi baru akan dikirim.',
    };
  }
  const token = createToken();
  await pool.query(
    `INSERT INTO email_verification_tokens
      (user_id,token_hash,expires_at)
     VALUES ($1,$2,NOW()+INTERVAL '24 hours')`,
    [user.id, hashToken(token)],
  );
  try {
    const delivery = await sendActivationMessage(pool, user, token);
    return {
      message: 'Email aktivasi baru telah dikirim.',
      ...(delivery.testToken ? { testVerificationToken: delivery.testToken } : {}),
    };
  } catch (error) {
    request.log.error(error);
    return reply.serviceUnavailable('Email aktivasi belum dapat dikirim.');
  }
});

app.post('/api/auth/login', publicAuthLimits.login, async (request, reply) => {
  const { email, password } = request.body ?? {};
  const { rows } = await pool.query(
    `SELECT * FROM users
     WHERE email=LOWER($1) AND is_active=TRUE AND deleted_at IS NULL`,
    [String(email ?? '').trim()],
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password ?? '', user.password_hash))) {
    return reply.unauthorized('Email atau password salah.');
  }
  if (!user.email_verified_at) {
    return reply.code(403).send({
      statusCode: 403,
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Email belum diverifikasi. Buka email aktivasi atau kirim ulang tautan.',
    });
  }
  const { rows: updated } = await pool.query(
    `UPDATE users SET last_login_at=NOW(), updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [user.id],
  );
  const safeUser = await buildSessionUser(updated[0]);
  const token = await reply.jwtSign(safeUser, { expiresIn: jwtExpiresIn });
  return { token, user: safeUser };
});

app.post(
  '/api/auth/password-reset/request',
  publicAuthLimits.resetRequest,
  async (request, reply) => {
  const channel = String(request.body?.channel ?? 'EMAIL').trim().toUpperCase();
  const identifier = String(request.body?.identifier ?? '').trim().toLowerCase();
  if (!['EMAIL', 'WHATSAPP'].includes(channel)) {
    return reply.badRequest('Pilih reset melalui email atau WhatsApp.');
  }
  const { rows } = await pool.query(
    `SELECT * FROM users
     WHERE deleted_at IS NULL AND is_active=TRUE
       AND (
         ($2='EMAIL' AND email=LOWER($1))
         OR ($2='WHATSAPP' AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g')
           =regexp_replace($1,'[^0-9]','','g'))
       )`,
    [identifier, channel],
  );
  const user = rows[0];
  if (!user) {
    return {
      message: 'Jika akun ditemukan, petunjuk reset password akan dikirim.',
    };
  }
  const resetToken = createToken();
  await pool.query(
    `INSERT INTO password_reset_tokens
      (user_id,channel,token_hash,expires_at)
     VALUES ($1,$2,$3,NOW()+INTERVAL '30 minutes')`,
    [user.id, channel, hashToken(resetToken)],
  );
  try {
    const delivery = await sendPasswordResetMessage(pool, user, resetToken, channel);
    return {
      message: `Petunjuk reset password telah dikirim melalui ${
        channel === 'EMAIL' ? 'email' : 'WhatsApp'
      }.`,
      ...(delivery.testToken ? { testResetToken: delivery.testToken } : {}),
    };
  } catch (error) {
    request.log.error(error);
    return reply.serviceUnavailable(
      channel === 'EMAIL'
        ? 'Layanan email reset belum tersedia.'
        : 'Layanan WhatsApp belum tersedia. Gunakan pilihan email.',
    );
  }
  },
);

app.post(
  '/api/auth/password-reset/confirm',
  publicAuthLimits.resetConfirm,
  async (request, reply) => {
  const token = String(request.body?.token ?? '').trim();
  const newPassword = String(request.body?.newPassword ?? '');
  if (!/^[a-f0-9]{64}$/.test(token)) return reply.badRequest('Token reset tidak valid.');
  if (newPassword.length < 8 || !/[A-Z]/.test(newPassword)
    || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return reply.badRequest(
      'Password baru minimal 8 karakter dan harus memuat huruf besar, huruf kecil, serta angka.',
    );
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW()
       FOR UPDATE`,
      [hashToken(token)],
    );
    const reset = rows[0];
    if (!reset) {
      throw app.httpErrors.badRequest('Token reset tidak ditemukan atau sudah kedaluwarsa.');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await client.query(
      `UPDATE users SET password_hash=$1,password_changed_at=NOW(),
        session_version=session_version+1,updated_at=NOW(),updated_by=id
       WHERE id=$2 AND deleted_at IS NULL`,
      [passwordHash, reset.user_id],
    );
    await client.query(
      'UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1',
      [reset.id],
    );
    await addAudit(client, reset.user_id, 'RESET_PASSWORD', 'USER', reset.user_id);
    await client.query('COMMIT');
    return { message: 'Password berhasil direset. Silakan login dengan password baru.' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  },
);

app.get('/api/auth/me', { preHandler: app.authenticate }, async (request) => {
  return { user: request.user };
});

app.post('/api/auth/logout', { preHandler: app.authenticate }, async (request) => {
  await pool.query(
    `UPDATE users SET session_version=session_version+1,
      updated_by=$1,updated_at=NOW() WHERE id=$1`,
    [request.user.id],
  );
  await addAudit(pool, request.user.id, 'LOGOUT', 'USER', request.user.id);
  return { message: 'Sesi berhasil diakhiri.' };
});

app.patch('/api/profile', { preHandler: app.authenticate }, async (request, reply) => {
  const { name, phone, address } = request.body ?? {};
  const normalizedName = String(name ?? '').trim();
  const normalizedPhone = String(phone ?? '').trim();
  const normalizedAddress = String(address ?? '').trim();
  if (normalizedName.length < 3) return reply.badRequest('Nama lengkap minimal 3 karakter.');
  if (!/^(\+62|62|0)8\d{8,12}$/.test(normalizedPhone)) {
    return reply.badRequest('Nomor telepon Indonesia tidak valid.');
  }
  if (normalizedAddress.length < 10) return reply.badRequest('Alamat minimal 10 karakter.');
  if (request.user.role === 'WARGA' && normalizedName !== request.user.name) {
    return reply.badRequest(
      'Nama identitas warga tidak dapat diubah dari profil. Hubungi petugas jika ada koreksi.',
    );
  }
  const { rows } = await pool.query(
    `UPDATE users SET name=$1,phone=$2,address=$3,updated_by=$4,updated_at=NOW()
     WHERE id=$4 RETURNING *`,
    [normalizedName, normalizedPhone, normalizedAddress, request.user.id],
  );
  await addAudit(
    pool,
    request.user.id,
    'UPDATE_PROFILE',
    'USER',
    request.user.id,
  );
  return { user: await buildSessionUser(rows[0]) };
});

app.post('/api/auth/change-password', { preHandler: app.authenticate }, async (request, reply) => {
  const { currentPassword, newPassword } = request.body ?? {};
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [
    request.user.id,
  ]);
  if (!(await bcrypt.compare(currentPassword ?? '', rows[0].password_hash))) {
    return reply.unauthorized('Password saat ini tidak sesuai.');
  }
  if (!newPassword || newPassword.length < 8 || !/[A-Z]/.test(newPassword)
    || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return reply.badRequest(
      'Password baru minimal 8 karakter dan harus memuat huruf besar, huruf kecil, serta angka.',
    );
  }
  if (currentPassword === newPassword) {
    return reply.badRequest('Password baru harus berbeda dari password saat ini.');
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    `UPDATE users SET password_hash=$1,password_changed_at=NOW(),
      session_version=session_version+1,updated_by=$2,updated_at=NOW()
     WHERE id=$2`,
    [passwordHash, request.user.id],
  );
  await addAudit(
    pool,
    request.user.id,
    'CHANGE_PASSWORD',
    'USER',
    request.user.id,
  );
  return { message: 'Password berhasil diperbarui.' };
});

app.get('/api/dashboard', { preHandler: allowPage('dashboard') }, async (request) => {
  const params = [];
  let where = 'WHERE deleted_at IS NULL';
  if (request.user.role === 'WARGA') {
    params.push(request.user.id);
    where += ' AND applicant_id = $1';
  }
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS count FROM applications ${where}
     GROUP BY status ORDER BY status`,
    params,
  );
  return {
    role: request.user.role,
    total: rows.reduce((sum, item) => sum + item.count, 0),
    statuses: rows,
  };
});

app.get('/api/applications', { preHandler: allowPage('applications') }, async (request) => {
  const params = [];
  let where = 'WHERE a.deleted_at IS NULL';
  if (request.user.role === 'WARGA') {
    params.push(request.user.id);
    where += ' AND a.applicant_id = $1';
  }
  const { rows } = await pool.query(
    `${applicationSelect} ${where}
     GROUP BY a.id, u.id ORDER BY a.updated_at DESC`,
    params,
  );
  return { applications: rows };
});

app.get('/api/applications/:id', {
  preHandler: allowPage('applications'),
}, async (request, reply) => {
  const application = await getApplication(request.params.id, request.user);
  if (!application) return reply.notFound('Pengajuan tidak ditemukan.');
  const { rows: history } = await pool.query(
    `SELECT h.*, u.name AS actor_name, u.role AS actor_role
     FROM action_history h LEFT JOIN users u ON u.id = h.actor_id
     WHERE h.application_id = $1 ORDER BY h.created_at`,
    [request.params.id],
  );
  return { application, history };
});

app.post('/api/applications', {
  preHandler: allowPage('new_application', 'WARGA'),
}, async (request, reply) => {
  const fields = {};
  const files = [];
  await mkdir(uploadDir, { recursive: true });

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const type = part.fieldname.toUpperCase();
      if (!['KTP', 'KK', 'PENDUKUNG'].includes(type)) continue;
      const fileRule = allowedFiles[part.mimetype];
      if (!fileRule) {
        return reply.badRequest('Dokumen hanya boleh PDF, JPG, atau PNG.');
      }
      const buffer = await part.toBuffer();
      if (!fileRule.valid(buffer)) {
        return reply.badRequest(`Isi berkas ${part.filename} tidak sesuai dengan formatnya.`);
      }
      const storedName =
        `${Date.now()}-${randomBytes(6).toString('hex')}${fileRule.extension}`;
      files.push({
        type,
        originalName: part.filename,
        storedName,
        mimeType: part.mimetype,
        size: buffer.length,
        buffer,
      });
    } else {
      fields[part.fieldname] = part.value;
    }
  }

  const applicationData = normalizeApplicationFields(fields, request.user);
  if (new Set(files.map((file) => file.type)).size !== files.length) {
    return reply.badRequest('Setiap jenis dokumen hanya boleh diunggah satu kali.');
  }
  const isDraft = fields.submissionMode === 'draft';
  if (!isDraft
    && (!files.some((file) => file.type === 'KTP') || !files.some((file) => file.type === 'KK'))) {
    return reply.badRequest('Dokumen KTP dan KK wajib diunggah.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const code = `DOM-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const { rows } = await client.query(
      `INSERT INTO applications
       (submission_code,applicant_id,nik,full_name,birth_place,birth_date,
        origin_address,domicile_address,neighborhood,village,district,
        stay_duration,purpose,status,submitted_at,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::varchar,
         CASE WHEN $14::text='DRAF' THEN NULL ELSE NOW() END,$15,$15)
       RETURNING *`,
      [
        code, request.user.id, applicationData.nik, applicationData.fullName,
        applicationData.birthPlace, applicationData.birthDate,
        applicationData.originAddress, applicationData.domicileAddress,
        applicationData.neighborhood || null, applicationData.village,
        applicationData.district, applicationData.stayDuration, applicationData.purpose,
        isDraft ? 'DRAF' : 'MENUNGGU_PEMERIKSAAN', request.user.id,
      ],
    );
    for (const file of files) {
      await writeFile(join(uploadDir, file.storedName), file.buffer);
      await client.query(
        `INSERT INTO documents
         (application_id,type,original_name,stored_name,mime_type,size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [rows[0].id, file.type, file.originalName, file.storedName, file.mimeType, file.size],
      );
    }
    await addHistory(client, rows[0].id, request.user.id,
      isDraft ? 'SIMPAN_DRAF' : 'AJUKAN',
      null, isDraft ? 'DRAF' : 'MENUNGGU_PEMERIKSAAN',
      isDraft ? 'Draf disimpan oleh warga.' : 'Pengajuan dikirim oleh warga.');
    await addAudit(
      client,
      request.user.id,
      isDraft ? 'CREATE_DRAFT' : 'CREATE_APPLICATION',
      'APPLICATION',
      rows[0].id,
    );
    await client.query('COMMIT');
    return reply.code(201).send({ application: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    await removeNewFiles(files);
    throw error;
  } finally {
    client.release();
  }
});

app.put('/api/applications/:id', {
  preHandler: allowPage('new_application', 'WARGA'),
}, async (request, reply) => {
  const fields = {};
  const files = [];
  const replacedFiles = [];
  await mkdir(uploadDir, { recursive: true });

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const type = part.fieldname.toUpperCase();
      if (!['KTP', 'KK', 'PENDUKUNG'].includes(type)) continue;
      const fileRule = allowedFiles[part.mimetype];
      if (!fileRule) {
        return reply.badRequest('Dokumen hanya boleh PDF, JPG, atau PNG.');
      }
      const buffer = await part.toBuffer();
      if (!fileRule.valid(buffer)) {
        return reply.badRequest(`Isi berkas ${part.filename} tidak sesuai dengan formatnya.`);
      }
      const storedName =
        `${Date.now()}-${randomBytes(6).toString('hex')}${fileRule.extension}`;
      files.push({
        type,
        originalName: part.filename,
        storedName,
        mimeType: part.mimetype,
        size: buffer.length,
        buffer,
      });
    } else {
      fields[part.fieldname] = part.value;
    }
  }

  const applicationData = normalizeApplicationFields(fields, request.user);
  if (new Set(files.map((file) => file.type)).size !== files.length) {
    return reply.badRequest('Setiap jenis dokumen hanya boleh diunggah satu kali.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM applications
       WHERE id=$1 AND applicant_id=$2 FOR UPDATE`,
      [request.params.id, request.user.id],
    );
    const current = rows[0];
    if (!current) throw app.httpErrors.notFound('Pengajuan tidak ditemukan.');
    if (!['DRAF', 'PERLU_DIPERBAIKI'].includes(current.status)) {
      throw app.httpErrors.conflict(
        'Pengajuan hanya dapat diedit saat berstatus Draf atau Perlu Diperbaiki.',
      );
    }

    const isDraft = fields.submissionMode === 'draft';
    const targetStatus = isDraft ? 'DRAF' : 'MENUNGGU_PEMERIKSAAN';
    const existingDocuments = await client.query(
      'SELECT type FROM documents WHERE application_id=$1',
      [current.id],
    );
    const availableTypes = new Set([
      ...existingDocuments.rows.map((item) => item.type),
      ...files.map((item) => item.type),
    ]);
    if (!isDraft && (!availableTypes.has('KTP') || !availableTypes.has('KK'))) {
      throw app.httpErrors.badRequest('Dokumen KTP dan KK wajib tersedia sebelum pengajuan dikirim.');
    }

    const { rows: updated } = await client.query(
      `UPDATE applications SET nik=$1, full_name=$2, birth_place=$3, birth_date=$4,
       origin_address=$5, domicile_address=$6, neighborhood=$7, village=$8,
       district=$9, stay_duration=$10, purpose=$11,
       status=$12::varchar,
       current_note=CASE WHEN $12::text='DRAF' THEN current_note ELSE NULL END,
       submitted_at=CASE WHEN $12::text='DRAF' THEN submitted_at ELSE NOW() END,
       updated_by=$14,updated_at=NOW()
       WHERE id=$13 RETURNING *`,
      [
        applicationData.nik, applicationData.fullName, applicationData.birthPlace,
        applicationData.birthDate, applicationData.originAddress,
        applicationData.domicileAddress, applicationData.neighborhood || null,
        applicationData.village, applicationData.district,
        applicationData.stayDuration, applicationData.purpose, targetStatus, current.id,
        request.user.id,
      ],
    );
    for (const file of files) {
      await writeFile(join(uploadDir, file.storedName), file.buffer);
      const removed = await client.query(
        `DELETE FROM documents WHERE application_id=$1 AND type=$2
         RETURNING stored_name`,
        [current.id, file.type],
      );
      replacedFiles.push(...removed.rows.map((item) => item.stored_name));
      await client.query(
        `INSERT INTO documents
         (application_id,type,original_name,stored_name,mime_type,size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [current.id, file.type, file.originalName, file.storedName, file.mimeType, file.size],
      );
    }
    const action = isDraft
      ? 'SIMPAN_DRAF'
      : current.status === 'DRAF' ? 'AJUKAN' : 'PERBAIKI_DAN_KIRIM_ULANG';
    const note = isDraft
      ? 'Perubahan draf disimpan oleh warga.'
      : current.status === 'DRAF'
        ? 'Pengajuan dikirim oleh warga.'
        : 'Data diperbaiki dan dikirim ulang oleh warga.';
    await addHistory(client, current.id, request.user.id, action, current.status, targetStatus, note);
    await addAudit(
      client,
      request.user.id,
      'UPDATE_APPLICATION',
      'APPLICATION',
      current.id,
      { fromStatus: current.status, toStatus: targetStatus },
    );
    await client.query('COMMIT');
    await Promise.allSettled(
      replacedFiles.map((storedName) => unlink(join(uploadDir, storedName))),
    );
    return { application: updated[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    await removeNewFiles(files);
    throw error;
  } finally {
    client.release();
  }
});

app.get('/api/documents/:id', {
  preHandler: allowPage('applications'),
}, async (request, reply) => {
  const params = [request.params.id];
  let ownerCheck = '';
  if (request.user.role === 'WARGA') {
    params.push(request.user.id);
    ownerCheck = 'AND a.applicant_id = $2';
  }
  const { rows } = await pool.query(
    `SELECT d.* FROM documents d JOIN applications a ON a.id = d.application_id
     WHERE d.id = $1 AND a.deleted_at IS NULL ${ownerCheck}`,
    params,
  );
  const document = rows[0];
  if (!document) return reply.notFound('Dokumen tidak ditemukan.');
  const data = await readFile(join(uploadDir, document.stored_name));
  reply.header('Content-Type', document.mime_type);
  reply.header(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(document.original_name)}`,
  );
  return reply.send(data);
});

const transitions = {
  PETUGAS: {
    REQUEST_REVISION: {
      from: ['MENUNGGU_PEMERIKSAAN'],
      to: 'PERLU_DIPERBAIKI',
      requireNote: true,
    },
    VERIFY: { from: ['MENUNGGU_PEMERIKSAAN'], to: 'DIVERIFIKASI' },
    SCHEDULE: { from: ['DISETUJUI'], to: 'SIAP_DIAMBIL' },
    COMPLETE: { from: ['SIAP_DIAMBIL'], to: 'SELESAI' },
  },
  KASI: {
    RETURN: { from: ['DIVERIFIKASI'], to: 'PERLU_DIPERBAIKI', requireNote: true },
    REJECT: { from: ['DIVERIFIKASI'], to: 'DITOLAK', requireNote: true },
    APPROVE: { from: ['DIVERIFIKASI'], to: 'MENUNGGU_PERSETUJUAN' },
  },
  LURAH: {
    REJECT: { from: ['MENUNGGU_PERSETUJUAN'], to: 'DITOLAK', requireNote: true },
    APPROVE: { from: ['MENUNGGU_PERSETUJUAN'], to: 'DISETUJUI' },
  },
  WARGA: {
    RESUBMIT: { from: ['PERLU_DIPERBAIKI'], to: 'MENUNGGU_PEMERIKSAAN' },
    CANCEL: {
      from: ['DRAF', 'MENUNGGU_PEMERIKSAAN', 'PERLU_DIPERBAIKI'],
      to: 'DIBATALKAN',
    },
  },
};

app.post('/api/applications/:id/actions', {
  preHandler: allowPage('applications'),
}, async (request, reply) => {
  const { action, note, pickupAt } = request.body ?? {};
  const rule = transitions[request.user.role]?.[action];
  if (!rule) return reply.forbidden('Tindakan tidak tersedia untuk role Anda.');
  const normalizedNote = String(note ?? '').trim();
  if (rule.requireNote && !normalizedNote) return reply.badRequest('Catatan wajib diisi.');
  if (normalizedNote.length > 2000) {
    return reply.badRequest('Catatan maksimal 2.000 karakter.');
  }
  let normalizedPickupAt = null;
  if (action === 'SCHEDULE') {
    const pickupDate = new Date(pickupAt);
    if (!pickupAt || Number.isNaN(pickupDate.getTime())) {
      return reply.badRequest('Jadwal pengambilan tidak valid.');
    }
    if (pickupDate.getTime() <= Date.now()) {
      return reply.badRequest('Jadwal pengambilan harus berada di waktu mendatang.');
    }
    normalizedPickupAt = pickupDate.toISOString();
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ownerSql = request.user.role === 'WARGA' ? ' AND applicant_id = $2' : '';
    const params = request.user.role === 'WARGA'
      ? [request.params.id, request.user.id]
      : [request.params.id];
    const { rows } = await client.query(
      `SELECT * FROM applications
       WHERE id=$1 AND deleted_at IS NULL${ownerSql} FOR UPDATE`,
      params,
    );
    const current = rows[0];
    if (!current) throw app.httpErrors.notFound('Pengajuan tidak ditemukan.');
    if (!rule.from.includes(current.status)) {
      throw app.httpErrors.conflict(`Tindakan tidak valid dari status ${current.status}.`);
    }
    let letterNumber = current.letter_number;
    let pickupCode = current.pickup_code;
    if (request.user.role === 'LURAH' && action === 'APPROVE') {
      const year = new Date().getFullYear();
      const sequence = await client.query(
        `INSERT INTO letter_sequences (year,last_number)
         VALUES ($1,1)
         ON CONFLICT (year) DO UPDATE
         SET last_number=letter_sequences.last_number+1
         RETURNING last_number`,
        [year],
      );
      letterNumber =
        `${String(sequence.rows[0].last_number).padStart(3, '0')}/DOM-KEL/BLN/${year}`;
    }
    if (action === 'SCHEDULE') pickupCode = randomBytes(3).toString('hex').toUpperCase();

    const { rows: updated } = await client.query(
      `UPDATE applications SET status=$1::varchar, current_note=$2, letter_number=$3,
         pickup_code=$4, pickup_at=COALESCE($5,pickup_at),
         approved_at=CASE WHEN $1::text='DISETUJUI' THEN NOW() ELSE approved_at END,
         completed_at=CASE WHEN $1::text='SELESAI' THEN NOW() ELSE completed_at END,
         updated_by=$7,updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [
        rule.to, normalizedNote || null, letterNumber, pickupCode,
        normalizedPickupAt, current.id, request.user.id,
      ],
    );
    await addHistory(
      client,
      current.id,
      request.user.id,
      action,
      current.status,
      rule.to,
      normalizedNote,
    );
    await addAudit(
      client,
      request.user.id,
      action,
      'APPLICATION',
      current.id,
      { fromStatus: current.status, toStatus: rule.to },
    );
    await client.query('COMMIT');
    return { application: updated[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.get('/api/users', {
  preHandler: allowPage('users', 'ADMIN'),
}, async () => {
  const { rows } = await pool.query(
    `SELECT u.id,u.nik,u.employee_number,u.name,u.email,u.role,u.position,
      u.phone,u.address,u.is_active,u.email_verified_at,u.last_login_at,
      u.created_by,u.updated_by,u.created_at,u.updated_at,
      cb.name AS created_by_name,ub.name AS updated_by_name
     FROM users u
     LEFT JOIN users cb ON cb.id=u.created_by
     LEFT JOIN users ub ON ub.id=u.updated_by
     WHERE u.deleted_at IS NULL
     ORDER BY u.role,u.name`,
  );
  return { users: rows };
});

app.post('/api/users', {
  preHandler: allowPage('users', 'ADMIN'),
}, async (request, reply) => {
  const { name, email, password, role, phone, employeeNumber, position } = request.body ?? {};
  const employeeRoles = ['PETUGAS', 'KASI', 'LURAH', 'ADMIN'];
  if (request.user.role === 'SUPER_ADMIN') employeeRoles.push('SUPER_ADMIN');
  const normalizedName = String(name ?? '').trim();
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  const normalizedPhone = String(phone ?? '').trim();
  const normalizedEmployeeNumber = String(employeeNumber ?? '').trim();
  const normalizedPosition = String(position ?? '').trim();
  if (normalizedName.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return reply.badRequest('Nama lengkap dan alamat email yang valid wajib diisi.');
  }
  if (!normalizedEmployeeNumber || !normalizedPosition) {
    return reply.badRequest('Nomor pegawai dan jabatan wajib diisi.');
  }
  if (normalizedPhone && !/^(\+62|62|0)8\d{8,12}$/.test(normalizedPhone)) {
    return reply.badRequest('Nomor telepon Indonesia tidak valid.');
  }
  if (!password || password.length < 8 || !/[A-Z]/.test(password)
    || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return reply.badRequest(
      'Password minimal 8 karakter dan harus memuat huruf besar, huruf kecil, serta angka.',
    );
  }
  if (!employeeRoles.includes(role)) {
    return reply.badRequest('Role pegawai tidak valid.');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users
       (employee_number,name,email,password_hash,role,position,phone,is_active,
        email_verified_at,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,NOW(),$8,$8)
       RETURNING *`,
      [
        normalizedEmployeeNumber, normalizedName, normalizedEmail, passwordHash,
        role, normalizedPosition, normalizedPhone || null, request.user.id,
      ],
    );
    await addAudit(
      pool,
      request.user.id,
      'CREATE_USER',
      'USER',
      rows[0].id,
      { role },
    );
    return reply.code(201).send({ user: cleanUser(rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return reply.conflict('Email atau nomor pegawai tersebut sudah terdaftar.');
    }
    throw error;
  }
});

app.patch('/api/users/:id', {
  preHandler: allowPage('users', 'ADMIN'),
}, async (request, reply) => {
  const { role, isActive } = request.body ?? {};
  if (typeof isActive !== 'boolean') {
    return reply.badRequest('Status aktif pengguna harus berupa nilai boolean.');
  }
  const { rows: targets } = await pool.query(
    'SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL',
    [
    request.params.id,
    ],
  );
  const target = targets[0];
  if (!target) return reply.notFound('Pengguna tidak ditemukan.');
  if (target.role === 'SUPER_ADMIN' && request.user.role !== 'SUPER_ADMIN') {
    return reply.forbidden('Administrator tidak dapat mengubah akun Super Admin.');
  }
  if (target.id === request.user.id && (!isActive || role !== target.role)) {
    return reply.badRequest('Anda tidak dapat menonaktifkan atau mengubah role akun sendiri.');
  }
  const allowedRoles = target.role === 'WARGA'
    ? ['WARGA']
    : ['PETUGAS', 'KASI', 'LURAH', 'ADMIN'];
  if (request.user.role === 'SUPER_ADMIN' && target.role !== 'WARGA') {
    allowedRoles.push('SUPER_ADMIN');
  }
  if (!allowedRoles.includes(role)) {
    return reply.badRequest('Role tidak valid.');
  }
  const { rows } = await pool.query(
    `UPDATE users SET role=$1::varchar,is_active=$2::boolean,
      session_version=session_version+
        CASE WHEN role<>$1::varchar OR is_active<>$2::boolean THEN 1 ELSE 0 END,
      updated_by=$4,updated_at=NOW() WHERE id=$3
     RETURNING *`,
    [role, Boolean(isActive), request.params.id, request.user.id],
  );
  await addAudit(
    pool,
    request.user.id,
    'UPDATE_USER_ACCESS',
    'USER',
    request.params.id,
    { role, isActive },
  );
  return { user: cleanUser(rows[0]) };
});

await registerSystemRoutes(app, {
  pool,
  allowPage,
  addAudit,
  cleanUser,
  initializeDatabase,
  backupDir,
});

app.setNotFoundHandler((request, reply) => {
  reply.code(404).send({
    statusCode: 404,
    code: 'NOT_FOUND',
    message: 'Halaman atau endpoint yang diminta tidak ditemukan.',
    path: request.url,
  });
});

app.setErrorHandler((error, request, reply) => {
  const status = error.statusCode ?? 500;
  if (status >= 500) request.log.error(error);
  else request.log.warn({ error, status }, error.message);
  reply.code(status).send({
    statusCode: status,
    message: status >= 500 ? 'Terjadi kesalahan pada server.' : error.message,
  });
});

const port = Number(process.env.PORT ?? 3000);
app.addHook('onClose', async () => {
  await pool.end();
});

const start = async () => {
  await mkdir(uploadDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      await initializeDatabase();
      break;
    } catch (error) {
      if (attempt === 15) throw error;
      app.log.warn(`Database belum siap (percobaan ${attempt}), mencoba lagi...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  await app.listen({ host: '0.0.0.0', port });
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'Menghentikan server dengan aman.');
    try {
      await app.close();
    } catch (error) {
      app.log.error(error);
      process.exitCode = 1;
    }
  });
}

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
