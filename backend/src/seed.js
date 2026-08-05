import bcrypt from 'bcryptjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool, initializeDatabase } from './db.js';

const uploadDir = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
const initialAccountPassword = process.env.INITIAL_ACCOUNT_PASSWORD?.trim();
const seedPassword = process.env.SEED_ACCOUNT_PASSWORD?.trim();

if (!initialAccountPassword || !seedPassword) {
  throw new Error(
    'INITIAL_ACCOUNT_PASSWORD dan SEED_ACCOUNT_PASSWORD wajib diisi sebelum menjalankan seed.',
  );
}

const initialUsers = [
  {
    legacyEmail: 'superadmin@surat.batam.go.id',
    nik: null,
    employeeNumber: 'SA-BLN-2026-001',
    name: 'Arif Wijaya',
    email: 'arif.wijaya@suratbatam.local',
    role: 'SUPER_ADMIN',
    position: 'Super Administrator Sistem',
    phone: '081298760451',
    address: 'Kota Batam, Kepulauan Riau',
  },
  {
    legacyEmail: 'warga@surat.batam.go.id',
    nik: '3271054807980002',
    employeeNumber: null,
    name: 'Nadia Putri Ramadhani',
    email: 'nadia.ramadhani@suratbatam.local',
    role: 'WARGA',
    position: null,
    phone: '081268314205',
    address: 'Perumahan Taman Raya, Kelurahan Belian, Kecamatan Batam Kota',
  },
  {
    legacyEmail: 'petugas@surat.batam.go.id',
    nik: null,
    employeeNumber: 'PGW-BLN-2021-014',
    name: 'Ratna Sari Dewi',
    email: 'ratna.dewi@suratbatam.local',
    role: 'PETUGAS',
    position: 'Petugas Pelayanan',
    phone: '081277540118',
    address: 'Kota Batam, Kepulauan Riau',
  },
  {
    legacyEmail: 'kasi@surat.batam.go.id',
    nik: null,
    employeeNumber: 'PGW-BLN-2018-006',
    name: 'Hendra Saputra',
    email: 'hendra.saputra@suratbatam.local',
    role: 'KASI',
    position: 'Kasi Pemerintahan',
    phone: '081376210945',
    address: 'Kota Batam, Kepulauan Riau',
  },
  {
    legacyEmail: 'lurah@surat.batam.go.id',
    nik: null,
    employeeNumber: 'PGW-BLN-2015-002',
    name: 'Fauzan Rahman',
    email: 'fauzan.rahman@suratbatam.local',
    role: 'LURAH',
    position: 'Lurah / Pejabat Penandatangan',
    phone: '081265493870',
    address: 'Kota Batam, Kepulauan Riau',
  },
  {
    legacyEmail: 'admin@surat.batam.go.id',
    nik: null,
    employeeNumber: 'ADM-BLN-2023-001',
    name: 'Dimas Pratama',
    email: 'dimas.pratama@suratbatam.local',
    role: 'ADMIN',
    position: 'Administrator Sistem',
    phone: '081290517364',
    address: 'Kota Batam, Kepulauan Riau',
  },
];

const citizens = [
  {
    nik: '3271055103900003',
    name: 'Rahma Oktaviani',
    email: 'rahma.oktaviani@suratbatam.local',
    phone: '081275410326',
    address: 'Perumahan Cendana Blok A2, Kelurahan Belian, Kecamatan Batam Kota',
  },
  {
    nik: '3271051202870004',
    name: 'Fikri Maulana',
    email: 'fikri.maulana@suratbatam.local',
    phone: '081365209714',
    address: 'Perumahan Taman Raya Tahap III, Kelurahan Belian, Kecamatan Batam Kota',
  },
  {
    nik: '3271056209950005',
    name: 'Salsabila Putri',
    email: 'salsabila.putri@suratbatam.local',
    phone: '082171460932',
    address: 'Perumahan Botania Garden Blok D, Kelurahan Belian, Kecamatan Batam Kota',
  },
  {
    nik: '3271050701880006',
    name: 'Muhammad Reza',
    email: 'muhammad.reza@suratbatam.local',
    phone: '081277394601',
    address: 'Perumahan Kurnia Djaja Alam, Kelurahan Belian, Kecamatan Batam Kota',
  },
  {
    nik: '3271054505930007',
    name: 'Intan Permata Sari',
    email: 'intan.permata@suratbatam.local',
    phone: '085264170983',
    address: 'Perumahan Bukit Palem Permai, Kelurahan Belian, Kecamatan Batam Kota',
  },
  {
    nik: '3271052309900008',
    name: 'Rio Kurniawan',
    email: 'rio.kurniawan@suratbatam.local',
    phone: '081374510268',
    address: 'Perumahan Taman Marchelia, Kelurahan Belian, Kecamatan Batam Kota',
  },
  {
    nik: '3271055807840009',
    name: 'Dewi Lestari',
    email: 'dewi.lestari@suratbatam.local',
    phone: '081268095417',
    address: 'Perumahan Taman Duta Mas, Kelurahan Belian, Kecamatan Batam Kota',
  },
  {
    nik: '3271051502810010',
    name: 'Yusuf Hidayat',
    email: 'yusuf.hidayat@suratbatam.local',
    phone: '082285730146',
    address: 'Perumahan Plamo Garden, Kelurahan Belian, Kecamatan Batam Kota',
  },
];

const applications = [
  {
    code: 'DOM-2026-0001',
    email: 'nadia.ramadhani@suratbatam.local',
    birthPlace: 'Batam',
    birthDate: '1998-07-08',
    origin: 'Tanjung Uma, Kecamatan Lubuk Baja, Kota Batam',
    domicile: 'Perumahan Taman Raya Blok C1 No. 12',
    neighborhood: '004 / 012',
    stay: '2 tahun 4 bulan',
    purpose: 'Persyaratan administrasi tempat kerja',
    status: 'MENUNGGU_PEMERIKSAAN',
    submittedAt: '2026-08-03T09:15:00+07:00',
  },
  {
    code: 'DOM-2026-0002',
    email: 'rahma.oktaviani@suratbatam.local',
    birthPlace: 'Tanjungpinang',
    birthDate: '1990-03-11',
    origin: 'Jalan DI Panjaitan, Kota Tanjungpinang',
    domicile: 'Perumahan Cendana Blok A2 No. 7',
    neighborhood: '003 / 006',
    stay: '1 tahun 8 bulan',
    purpose: 'Persyaratan pendaftaran sekolah anak',
    status: 'PERLU_DIPERBAIKI',
    note: 'Alamat pada formulir belum mencantumkan nomor rumah. Mohon dilengkapi.',
    submittedAt: '2026-08-02T10:40:00+07:00',
  },
  {
    code: 'DOM-2026-0003',
    email: 'fikri.maulana@suratbatam.local',
    birthPlace: 'Pekanbaru',
    birthDate: '1987-02-12',
    origin: 'Kecamatan Tampan, Kota Pekanbaru',
    domicile: 'Perumahan Taman Raya Tahap III Blok H5 No. 19',
    neighborhood: '006 / 018',
    stay: '3 tahun',
    purpose: 'Persyaratan administrasi perbankan',
    status: 'DIVERIFIKASI',
    submittedAt: '2026-08-01T08:30:00+07:00',
  },
  {
    code: 'DOM-2026-0004',
    email: 'salsabila.putri@suratbatam.local',
    birthPlace: 'Medan',
    birthDate: '1995-09-22',
    origin: 'Kecamatan Medan Johor, Kota Medan',
    domicile: 'Perumahan Botania Garden Blok D8 No. 5',
    neighborhood: '002 / 021',
    stay: '1 tahun 2 bulan',
    purpose: 'Persyaratan administrasi kependudukan',
    status: 'MENUNGGU_PERSETUJUAN',
    submittedAt: '2026-07-31T13:20:00+07:00',
  },
  {
    code: 'DOM-2026-0005',
    email: 'muhammad.reza@suratbatam.local',
    birthPlace: 'Padang',
    birthDate: '1988-01-07',
    origin: 'Kecamatan Kuranji, Kota Padang',
    domicile: 'Perumahan Kurnia Djaja Alam Blok B3 No. 9',
    neighborhood: '007 / 025',
    stay: '4 tahun',
    purpose: 'Persyaratan administrasi pekerjaan',
    status: 'DISETUJUI',
    letterNumber: '001/DOM-KEL/BLN/2026',
    submittedAt: '2026-07-29T09:10:00+07:00',
    approvedAt: '2026-07-31T14:25:00+07:00',
  },
  {
    code: 'DOM-2026-0006',
    email: 'intan.permata@suratbatam.local',
    birthPlace: 'Palembang',
    birthDate: '1993-05-05',
    origin: 'Kecamatan Ilir Barat I, Kota Palembang',
    domicile: 'Perumahan Bukit Palem Permai Blok F2 No. 16',
    neighborhood: '005 / 031',
    stay: '2 tahun',
    purpose: 'Persyaratan pendaftaran BPJS',
    status: 'SIAP_DIAMBIL',
    letterNumber: '002/DOM-KEL/BLN/2026',
    pickupCode: 'BLN826',
    pickupAt: '2026-08-06T09:00:00+07:00',
    submittedAt: '2026-07-27T11:35:00+07:00',
    approvedAt: '2026-07-30T10:15:00+07:00',
  },
  {
    code: 'DOM-2026-0007',
    email: 'rio.kurniawan@suratbatam.local',
    birthPlace: 'Dumai',
    birthDate: '1990-09-23',
    origin: 'Kecamatan Dumai Kota, Kota Dumai',
    domicile: 'Perumahan Taman Marchelia Blok C7 No. 3',
    neighborhood: '009 / 038',
    stay: '5 tahun',
    purpose: 'Persyaratan administrasi pendidikan',
    status: 'SELESAI',
    letterNumber: '003/DOM-KEL/BLN/2026',
    pickupCode: 'BLN731',
    pickupAt: '2026-07-29T10:00:00+07:00',
    submittedAt: '2026-07-23T08:45:00+07:00',
    approvedAt: '2026-07-27T13:30:00+07:00',
    completedAt: '2026-07-29T10:18:00+07:00',
  },
  {
    code: 'DOM-2026-0008',
    email: 'dewi.lestari@suratbatam.local',
    birthPlace: 'Jambi',
    birthDate: '1984-07-18',
    origin: 'Kecamatan Jelutung, Kota Jambi',
    domicile: 'Perumahan Taman Duta Mas Blok A6 No. 21',
    neighborhood: '011 / 042',
    stay: '8 bulan',
    purpose: 'Persyaratan administrasi usaha',
    status: 'DITOLAK',
    note: 'Alamat yang diajukan berada di luar wilayah administrasi Kelurahan Belian.',
    submittedAt: '2026-07-25T14:05:00+07:00',
  },
  {
    code: 'DOM-2026-0009',
    email: 'yusuf.hidayat@suratbatam.local',
    birthPlace: 'Bukittinggi',
    birthDate: '1981-02-15',
    origin: 'Kecamatan Guguk Panjang, Kota Bukittinggi',
    domicile: 'Perumahan Plamo Garden Blok E4 No. 10',
    neighborhood: '008 / 047',
    stay: '6 tahun',
    purpose: 'Persyaratan administrasi keluarga',
    status: 'DRAF',
    submittedAt: null,
  },
  {
    code: 'DOM-2026-0010',
    email: 'nadia.ramadhani@suratbatam.local',
    birthPlace: 'Batam',
    birthDate: '1998-07-08',
    origin: 'Tanjung Uma, Kecamatan Lubuk Baja, Kota Batam',
    domicile: 'Perumahan Taman Raya Blok C1 No. 12',
    neighborhood: '004 / 012',
    stay: '2 tahun 4 bulan',
    purpose: 'Persyaratan administrasi keanggotaan organisasi',
    status: 'DIBATALKAN',
    note: 'Pengajuan dibatalkan oleh pemohon karena dokumen tidak lagi diperlukan.',
    submittedAt: '2026-07-20T10:10:00+07:00',
  },
];

function escapePdf(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function buildPdf(title, lines) {
  const text = [
    'BT', '/F1 15 Tf', '50 790 Td', `(${escapePdf(title)}) Tj`,
    '/F1 10 Tf',
    ...lines.flatMap((line) => ['0 -24 Td', `(${escapePdf(line)}) Tj`]),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) =>
    `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function historyFor(application, ids) {
  const submitted = application.submittedAt ?? '2026-08-03T08:00:00+07:00';
  const eventTime = (hours) =>
    new Date(new Date(submitted).getTime() + hours * 60 * 60 * 1000).toISOString();
  const result = application.status === 'DRAF'
    ? [{
      actor: ids[application.email],
      action: 'SIMPAN_DRAF',
      from: null,
      to: 'DRAF',
      note: 'Draf disimpan oleh warga.',
      at: eventTime(0),
    }]
    : [{
      actor: ids[application.email],
      action: 'AJUKAN',
      from: null,
      to: 'MENUNGGU_PEMERIKSAAN',
      note: 'Pengajuan dikirim oleh warga.',
      at: submitted,
    }];
  if (application.status === 'PERLU_DIPERBAIKI') {
    result.push({
      actor: ids['ratna.dewi@suratbatam.local'],
      action: 'REQUEST_REVISION',
      from: 'MENUNGGU_PEMERIKSAAN',
      to: 'PERLU_DIPERBAIKI',
      note: application.note,
      at: eventTime(4),
    });
    return result;
  }
  if (application.status === 'DIBATALKAN') {
    result.push({
      actor: ids[application.email],
      action: 'CANCEL',
      from: 'MENUNGGU_PEMERIKSAAN',
      to: 'DIBATALKAN',
      note: application.note,
      at: eventTime(1),
    });
    return result;
  }
  const afterPetugas = [
    'DIVERIFIKASI', 'MENUNGGU_PERSETUJUAN', 'DISETUJUI',
    'SIAP_DIAMBIL', 'SELESAI', 'DITOLAK',
  ];
  if (afterPetugas.includes(application.status)) {
    result.push({
      actor: ids['ratna.dewi@suratbatam.local'],
      action: 'VERIFY',
      from: 'MENUNGGU_PEMERIKSAAN',
      to: 'DIVERIFIKASI',
      note: 'Formulir, KTP, dan KK telah diperiksa dan dinyatakan lengkap.',
      at: eventTime(4),
    });
  }
  if (application.status === 'DITOLAK') {
    result.push({
      actor: ids['hendra.saputra@suratbatam.local'],
      action: 'REJECT',
      from: 'DIVERIFIKASI',
      to: 'DITOLAK',
      note: application.note,
      at: eventTime(28),
    });
    return result;
  }
  const afterKasi = ['MENUNGGU_PERSETUJUAN', 'DISETUJUI', 'SIAP_DIAMBIL', 'SELESAI'];
  if (afterKasi.includes(application.status)) {
    result.push({
      actor: ids['hendra.saputra@suratbatam.local'],
      action: 'APPROVE',
      from: 'DIVERIFIKASI',
      to: 'MENUNGGU_PERSETUJUAN',
      note: 'Data kependudukan dan wilayah domisili telah sesuai.',
      at: eventTime(28),
    });
  }
  const afterLurah = ['DISETUJUI', 'SIAP_DIAMBIL', 'SELESAI'];
  if (afterLurah.includes(application.status)) {
    result.push({
      actor: ids['fauzan.rahman@suratbatam.local'],
      action: 'APPROVE',
      from: 'MENUNGGU_PERSETUJUAN',
      to: 'DISETUJUI',
      note: 'Surat disetujui untuk diterbitkan.',
      at: application.approvedAt ?? eventTime(52),
    });
  }
  const afterSchedule = ['SIAP_DIAMBIL', 'SELESAI'];
  if (afterSchedule.includes(application.status)) {
    result.push({
      actor: ids['ratna.dewi@suratbatam.local'],
      action: 'SCHEDULE',
      from: 'DISETUJUI',
      to: 'SIAP_DIAMBIL',
      note: 'Jadwal pengambilan surat telah ditentukan.',
      at: eventTime(76),
    });
  }
  if (application.status === 'SELESAI') {
    result.push({
      actor: ids['ratna.dewi@suratbatam.local'],
      action: 'COMPLETE',
      from: 'SIAP_DIAMBIL',
      to: 'SELESAI',
      note: 'Identitas dan kode pengambilan telah diperiksa; surat diserahkan.',
      at: application.completedAt ?? eventTime(100),
    });
  }
  return result;
}

async function seed() {
  await initializeDatabase();
  await mkdir(uploadDir, { recursive: true });
  const initialPasswordHash = await bcrypt.hash(initialAccountPassword, 10);
  const passwordHash = await bcrypt.hash(seedPassword, 10);

  for (const user of initialUsers) {
    await pool.query(
      `UPDATE users SET nik=$1,employee_number=$2,name=$3,email=$4,
       role=$5,position=$6,phone=$7,address=$8,is_seeded=TRUE,
       email_verified_at=COALESCE(email_verified_at,NOW()),updated_at=NOW()
       WHERE email=$9`,
      [
        user.nik, user.employeeNumber, user.name, user.email, user.role,
        user.position, user.phone, user.address, user.legacyEmail,
      ],
    );
    await pool.query(
      `INSERT INTO users
       (nik,employee_number,name,email,password_hash,role,position,phone,address,
        is_seeded,email_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,NOW())
       ON CONFLICT (email) DO NOTHING`,
      [
        user.nik, user.employeeNumber, user.name, user.email, initialPasswordHash,
        user.role, user.position, user.phone, user.address,
      ],
    );
  }

  for (const citizen of citizens) {
    await pool.query(
      `INSERT INTO users
       (nik,name,email,password_hash,role,phone,address,is_seeded,email_verified_at)
       VALUES ($1,$2,$3,$4,'WARGA',$5,$6,TRUE,NOW())
       ON CONFLICT (email) DO UPDATE SET
         nik=EXCLUDED.nik,name=EXCLUDED.name,phone=EXCLUDED.phone,
         address=EXCLUDED.address,is_seeded=TRUE,
         email_verified_at=COALESCE(users.email_verified_at,NOW()),updated_at=NOW()`,
      [
        citizen.nik, citizen.name, citizen.email, passwordHash,
        citizen.phone, citizen.address,
      ],
    );
  }

  const { rows: users } = await pool.query(
    'SELECT id,email,nik,name FROM users WHERE is_seeded=TRUE',
  );
  const ids = Object.fromEntries(users.map((user) => [user.email, user.id]));
  const people = Object.fromEntries(users.map((user) => [user.email, user]));
  await pool.query(
    `UPDATE users SET created_by=COALESCE(created_by,id),updated_by=COALESCE(updated_by,id)
     WHERE is_seeded=TRUE`,
  );

  for (const item of applications) {
    const person = people[item.email];
    const { rows } = await pool.query(
      `INSERT INTO applications
       (submission_code,applicant_id,nik,full_name,birth_place,birth_date,
        origin_address,domicile_address,neighborhood,village,district,
        stay_duration,purpose,status,current_note,letter_number,pickup_code,
        pickup_at,submitted_at,approved_at,completed_at,is_seeded,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Belian','Batam Kota',$10,$11,$12,
        $13,$14,$15,$16,$17,$18,$19,TRUE,COALESCE($17,NOW()),NOW())
       ON CONFLICT (submission_code) DO NOTHING
       RETURNING id`,
      [
        item.code, ids[item.email], person.nik, person.name,
        item.birthPlace, item.birthDate, item.origin, item.domicile,
        item.neighborhood, item.stay, item.purpose, item.status,
        item.note ?? null, item.letterNumber ?? null, item.pickupCode ?? null,
        item.pickupAt ?? null, item.submittedAt, item.approvedAt ?? null,
        item.completedAt ?? null,
      ],
    );
    const applicationId = rows[0]?.id ?? (await pool.query(
      'SELECT id FROM applications WHERE submission_code=$1',
      [item.code],
    )).rows[0].id;

    const historyCount = await pool.query(
      'SELECT COUNT(*)::int AS count FROM action_history WHERE application_id=$1',
      [applicationId],
    );
    if (historyCount.rows[0].count === 0) {
      for (const event of historyFor(item, ids)) {
        await pool.query(
          `INSERT INTO action_history
           (application_id,actor_id,action,from_status,to_status,note,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            applicationId, event.actor, event.action, event.from,
            event.to, event.note, event.at,
          ],
        );
      }
    }
    await pool.query(
      `UPDATE applications SET created_by=COALESCE(created_by,applicant_id),
        updated_by=COALESCE(
          (SELECT actor_id FROM action_history
           WHERE application_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1),
          applicant_id
        )
       WHERE id=$1`,
      [applicationId],
    );

    if (item.status !== 'DRAF') {
      const types = ['KTP', 'KK'];
      if (['DOM-2026-0003', 'DOM-2026-0005', 'DOM-2026-0006', 'DOM-2026-0007']
        .includes(item.code)) {
        types.push('PENDUKUNG');
      }
      for (const type of types) {
        const storedName = `seed-${item.code}-${type}.pdf`;
        const originalName = `${type.toLowerCase()}-${item.code.toLowerCase()}.pdf`;
        const document = buildPdf(`DOKUMEN ${type}`, [
          `Nomor pengajuan: ${item.code}`,
          `Nama pemohon: ${person.name}`,
          `NIK sintetis: ${person.nik}`,
          'Dokumen contoh untuk data awal SuratBatam.',
          'Bukan dokumen kependudukan milik orang nyata.',
        ]);
        await writeFile(join(uploadDir, storedName), document);
        await pool.query(
          `INSERT INTO documents
           (application_id,type,original_name,stored_name,mime_type,size_bytes)
           VALUES ($1,$2,$3,$4,'application/pdf',$5)
           ON CONFLICT (application_id,type) DO NOTHING`,
          [applicationId, type, originalName, storedName, document.length],
        );
      }
    }
  }

  await pool.query(
    `INSERT INTO letter_sequences (year,last_number) VALUES (2026,3)
     ON CONFLICT (year) DO UPDATE
     SET last_number=GREATEST(letter_sequences.last_number,EXCLUDED.last_number)`,
  );

  const summary = await pool.query(
    `SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM applications) AS applications,
      (SELECT COUNT(*)::int FROM documents) AS documents,
      (SELECT COUNT(*)::int FROM action_history) AS history`,
  );
  console.log(JSON.stringify(summary.rows[0], null, 2));
}

seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
