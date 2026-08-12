const base = process.env.API_URL ?? 'http://localhost:3000/api';

async function request(path, options = {}, token, expectedStatus) {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.arrayBuffer();
  if (expectedStatus !== undefined) {
    if (response.status !== expectedStatus) {
      throw new Error(`${path}: diharapkan ${expectedStatus}, diterima ${response.status}`);
    }
    return body;
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${path}: ${body.message ?? 'permintaan gagal'}`);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const employees = {
  petugas: 'ratna.dewi@suratbatam.local',
  kasi: 'hendra.saputra@suratbatam.local',
  lurah: 'fauzan.rahman@suratbatam.local',
  admin: 'dimas.pratama@suratbatam.local',
  superAdmin: 'arif.wijaya@suratbatam.local',
};
const sessions = {};

const health = await request('/health');
assert(health.status === 'ok', 'Health check backend gagal.');

for (const [role, email] of Object.entries(employees)) {
  sessions[role] = await request('/auth/login', {
    method: 'POST',
    body: { email, password: 'Batam123!' },
  });
}

const citizenRegistration = {
  nik: '3271050101010099',
  name: 'Warga Integrasi',
  email: 'warga.integrasi@example.test',
  password: 'Daftar123!',
  phone: '081234567899',
  address: 'Perumahan Integrasi Blok A No. 1, Kelurahan Belian',
  acceptedTerms: true,
};
await request('/auth/register', {
  method: 'POST',
  body: { ...citizenRegistration, acceptedTerms: false },
}, undefined, 400);
const registration = await request('/auth/register', {
  method: 'POST',
  body: citizenRegistration,
});
assert(
  registration.testVerificationToken,
  'Registrasi tidak menghasilkan token verifikasi pada lingkungan tes.',
);
await request('/auth/login', {
  method: 'POST',
  body: { email: citizenRegistration.email, password: citizenRegistration.password },
}, undefined, 403);
await request('/auth/verify-email', {
  method: 'POST',
  body: { token: registration.testVerificationToken },
});
const citizen = await request('/auth/login', {
  method: 'POST',
  body: { email: citizenRegistration.email, password: citizenRegistration.password },
});
assert(citizen.user.role === 'WARGA' && citizen.token, 'Aktivasi tidak membuka login warga.');
await request('/auth/register', {
  method: 'POST',
  body: citizenRegistration,
}, undefined, 409);

const secondRegistration = await request('/auth/register', {
  method: 'POST',
  body: {
    ...citizenRegistration,
    nik: '3271050202020098',
    name: 'Warga Lain',
    email: 'warga.lain@example.test',
    phone: '081234567898',
  },
});
await request('/auth/verify-email', {
  method: 'POST',
  body: { token: secondRegistration.testVerificationToken },
});
const secondCitizen = await request('/auth/login', {
  method: 'POST',
  body: {
    email: 'warga.lain@example.test',
    password: citizenRegistration.password,
  },
});

const fields = {
  nik: citizenRegistration.nik,
  fullName: citizenRegistration.name,
  birthPlace: 'Batam',
  birthDate: '2001-01-01',
  originAddress: 'Kecamatan Sekupang, Kota Batam',
  domicileAddress: 'Perumahan Integrasi Blok A No. 1',
  neighborhood: '001 / 001',
  village: 'Belian',
  district: 'Batam Kota',
  stayDuration: '1 tahun',
  purpose: 'Verifikasi alur sistem pada database integrasi terpisah',
};

const draftForm = new FormData();
for (const [key, value] of Object.entries(fields)) draftForm.append(key, value);
draftForm.append('submissionMode', 'draft');
const draft = await request('/applications', {
  method: 'POST',
  body: draftForm,
}, citizen.token);
assert(draft.application.status === 'DRAF', 'Pengajuan tidak tersimpan sebagai draf.');

const pdf = new Blob(['%PDF-1.4\n%%EOF'], { type: 'application/pdf' });
const submitForm = new FormData();
for (const [key, value] of Object.entries(fields)) submitForm.append(key, value);
submitForm.append('submissionMode', 'submit');
submitForm.append('ktp', pdf, 'ktp-integrasi.pdf');
submitForm.append('kk', pdf, 'kk-integrasi.pdf');
const submitted = await request(`/applications/${draft.application.id}`, {
  method: 'PUT',
  body: submitForm,
}, citizen.token);
assert(
  submitted.application.status === 'MENUNGGU_PEMERIKSAAN',
  'Draf tidak terkirim ke Petugas.',
);

await request(`/applications/${draft.application.id}`, {}, secondCitizen.token, 404);
await request(`/applications/${draft.application.id}/actions`, {
  method: 'POST',
  body: { action: 'VERIFY' },
}, sessions.admin.token, 403);

await request(`/applications/${draft.application.id}/actions`, {
  method: 'POST',
  body: { action: 'REQUEST_REVISION', note: 'Alamat perlu dibuat lebih rinci.' },
}, sessions.petugas.token);
const correction = new FormData();
for (const [key, value] of Object.entries({
  ...fields,
  domicileAddress: 'Perumahan Integrasi Blok A No. 1, RT 001/RW 001',
})) correction.append(key, value);
correction.append('submissionMode', 'submit');
await request(`/applications/${draft.application.id}`, {
  method: 'PUT',
  body: correction,
}, citizen.token);

await request(`/applications/${draft.application.id}/actions`, {
  method: 'POST', body: { action: 'VERIFY', note: 'Dokumen lengkap.' },
}, sessions.petugas.token);
await request(`/applications/${draft.application.id}/actions`, {
  method: 'POST', body: { action: 'APPROVE', note: 'Data wilayah sesuai.' },
}, sessions.kasi.token);
await request(`/applications/${draft.application.id}/actions`, {
  method: 'POST', body: { action: 'APPROVE', note: 'Disetujui.' },
}, sessions.lurah.token);
await request(`/applications/${draft.application.id}/actions`, {
  method: 'POST',
  body: {
    action: 'SCHEDULE',
    pickupAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
}, sessions.petugas.token);

const detailBeforeComplete = await request(
  `/applications/${draft.application.id}`,
  {},
  citizen.token,
);
assert(detailBeforeComplete.application.letter_number, 'Nomor surat tidak terbentuk.');
assert(detailBeforeComplete.application.pickup_code, 'Kode pengambilan tidak terbentuk.');
assert(detailBeforeComplete.application.documents.length === 2, 'Dokumen tidak tersimpan.');
await request(
  `/documents/${detailBeforeComplete.application.documents[0].id}`,
  {},
  citizen.token,
);

await request(`/applications/${draft.application.id}/actions`, {
  method: 'POST', body: { action: 'COMPLETE', note: 'Surat telah diserahkan.' },
}, sessions.petugas.token);
const completed = await request(`/applications/${draft.application.id}`, {}, citizen.token);
assert(completed.application.status === 'SELESAI', 'Status akhir bukan SELESAI.');
assert(completed.history.length === 9, `Riwayat seharusnya 9, diterima ${completed.history.length}.`);

const updatedProfile = await request('/profile', {
  method: 'PATCH',
  body: {
    name: citizenRegistration.name,
    phone: '081234567897',
    address: 'Perumahan Integrasi Blok A No. 1, RT 001/RW 001, Belian',
  },
}, citizen.token);
assert(updatedProfile.user.phone === '081234567897', 'Profil tidak diperbarui.');

await request('/auth/change-password', {
  method: 'POST',
  body: { currentPassword: 'Daftar123!', newPassword: 'Password456!' },
}, citizen.token);
await request('/auth/me', {}, citizen.token, 401);
const changedPasswordSession = await request('/auth/login', {
  method: 'POST',
  body: { email: citizenRegistration.email, password: 'Password456!' },
});
const resetRequest = await request('/auth/password-reset/request', {
  method: 'POST',
  body: { identifier: citizenRegistration.email, channel: 'EMAIL' },
});
assert(resetRequest.testResetToken, 'Token reset email pada lingkungan tes tidak tersedia.');
await request('/auth/password-reset/confirm', {
  method: 'POST',
  body: { token: resetRequest.testResetToken, newPassword: 'Password789!' },
});
await request('/auth/me', {}, changedPasswordSession.token, 401);
await request('/auth/login', {
  method: 'POST',
  body: { email: citizenRegistration.email, password: 'Password789!' },
});

await request('/access/pages', {}, sessions.admin.token, 403);
const accessPages = await request('/access/pages', {}, sessions.superAdmin.token);
assert(accessPages.pages.length >= 13, 'Daftar halaman permission tidak lengkap.');
const secondAccess = await request(
  `/access/users/${secondCitizen.user.id}`,
  {},
  sessions.superAdmin.token,
);
const permissionPayload = Object.fromEntries(
  secondAccess.permissions.map((item) => [item.code, item.code !== 'flow']),
);
await request(`/access/users/${secondCitizen.user.id}`, {
  method: 'PUT',
  body: { permissions: permissionPayload },
}, sessions.superAdmin.token);
await request('/auth/me', {}, secondCitizen.token, 401);

const settingsUpdate = await request('/site-settings', {
  method: 'PUT',
  body: {
    companyName: 'Kelurahan Belian',
    logoData: null,
    address: 'Kelurahan Belian, Kecamatan Batam Kota, Kota Batam',
    managerName: 'Lurah Kelurahan Belian',
    contactPhone: '0778-000000',
    contactEmail: 'pelayanan@suratbatam.local',
    contactWhatsapp: '081200000000',
  },
}, sessions.admin.token);
assert(settingsUpdate.settings.company_name === 'Kelurahan Belian', 'Settings gagal disimpan.');
const publicSettings = await request('/site-settings/public');
assert(publicSettings.settings.manager_name, 'Settings publik tidak tersedia.');

const report = await request(
  '/reports/applications?period=MONTHLY',
  {},
  sessions.petugas.token,
);
assert(report.total >= 1 && Array.isArray(report.timeline), 'Laporan pengajuan gagal.');

const incomeEntry = await request('/income', {
  method: 'POST',
  body: {
    entryDate: new Date().toISOString().slice(0, 10),
    amount: 150000,
    description: 'Pendapatan integrasi',
  },
}, sessions.lurah.token);
await request('/income', {
  method: 'POST',
  body: {
    entryDate: '2026-02-31',
    amount: 1000,
    description: 'Tanggal kalender tidak valid',
  },
}, sessions.lurah.token, 400);
const incomeSummary = await request('/income/summary', {}, sessions.lurah.token);
assert(Number(incomeSummary.summary.today) === 150000, 'Ringkasan pendapatan salah.');
await request(`/income/${incomeEntry.entry.id}`, {
  method: 'DELETE',
}, sessions.lurah.token);
const trashWithIncome = await request('/trash', {}, sessions.superAdmin.token);
assert(
  trashWithIncome.records.some(
    (item) => item.type === 'INCOME' && Number(item.id) === Number(incomeEntry.entry.id),
  ),
  'Soft-delete pendapatan tidak masuk trash.',
);
await request(`/trash/INCOME/${incomeEntry.entry.id}/restore`, {
  method: 'POST',
}, sessions.superAdmin.token);

const exportedUsers = await request(
  '/data/export?scope=users&format=json',
  {},
  sessions.admin.token,
);
assert(exportedUsers.records.length >= 8, 'Export pengguna gagal.');
const importIncome = await request('/data/import', {
  method: 'POST',
  body: {
    scope: 'income',
    records: [{
      entry_date: new Date().toISOString().slice(0, 10),
      amount: 25000,
      description: 'Import integrasi',
    }],
  },
}, sessions.admin.token);
assert(importIncome.imported === 1, 'Import data gagal.');
const invalidApplicationImport = await request('/data/import', {
  method: 'POST',
  body: {
    scope: 'applications',
    records: [{
      submission_code: 'IMP-TANGGAL-RUSAK',
      applicant_email: citizenRegistration.email,
      birth_place: 'Batam',
      birth_date: '2026-02-31',
      origin_address: 'Alamat asal untuk pengujian integrasi',
      domicile_address: 'Alamat domisili untuk pengujian integrasi',
      stay_duration: '1 tahun',
      purpose: 'Pengujian validasi import aplikasi',
    }],
  },
}, sessions.admin.token);
assert(
  invalidApplicationImport.imported === 0 && invalidApplicationImport.skipped === 1,
  'Baris import pengajuan yang rusak tidak dilewati dengan aman.',
);

const backup = await request('/backups', {
  method: 'POST',
}, sessions.admin.token);
assert(backup.backup.checksum_sha256, 'Backup logis tidak terbentuk.');
const downloadedBackup = await request(
  `/backups/${backup.backup.id}/download`,
  {},
  sessions.admin.token,
);
assert(downloadedBackup.version === 1, 'File backup tidak dapat dibaca.');
await request('/system/database/recover-connection', {
  method: 'POST',
}, sessions.admin.token);
await request('/endpoint-tidak-ada', {}, undefined, 404);

const employee = await request('/users', {
  method: 'POST',
  body: {
    employeeNumber: 'PGW-TEST-001',
    name: 'Pegawai Integrasi',
    email: 'pegawai.integrasi@example.test',
    password: 'Pegawai123!',
    role: 'PETUGAS',
    position: 'Petugas Pelayanan',
    phone: '081234567896',
  },
}, sessions.admin.token);
const employeeSession = await request('/auth/login', {
  method: 'POST',
  body: { email: employee.user.email, password: 'Pegawai123!' },
});
await request(`/users/${employee.user.id}`, {
  method: 'PATCH',
  body: { role: 'PETUGAS', isActive: false },
}, sessions.admin.token);
await request('/auth/me', {}, employeeSession.token, 401);
await request(`/users/${employee.user.id}`, {
  method: 'DELETE',
}, sessions.admin.token);
const deletedData = await request('/trash', {}, sessions.superAdmin.token);
assert(
  deletedData.records.some(
    (item) => item.type === 'USER' && Number(item.id) === Number(employee.user.id),
  ),
  'Soft-delete pengguna tidak masuk trash.',
);
await request(`/trash/USER/${employee.user.id}/restore`, {
  method: 'POST',
}, sessions.superAdmin.token);
const auditLogs = await request('/audit-logs', {}, sessions.superAdmin.token);
assert(auditLogs.logs.length > 0, 'Audit created/updated/deleted tidak tercatat.');

const logoutSession = await request('/auth/login', {
  method: 'POST',
  body: { email: citizenRegistration.email, password: 'Password789!' },
});
await request('/auth/logout', { method: 'POST' }, logoutSession.token);
await request('/auth/me', {}, logoutSession.token, 401);

console.log(JSON.stringify({
  health: health.status,
  registration: 'ok',
  registrationConsent: 'ok',
  emailActivation: 'ok',
  passwordResetEmail: 'ok',
  duplicateProtection: 'ok',
  draftAndSubmission: 'ok',
  documentAuthorization: 'ok',
  roleAuthorization: 'ok',
  revisionFlow: 'ok',
  finalStatus: completed.application.status,
  historyEntries: completed.history.length,
  profileAndPassword: 'ok',
  changedPasswordRevokesSession: 'ok',
  inactiveSessionRejected: 'ok',
  serverSideLogout: 'ok',
  databasePagePermissions: 'ok',
  siteSettings: 'ok',
  reports: 'ok',
  incomeComparisons: 'ok',
  exportImport: 'ok',
  logicalBackup: 'ok',
  softDeleteRestoreAndAudit: 'ok',
  custom404: 'ok',
}, null, 2));
