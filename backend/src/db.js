import pg from 'pg';

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL wajib diisi. Periksa konfigurasi environment backend.');
}

export const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 5000),
  idleTimeoutMillis: 30000,
});

pool.on('error', (error) => {
  console.error('Koneksi idle PostgreSQL mengalami error:', error.message);
});

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nik VARCHAR(16) UNIQUE,
  employee_number VARCHAR(40) UNIQUE,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL CHECK (
    role IN ('WARGA','PETUGAS','KASI','LURAH','ADMIN','SUPER_ADMIN')
  ),
  position VARCHAR(120),
  phone VARCHAR(24),
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_seeded BOOLEAN NOT NULL DEFAULT FALSE,
  terms_accepted_at TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  session_version INTEGER NOT NULL DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  submission_code VARCHAR(30) UNIQUE NOT NULL,
  applicant_id INTEGER NOT NULL REFERENCES users(id),
  nik VARCHAR(16) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  birth_place VARCHAR(80) NOT NULL,
  birth_date DATE NOT NULL,
  origin_address TEXT NOT NULL,
  domicile_address TEXT NOT NULL,
  neighborhood VARCHAR(20),
  village VARCHAR(80) NOT NULL DEFAULT 'Belian',
  district VARCHAR(80) NOT NULL DEFAULT 'Batam Kota',
  stay_duration VARCHAR(80) NOT NULL,
  purpose TEXT NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'DRAF',
  current_note TEXT,
  letter_number VARCHAR(100),
  pickup_code VARCHAR(20),
  pickup_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  is_seeded BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, type)
);

CREATE TABLE IF NOT EXISTS action_history (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  from_status VARCHAR(40),
  to_status VARCHAR(40) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS letter_sequences (
  year INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS page_definitions (
  code VARCHAR(50) PRIMARY KEY,
  label VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS role_page_permissions (
  role VARCHAR(30) NOT NULL,
  page_code VARCHAR(50) NOT NULL REFERENCES page_definitions(code) ON DELETE CASCADE,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (role,page_code)
);

CREATE TABLE IF NOT EXISTS user_page_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_code VARCHAR(50) NOT NULL REFERENCES page_definitions(code) ON DELETE CASCADE,
  allowed BOOLEAN NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id,page_code)
);

CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id=1),
  company_name VARCHAR(160) NOT NULL,
  logo_data TEXT,
  address TEXT NOT NULL,
  manager_name VARCHAR(160) NOT NULL,
  contact_phone VARCHAR(30),
  contact_email VARCHAR(160),
  contact_whatsapp VARCHAR(30),
  created_by INTEGER,
  updated_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL','WHATSAPP')),
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  channel VARCHAR(20) NOT NULL,
  recipient VARCHAR(180) NOT NULL,
  subject VARCHAR(200),
  status VARCHAR(20) NOT NULL CHECK (status IN ('SENT','FAILED')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS income_entries (
  id BIGSERIAL PRIMARY KEY,
  entry_date DATE NOT NULL,
  amount NUMERIC(16,2) NOT NULL CHECK (amount >= 0),
  description VARCHAR(240) NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_backups (
  id BIGSERIAL PRIMARY KEY,
  filename VARCHAR(240) UNIQUE NOT NULL,
  checksum_sha256 VARCHAR(64) NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80),
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_number VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_seeded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE applications ADD COLUMN IF NOT EXISTS is_seeded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS created_by INTEGER;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS updated_by INTEGER;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS deleted_by INTEGER;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='email_verified_at'
  ) THEN
    ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
    UPDATE users SET email_verified_at=COALESCE(created_at,NOW());
  END IF;
END
$do$;

DO $do$
BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('WARGA','PETUGAS','KASI','LURAH','ADMIN','SUPER_ADMIN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_nik_format_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_nik_format_check
      CHECK (nik IS NULL OR nik ~ '^[0-9]{16}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='applications_status_check') THEN
    ALTER TABLE applications ADD CONSTRAINT applications_status_check
      CHECK (status IN (
        'DRAF','MENUNGGU_PEMERIKSAAN','PERLU_DIPERBAIKI','DIVERIFIKASI',
        'MENUNGGU_PERSETUJUAN','DISETUJUI','SIAP_DIAMBIL','SELESAI',
        'DITOLAK','DIBATALKAN'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documents_type_check') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_type_check
      CHECK (type IN ('KTP','KK','PENDUKUNG'));
  END IF;
END
$do$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_number
  ON users(employee_number) WHERE employee_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_application_type
  ON documents(application_id, type);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_applicant ON applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_history_application ON action_history(application_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
CREATE INDEX IF NOT EXISTS idx_applications_deleted_at ON applications(deleted_at);
CREATE INDEX IF NOT EXISTS idx_income_entry_date ON income_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_income_deleted_at ON income_entries(deleted_at);
CREATE INDEX IF NOT EXISTS idx_verification_token_hash ON email_verification_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_reset_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);

INSERT INTO page_definitions (code,label,description,sort_order) VALUES
  ('dashboard','Dashboard','Ringkasan pekerjaan dan status pengajuan.',10),
  ('applications','Pengajuan','Daftar dan detail pengajuan surat.',20),
  ('new_application','Pengajuan Baru','Formulir pengajuan untuk warga.',30),
  ('users','Kelola Pengguna','Akun warga dan pegawai.',40),
  ('permissions','Hak Akses','Checklist akses halaman per pengguna.',50),
  ('settings','Pengaturan Website','Identitas instansi dan kontak.',60),
  ('reports','Laporan','Laporan harian, mingguan, bulanan, dan tahunan.',70),
  ('income','Pendapatan','Pencatatan serta perbandingan pendapatan.',80),
  ('data_tools','Export / Import','Export dan import pengguna serta data layanan.',90),
  ('backups','Cadangan Data','Cadangan logis serta pemeriksaan koneksi dan skema.',100),
  ('trash','Data Terhapus','Pemulihan data soft-delete.',110),
  ('flow','Alur Pelayanan','Informasi alur pelayanan.',120),
  ('profile','Profil','Profil dan keamanan akun.',130)
ON CONFLICT (code) DO UPDATE SET
  label=EXCLUDED.label,
  description=EXCLUDED.description,
  sort_order=EXCLUDED.sort_order;

INSERT INTO role_page_permissions (role,page_code,allowed)
SELECT role,page_code,TRUE FROM (VALUES
  ('WARGA','dashboard'),('WARGA','applications'),('WARGA','new_application'),
  ('WARGA','flow'),('WARGA','profile'),
  ('PETUGAS','dashboard'),('PETUGAS','applications'),('PETUGAS','reports'),
  ('PETUGAS','flow'),('PETUGAS','profile'),
  ('KASI','dashboard'),('KASI','applications'),('KASI','reports'),
  ('KASI','flow'),('KASI','profile'),
  ('LURAH','dashboard'),('LURAH','applications'),('LURAH','reports'),
  ('LURAH','income'),('LURAH','flow'),('LURAH','profile'),
  ('ADMIN','dashboard'),('ADMIN','applications'),('ADMIN','users'),
  ('ADMIN','settings'),('ADMIN','reports'),('ADMIN','data_tools'),
  ('ADMIN','backups'),('ADMIN','flow'),('ADMIN','profile')
) AS defaults(role,page_code)
ON CONFLICT (role,page_code) DO NOTHING;

INSERT INTO site_settings
  (id,company_name,address,manager_name,contact_phone,contact_email,contact_whatsapp)
VALUES (
  1,
  'Kelurahan Belian',
  'Kelurahan Belian, Kecamatan Batam Kota, Kota Batam, Kepulauan Riau',
  'Lurah Kelurahan Belian',
  '0778-000000',
  'pelayanan@suratbatam.local',
  '081200000000'
)
ON CONFLICT (id) DO NOTHING;
`;

export async function initializeDatabase() {
  await pool.query(schema);
}
