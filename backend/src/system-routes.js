import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const allowedRoles = ['WARGA', 'PETUGAS', 'KASI', 'LURAH', 'ADMIN', 'SUPER_ADMIN'];

const normalizeId = (value) => (/^\d+$/.test(String(value)) ? Number(value) : null);

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Prevent spreadsheet applications from evaluating imported user text as a formula.
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function toCsv(records) {
  if (!records.length) return '';
  const columns = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return [
    columns.map(csvCell).join(','),
    ...records.map((record) => columns.map((column) => csvCell(record[column])).join(',')),
  ].join('\r\n');
}

function validatePassword(password) {
  return typeof password === 'string'
    && password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password);
}

function isValidIsoDate(value, { allowFuture = true } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return allowFuture || value <= new Date().toISOString().slice(0, 10);
}

export async function registerSystemRoutes(app, {
  pool,
  allowPage,
  addAudit,
  cleanUser,
  initializeDatabase,
  backupDir,
}) {
  app.get('/api/site-settings/public', async () => {
    const { rows } = await pool.query(
      `SELECT company_name,logo_data,address,manager_name,contact_phone,
        contact_email,contact_whatsapp,updated_at
       FROM site_settings WHERE id=1`,
    );
    return {
      settings: rows[0],
      emailPreviewUrl: process.env.MAIL_PREVIEW_URL || null,
    };
  });

  app.get('/api/site-settings', {
    preHandler: allowPage('settings', 'ADMIN'),
  }, async () => {
    const { rows } = await pool.query(
      `SELECT s.*,cb.name AS created_by_name,ub.name AS updated_by_name
       FROM site_settings s
       LEFT JOIN users cb ON cb.id=s.created_by
       LEFT JOIN users ub ON ub.id=s.updated_by
       WHERE s.id=1`,
    );
    return { settings: rows[0] };
  });

  app.put('/api/site-settings', {
    preHandler: allowPage('settings', 'ADMIN'),
  }, async (request, reply) => {
    const {
      companyName,
      logoData,
      address,
      managerName,
      contactPhone,
      contactEmail,
      contactWhatsapp,
    } = request.body ?? {};
    const normalized = {
      companyName: String(companyName ?? '').trim(),
      logoData: logoData ? String(logoData) : null,
      address: String(address ?? '').trim(),
      managerName: String(managerName ?? '').trim(),
      contactPhone: String(contactPhone ?? '').trim(),
      contactEmail: String(contactEmail ?? '').trim().toLowerCase(),
      contactWhatsapp: String(contactWhatsapp ?? '').trim(),
    };
    if (normalized.companyName.length < 3 || normalized.companyName.length > 160) {
      return reply.badRequest('Nama instansi harus terdiri dari 3 sampai 160 karakter.');
    }
    if (normalized.address.length < 10 || normalized.managerName.length < 3) {
      return reply.badRequest('Alamat dan nama penanggung jawab wajib diisi.');
    }
    if (normalized.contactEmail
      && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.contactEmail)) {
      return reply.badRequest('Format email kontak tidak valid.');
    }
    if (normalized.logoData) {
      if (!/^data:image\/(png|jpeg|webp);base64,/i.test(normalized.logoData)) {
        return reply.badRequest('Logo hanya boleh PNG, JPG, atau WebP.');
      }
      if (Buffer.byteLength(normalized.logoData, 'utf8') > 1_500_000) {
        return reply.badRequest('Ukuran logo maksimal 1 MB.');
      }
    }
    const { rows } = await pool.query(
      `UPDATE site_settings SET company_name=$1,logo_data=$2,address=$3,
        manager_name=$4,contact_phone=$5,contact_email=$6,contact_whatsapp=$7,
        updated_by=$8,updated_at=NOW(),
        created_by=COALESCE(created_by,$8)
       WHERE id=1 RETURNING *`,
      [
        normalized.companyName,
        normalized.logoData,
        normalized.address,
        normalized.managerName,
        normalized.contactPhone || null,
        normalized.contactEmail || null,
        normalized.contactWhatsapp || null,
        request.user.id,
      ],
    );
    await addAudit(pool, request.user.id, 'UPDATE_SETTINGS', 'SITE_SETTINGS', 1);
    return { settings: rows[0] };
  });

  app.get('/api/access/pages', {
    preHandler: allowPage('permissions', 'SUPER_ADMIN'),
  }, async () => {
    const [{ rows: pages }, { rows: users }] = await Promise.all([
      pool.query(
        `SELECT code,label,description,sort_order
         FROM page_definitions ORDER BY sort_order,code`,
      ),
      pool.query(
        `SELECT id,name,email,role,is_active
         FROM users WHERE deleted_at IS NULL ORDER BY role,name`,
      ),
    ]);
    return { pages, users };
  });

  app.get('/api/access/users/:id', {
    preHandler: allowPage('permissions', 'SUPER_ADMIN'),
  }, async (request, reply) => {
    const id = normalizeId(request.params.id);
    if (!id) return reply.badRequest('ID pengguna tidak valid.');
    const { rows: users } = await pool.query(
      'SELECT id,name,email,role FROM users WHERE id=$1 AND deleted_at IS NULL',
      [id],
    );
    const user = users[0];
    if (!user) return reply.notFound('Pengguna tidak ditemukan.');
    const { rows } = await pool.query(
      `SELECT p.code,p.label,
        CASE WHEN $2='SUPER_ADMIN' THEN TRUE
          ELSE COALESCE(up.allowed,rp.allowed,FALSE) END AS allowed,
        up.allowed AS override_value
       FROM page_definitions p
       LEFT JOIN role_page_permissions rp
         ON rp.page_code=p.code AND rp.role=$2
       LEFT JOIN user_page_permissions up
         ON up.page_code=p.code AND up.user_id=$1
       ORDER BY p.sort_order,p.code`,
      [id, user.role],
    );
    return { user, permissions: rows };
  });

  app.put('/api/access/users/:id', {
    preHandler: allowPage('permissions', 'SUPER_ADMIN'),
  }, async (request, reply) => {
    const id = normalizeId(request.params.id);
    const permissions = request.body?.permissions;
    if (!id || !permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
      return reply.badRequest('Data permission tidak valid.');
    }
    const { rows: users } = await pool.query(
      'SELECT id,role FROM users WHERE id=$1 AND deleted_at IS NULL',
      [id],
    );
    const target = users[0];
    if (!target) return reply.notFound('Pengguna tidak ditemukan.');
    if (target.role === 'SUPER_ADMIN') {
      return reply.badRequest('Super Admin selalu mempunyai seluruh akses.');
    }
    const { rows: pages } = await pool.query('SELECT code FROM page_definitions');
    const validCodes = new Set(pages.map((page) => page.code));
    const entries = Object.entries(permissions);
    if (entries.some(([code, allowed]) =>
      !validCodes.has(code) || typeof allowed !== 'boolean')) {
      return reply.badRequest('Terdapat permission yang tidak dikenal.');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [code, allowed] of entries) {
        await client.query(
          `INSERT INTO user_page_permissions
            (user_id,page_code,allowed,updated_by,updated_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (user_id,page_code) DO UPDATE SET
             allowed=EXCLUDED.allowed,
             updated_by=EXCLUDED.updated_by,
             updated_at=NOW()`,
          [id, code, allowed, request.user.id],
        );
      }
      await client.query(
        'UPDATE users SET session_version=session_version+1,updated_by=$1,updated_at=NOW() WHERE id=$2',
        [request.user.id, id],
      );
      await addAudit(
        client,
        request.user.id,
        'UPDATE_PAGE_PERMISSIONS',
        'USER',
        id,
        { permissions },
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { message: 'Hak akses halaman berhasil disimpan. Sesi pengguna diperbarui.' };
  });

  app.get('/api/reports/applications', {
    preHandler: allowPage('reports'),
  }, async (request, reply) => {
    const period = String(request.query?.period ?? 'MONTHLY').toUpperCase();
    const periods = {
      DAILY: { trunc: 'day', interval: '13 days', label: '14 hari terakhir' },
      WEEKLY: { trunc: 'week', interval: '11 weeks', label: '12 minggu terakhir' },
      MONTHLY: { trunc: 'month', interval: '11 months', label: '12 bulan terakhir' },
      YEARLY: { trunc: 'year', interval: '4 years', label: '5 tahun terakhir' },
    };
    const selected = periods[period];
    if (!selected) return reply.badRequest('Periode laporan tidak valid.');
    const ownerSql = request.user.role === 'WARGA' ? ' AND applicant_id=$1' : '';
    const params = request.user.role === 'WARGA' ? [request.user.id] : [];
    const [{ rows: timeline }, { rows: statuses }] = await Promise.all([
      pool.query(
        `SELECT date_trunc('${selected.trunc}',created_at) AS bucket,
          COUNT(*)::int AS count
         FROM applications
         WHERE deleted_at IS NULL
           AND created_at>=date_trunc('${selected.trunc}',NOW())-INTERVAL '${selected.interval}'
           ${ownerSql}
         GROUP BY bucket ORDER BY bucket`,
        params,
      ),
      pool.query(
        `SELECT status,COUNT(*)::int AS count
         FROM applications
         WHERE deleted_at IS NULL
           AND created_at>=date_trunc('${selected.trunc}',NOW())-INTERVAL '${selected.interval}'
           ${ownerSql}
         GROUP BY status ORDER BY status`,
        params,
      ),
    ]);
    return {
      period,
      label: selected.label,
      timeline,
      statuses,
      total: statuses.reduce((sum, item) => sum + item.count, 0),
    };
  });

  app.get('/api/income/summary', {
    preHandler: allowPage('income', 'LURAH'),
  }, async () => {
    const { rows } = await pool.query(
      `SELECT
        COALESCE(SUM(amount) FILTER (WHERE entry_date=CURRENT_DATE),0)::numeric AS today,
        COALESCE(SUM(amount) FILTER (WHERE entry_date=CURRENT_DATE-1),0)::numeric AS yesterday,
        COALESCE(SUM(amount) FILTER (
          WHERE entry_date>=date_trunc('month',CURRENT_DATE)::date
        ),0)::numeric AS this_month,
        COALESCE(SUM(amount) FILTER (
          WHERE entry_date>=date_trunc('month',CURRENT_DATE-INTERVAL '1 month')::date
            AND entry_date<date_trunc('month',CURRENT_DATE)::date
        ),0)::numeric AS last_month
       FROM income_entries WHERE deleted_at IS NULL`,
    );
    return { summary: rows[0] };
  });

  app.get('/api/income', {
    preHandler: allowPage('income', 'LURAH'),
  }, async () => {
    const { rows } = await pool.query(
      `SELECT i.*,cb.name AS created_by_name,ub.name AS updated_by_name
       FROM income_entries i
       LEFT JOIN users cb ON cb.id=i.created_by
       LEFT JOIN users ub ON ub.id=i.updated_by
       WHERE i.deleted_at IS NULL
       ORDER BY i.entry_date DESC,i.id DESC LIMIT 500`,
    );
    return { entries: rows };
  });

  app.post('/api/income', {
    preHandler: allowPage('income', 'LURAH'),
  }, async (request, reply) => {
    const entryDate = String(request.body?.entryDate ?? '');
    const amount = Number(request.body?.amount);
    const description = String(request.body?.description ?? '').trim();
    if (!isValidIsoDate(entryDate)
      || !Number.isFinite(amount) || amount < 0 || description.length < 3) {
      return reply.badRequest('Tanggal, jumlah, dan keterangan pendapatan wajib valid.');
    }
    const { rows } = await pool.query(
      `INSERT INTO income_entries
        (entry_date,amount,description,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$4) RETURNING *`,
      [entryDate, amount, description, request.user.id],
    );
    await addAudit(pool, request.user.id, 'CREATE_INCOME', 'INCOME', rows[0].id);
    return reply.code(201).send({ entry: rows[0] });
  });

  app.patch('/api/income/:id', {
    preHandler: allowPage('income', 'LURAH'),
  }, async (request, reply) => {
    const id = normalizeId(request.params.id);
    const entryDate = String(request.body?.entryDate ?? '');
    const amount = Number(request.body?.amount);
    const description = String(request.body?.description ?? '').trim();
    if (!id || !isValidIsoDate(entryDate)
      || !Number.isFinite(amount) || amount < 0 || description.length < 3) {
      return reply.badRequest('Data pendapatan tidak valid.');
    }
    const { rows } = await pool.query(
      `UPDATE income_entries SET entry_date=$1,amount=$2,description=$3,
        updated_by=$4,updated_at=NOW()
       WHERE id=$5 AND deleted_at IS NULL RETURNING *`,
      [entryDate, amount, description, request.user.id, id],
    );
    if (!rows[0]) return reply.notFound('Data pendapatan tidak ditemukan.');
    await addAudit(pool, request.user.id, 'UPDATE_INCOME', 'INCOME', id);
    return { entry: rows[0] };
  });

  app.delete('/api/income/:id', {
    preHandler: allowPage('income', 'LURAH'),
  }, async (request, reply) => {
    const id = normalizeId(request.params.id);
    if (!id) return reply.badRequest('ID pendapatan tidak valid.');
    const { rows } = await pool.query(
      `UPDATE income_entries SET deleted_at=NOW(),deleted_by=$1,updated_at=NOW()
       WHERE id=$2 AND deleted_at IS NULL RETURNING id`,
      [request.user.id, id],
    );
    if (!rows[0]) return reply.notFound('Data pendapatan tidak ditemukan.');
    await addAudit(pool, request.user.id, 'DELETE_INCOME', 'INCOME', id);
    return { message: 'Data pendapatan dipindahkan ke Data Terhapus.' };
  });

  async function exportRecords(scope) {
    if (scope === 'users') {
      const { rows } = await pool.query(
        `SELECT nik,employee_number,name,email,role,position,phone,address,
          is_active,email_verified_at,created_at,updated_at
         FROM users WHERE deleted_at IS NULL ORDER BY id`,
      );
      return rows;
    }
    if (scope === 'applications') {
      const { rows } = await pool.query(
        `SELECT a.submission_code,u.email AS applicant_email,a.nik,a.full_name,
          a.birth_place,a.birth_date,a.origin_address,a.domicile_address,
          a.neighborhood,a.village,a.district,a.stay_duration,a.purpose,a.status,
          a.current_note,a.letter_number,a.pickup_code,a.pickup_at,a.submitted_at,
          a.approved_at,a.completed_at,a.created_at,a.updated_at
         FROM applications a JOIN users u ON u.id=a.applicant_id
         WHERE a.deleted_at IS NULL ORDER BY a.id`,
      );
      return rows;
    }
    const { rows } = await pool.query(
      `SELECT entry_date,amount,description,created_at,updated_at
       FROM income_entries WHERE deleted_at IS NULL ORDER BY id`,
    );
    return rows;
  }

  app.get('/api/data/export', {
    preHandler: allowPage('data_tools', 'ADMIN'),
  }, async (request, reply) => {
    const scope = String(request.query?.scope ?? 'users').toLowerCase();
    const format = String(request.query?.format ?? 'json').toLowerCase();
    if (!['users', 'applications', 'income'].includes(scope)
      || !['json', 'csv'].includes(format)) {
      return reply.badRequest('Scope atau format export tidak valid.');
    }
    const records = await exportRecords(scope);
    await addAudit(
      pool,
      request.user.id,
      'EXPORT_DATA',
      scope.toUpperCase(),
      null,
      { format, count: records.length },
    );
    const filename = `${scope}-${new Date().toISOString().slice(0, 10)}.${format}`;
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    if (format === 'csv') {
      reply.type('text/csv; charset=utf-8');
      return `\uFEFF${toCsv(records)}`;
    }
    reply.type('application/json; charset=utf-8');
    return JSON.stringify({ scope, exportedAt: new Date().toISOString(), records }, null, 2);
  });

  app.post('/api/data/import', {
    preHandler: allowPage('data_tools', 'ADMIN'),
  }, async (request, reply) => {
    const scope = String(request.body?.scope ?? '').toLowerCase();
    const records = request.body?.records;
    const temporaryPassword = String(request.body?.temporaryPassword ?? '');
    if (!['users', 'applications', 'income'].includes(scope)
      || !Array.isArray(records) || records.length > 2000) {
      return reply.badRequest('Berkas import tidak valid atau melebihi 2.000 baris.');
    }
    if (scope === 'users' && !validatePassword(temporaryPassword)) {
      return reply.badRequest(
        'Password sementara minimal 8 karakter dengan huruf besar, kecil, dan angka.',
      );
    }
    const client = await pool.connect();
    let imported = 0;
    let skipped = 0;
    try {
      await client.query('BEGIN');
      const passwordHash = scope === 'users'
        ? await bcrypt.hash(temporaryPassword, 10)
        : null;
      for (const item of records) {
        if (scope === 'users') {
          const role = String(item.role ?? '').toUpperCase();
          if (!allowedRoles.includes(role)
            || (role === 'SUPER_ADMIN' && request.user.role !== 'SUPER_ADMIN')) {
            skipped += 1;
            continue;
          }
          const email = String(item.email ?? '').trim().toLowerCase();
          const name = String(item.name ?? '').trim();
          const nik = item.nik ? String(item.nik) : null;
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            || name.length < 3 || (role === 'WARGA' && !/^\d{16}$/.test(nik ?? ''))) {
            skipped += 1;
            continue;
          }
          const result = await client.query(
            `INSERT INTO users
              (nik,employee_number,name,email,password_hash,role,position,phone,address,
               is_active,email_verified_at,created_by,updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,NOW(),$10,$10)
             ON CONFLICT DO NOTHING RETURNING id`,
            [
              nik,
              item.employee_number || null,
              name,
              email,
              passwordHash,
              role,
              item.position || null,
              item.phone || null,
              item.address || null,
              request.user.id,
            ],
          );
          if (result.rowCount) imported += 1;
          else skipped += 1;
        } else if (scope === 'applications') {
          const submissionCode = String(item.submission_code ?? '').trim();
          const birthPlace = String(item.birth_place ?? '').trim();
          const birthDate = String(item.birth_date ?? '').slice(0, 10);
          const originAddress = String(item.origin_address ?? '').trim();
          const domicileAddress = String(item.domicile_address ?? '').trim();
          const neighborhood = String(item.neighborhood ?? '').trim();
          const stayDuration = String(item.stay_duration ?? '').trim();
          const purpose = String(item.purpose ?? '').trim();
          if (submissionCode.length < 3 || submissionCode.length > 30
            || birthPlace.length < 2 || birthPlace.length > 80
            || !isValidIsoDate(birthDate, { allowFuture: false })
            || originAddress.length < 10 || domicileAddress.length < 10
            || neighborhood.length > 20
            || stayDuration.length < 2 || stayDuration.length > 80
            || purpose.length < 5) {
            skipped += 1;
            continue;
          }
          const applicant = await client.query(
            `SELECT id,nik,name FROM users
             WHERE email=LOWER($1) AND role='WARGA' AND deleted_at IS NULL`,
            [String(item.applicant_email ?? '')],
          );
          const owner = applicant.rows[0];
          if (!owner) {
            skipped += 1;
            continue;
          }
          const result = await client.query(
            `INSERT INTO applications
              (submission_code,applicant_id,nik,full_name,birth_place,birth_date,
               origin_address,domicile_address,neighborhood,village,district,
               stay_duration,purpose,status,current_note,created_by,updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Belian','Batam Kota',$10,$11,
               'DRAF',$12,$13,$13)
             ON CONFLICT (submission_code) DO NOTHING RETURNING id`,
            [
              submissionCode,
              owner.id,
              owner.nik,
              owner.name,
              birthPlace,
              birthDate,
              originAddress,
              domicileAddress,
              neighborhood || null,
              stayDuration,
              purpose,
              'Hasil import; periksa kembali sebelum diajukan.',
              request.user.id,
            ],
          );
          if (result.rowCount) imported += 1;
          else skipped += 1;
        } else {
          const amount = Number(item.amount);
          const entryDate = String(item.entry_date ?? '');
          const description = String(item.description ?? '').trim();
          if (!Number.isFinite(amount) || amount < 0
            || !isValidIsoDate(entryDate) || description.length < 3) {
            skipped += 1;
            continue;
          }
          await client.query(
            `INSERT INTO income_entries
              (entry_date,amount,description,created_by,updated_by)
             VALUES ($1,$2,$3,$4,$4)`,
            [entryDate, amount, description, request.user.id],
          );
          imported += 1;
        }
      }
      await addAudit(
        client,
        request.user.id,
        'IMPORT_DATA',
        scope.toUpperCase(),
        null,
        { imported, skipped },
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { message: 'Import selesai.', imported, skipped };
  });

  app.get('/api/backups', {
    preHandler: allowPage('backups', 'ADMIN'),
  }, async () => {
    const { rows } = await pool.query(
      `SELECT b.*,u.name AS created_by_name
       FROM system_backups b LEFT JOIN users u ON u.id=b.created_by
       ORDER BY b.created_at DESC LIMIT 100`,
    );
    return { backups: rows };
  });

  app.post('/api/backups', {
    preHandler: allowPage('backups', 'ADMIN'),
  }, async (request, reply) => {
    await mkdir(backupDir, { recursive: true });
    const scopes = ['users', 'applications', 'income'];
    const data = {};
    for (const scope of scopes) data[scope] = await exportRecords(scope);
    const { rows: settings } = await pool.query('SELECT * FROM site_settings WHERE id=1');
    const { rows: permissions } = await pool.query(
      'SELECT * FROM user_page_permissions ORDER BY user_id,page_code',
    );
    const payload = JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      data,
      settings: settings[0],
      userPagePermissions: permissions,
    }, null, 2);
    const filename = `suratapp-backup-${new Date().toISOString().replaceAll(':', '-')}.json`;
    const checksum = createHash('sha256').update(payload).digest('hex');
    await writeFile(join(backupDir, filename), payload, { mode: 0o600 });
    const { rows } = await pool.query(
      `INSERT INTO system_backups
        (filename,checksum_sha256,size_bytes,created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [filename, checksum, Buffer.byteLength(payload), request.user.id],
    );
    await addAudit(pool, request.user.id, 'CREATE_BACKUP', 'BACKUP', rows[0].id);
    return reply.code(201).send({ backup: rows[0] });
  });

  app.get('/api/backups/:id/download', {
    preHandler: allowPage('backups', 'ADMIN'),
  }, async (request, reply) => {
    const id = normalizeId(request.params.id);
    if (!id) return reply.badRequest('ID backup tidak valid.');
    const { rows } = await pool.query('SELECT * FROM system_backups WHERE id=$1', [id]);
    const backup = rows[0];
    if (!backup || !/^[a-zA-Z0-9._-]+$/.test(backup.filename)) {
      return reply.notFound('Backup tidak ditemukan.');
    }
    let data;
    try {
      data = await readFile(join(backupDir, backup.filename));
    } catch {
      return reply.notFound('File backup tidak ditemukan pada volume.');
    }
    const checksum = createHash('sha256').update(data).digest('hex');
    if (checksum !== backup.checksum_sha256) {
      return reply.internalServerError('Checksum backup tidak sesuai.');
    }
    reply.type('application/json');
    reply.header('Content-Disposition', `attachment; filename="${backup.filename}"`);
    return data;
  });

  app.post('/api/system/database/recover-connection', {
    preHandler: allowPage('backups', 'ADMIN'),
  }, async (request) => {
    await initializeDatabase();
    const { rows } = await pool.query(
      'SELECT current_database() AS database,NOW() AS checked_at',
    );
    await addAudit(
      pool,
      request.user.id,
      'RECOVER_DATABASE_CONNECTION',
      'DATABASE',
      rows[0].database,
    );
    return {
      message: 'Koneksi dan schema database berhasil diperiksa serta dimuat ulang.',
      ...rows[0],
    };
  });

  app.delete('/api/users/:id', {
    preHandler: allowPage('users', 'ADMIN'),
  }, async (request, reply) => {
    const id = normalizeId(request.params.id);
    if (!id) return reply.badRequest('ID pengguna tidak valid.');
    const { rows: targets } = await pool.query(
      'SELECT id,role FROM users WHERE id=$1 AND deleted_at IS NULL',
      [id],
    );
    const target = targets[0];
    if (!target) return reply.notFound('Pengguna tidak ditemukan.');
    if (id === request.user.id) return reply.badRequest('Akun sendiri tidak dapat dihapus.');
    if (['ADMIN', 'SUPER_ADMIN'].includes(target.role)
      && request.user.role !== 'SUPER_ADMIN') {
      return reply.forbidden('Hanya Super Admin dapat menghapus akun administrator.');
    }
    await pool.query(
      `UPDATE users SET deleted_at=NOW(),deleted_by=$1,is_active=FALSE,
        session_version=session_version+1,updated_at=NOW(),updated_by=$1
       WHERE id=$2`,
      [request.user.id, id],
    );
    await addAudit(pool, request.user.id, 'DELETE_USER', 'USER', id);
    return { message: 'Pengguna dipindahkan ke Data Terhapus.' };
  });

  app.delete('/api/applications/:id', {
    preHandler: allowPage('trash', 'SUPER_ADMIN'),
  }, async (request, reply) => {
    const id = normalizeId(request.params.id);
    if (!id) return reply.badRequest('ID pengajuan tidak valid.');
    const { rows } = await pool.query(
      `UPDATE applications SET deleted_at=NOW(),deleted_by=$1,
        updated_by=$1,updated_at=NOW()
       WHERE id=$2 AND deleted_at IS NULL RETURNING id`,
      [request.user.id, id],
    );
    if (!rows[0]) return reply.notFound('Pengajuan tidak ditemukan.');
    await addAudit(pool, request.user.id, 'DELETE_APPLICATION', 'APPLICATION', id);
    return { message: 'Pengajuan dipindahkan ke Data Terhapus.' };
  });

  app.get('/api/trash', {
    preHandler: allowPage('trash', 'SUPER_ADMIN'),
  }, async () => {
    const [{ rows: users }, { rows: applications }, { rows: income }] = await Promise.all([
      pool.query(
        `SELECT u.id,'USER' AS type,u.name AS title,u.email AS subtitle,
          u.deleted_at,d.name AS deleted_by_name
         FROM users u LEFT JOIN users d ON d.id=u.deleted_by
         WHERE u.deleted_at IS NOT NULL ORDER BY u.deleted_at DESC`,
      ),
      pool.query(
        `SELECT a.id,'APPLICATION' AS type,a.submission_code AS title,
          a.full_name AS subtitle,a.deleted_at,d.name AS deleted_by_name
         FROM applications a LEFT JOIN users d ON d.id=a.deleted_by
         WHERE a.deleted_at IS NOT NULL ORDER BY a.deleted_at DESC`,
      ),
      pool.query(
        `SELECT i.id,'INCOME' AS type,i.description AS title,
          i.amount::text AS subtitle,i.deleted_at,d.name AS deleted_by_name
         FROM income_entries i LEFT JOIN users d ON d.id=i.deleted_by
         WHERE i.deleted_at IS NOT NULL ORDER BY i.deleted_at DESC`,
      ),
    ]);
    return { records: [...users, ...applications, ...income] };
  });

  app.post('/api/trash/:type/:id/restore', {
    preHandler: allowPage('trash', 'SUPER_ADMIN'),
  }, async (request, reply) => {
    const id = normalizeId(request.params.id);
    const type = String(request.params.type ?? '').toUpperCase();
    const definitions = {
      USER: {
        table: 'users',
        extra: ',is_active=TRUE,session_version=session_version+1',
      },
      APPLICATION: { table: 'applications', extra: '' },
      INCOME: { table: 'income_entries', extra: '' },
    };
    const definition = definitions[type];
    if (!id || !definition) return reply.badRequest('Jenis atau ID data tidak valid.');
    const { rows } = await pool.query(
      `UPDATE ${definition.table}
       SET deleted_at=NULL,deleted_by=NULL,updated_at=NOW()${definition.extra}
       WHERE id=$1 AND deleted_at IS NOT NULL RETURNING id`,
      [id],
    );
    if (!rows[0]) return reply.notFound('Data terhapus tidak ditemukan.');
    await addAudit(pool, request.user.id, `RESTORE_${type}`, type, id);
    return { message: 'Data berhasil dipulihkan.' };
  });

  app.get('/api/audit-logs', {
    preHandler: allowPage('trash', 'SUPER_ADMIN'),
  }, async (request) => {
    const entityType = String(request.query?.entityType ?? '').toUpperCase();
    const entityId = String(request.query?.entityId ?? '');
    const params = [];
    const where = [];
    if (entityType) {
      params.push(entityType);
      where.push(`a.entity_type=$${params.length}`);
    }
    if (entityId) {
      params.push(entityId);
      where.push(`a.entity_id=$${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT a.*,u.name AS actor_name,u.role AS actor_role
       FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.created_at DESC LIMIT 500`,
      params,
    );
    return { logs: rows };
  });
}
