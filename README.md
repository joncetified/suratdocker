# SuratBatam

Sistem pengajuan Surat Keterangan Domisili untuk lingkungan kelurahan di Kota
Batam. Aplikasi ini memakai Angular, Fastify, PostgreSQL, dan Docker. Proyek ini
tidak memakai WampServer, Laravel, atau PHP.

## Menjalankan aplikasi

Pastikan Docker Desktop aktif, kemudian jalankan:

```powershell
cd C:\Users\LENOVO\Documents\docker\suratapp
docker compose up --build -d
docker compose ps
```

Layanan lokal:

- Portal aplikasi: http://localhost:4200
- Kotak email lokal (Mailpit): http://localhost:8025
- API health: http://localhost:3000/api/health
- PostgreSQL dari Windows: `127.0.0.1:5433`

Port PostgreSQL Docker sengaja menggunakan `5433` agar tidak bentrok dengan
PostgreSQL Windows pada `5432`.

Berkas `.env` di akar proyek digunakan otomatis oleh Docker Compose. Berkas ini
berisi konfigurasi aktif dan secret sehingga tidak boleh dibagikan. Gunakan
`.env.example` sebagai template untuk server lain.

## Arsitektur dan database

Angular tidak terhubung langsung ke PostgreSQL dan tidak menerima password
database. Alurnya:

```text
Browser -> Angular/Nginx (/api) -> Fastify (DATABASE_URL) -> PostgreSQL
```

Data PostgreSQL, dokumen, backup, dan kotak email tersimpan pada named volume
Docker yang berbeda:

- `postgres_data`
- `document_uploads`
- `database_backups`
- `mailpit_data`

Data tetap ada setelah `docker compose down` atau container dibangun ulang.
Jangan memakai `docker compose down -v` jika data masih diperlukan.

Pemeriksaan koneksi dan data:

```powershell
docker compose ps
curl.exe http://localhost:4200/api/health
docker compose exec -T database psql -U suratapp -d suratapp -c "SELECT current_database(), current_user;"
```

Backend hanya membuat atau memperbarui struktur tabel saat startup. Backend
tidak menjalankan seeder dan tidak membuat ulang akun maupun pengajuan dari
kode. Data yang terlihat pada portal selalu dibaca dari PostgreSQL.

Perintah berikut hanya untuk mengisi database pengembangan yang benar-benar
kosong dengan data contoh. Jangan jalankan pada database operasional:

```powershell
docker compose exec -T backend npm run seed
```

Database lokal yang sekarang sudah berisi 14 pengguna, 10 pengajuan, 22 dokumen,
dan 29 catatan riwayat. Seluruh baris tersebut tersimpan pada volume PostgreSQL
dan tidak bergantung pada seeder setelah dimasukkan. Identitasnya sintetis untuk
demonstrasi dan tidak mewakili warga nyata. Data aplikasi dibaca dari
PostgreSQL, bukan array tiruan di Angular.

## Akun awal

| Role | Nama | Email |
|---|---|---|
| Super Admin | Arif Wijaya | `arif.wijaya@suratbatam.local` |
| Administrator | Dimas Pratama | `dimas.pratama@suratbatam.local` |
| Lurah | Fauzan Rahman | `fauzan.rahman@suratbatam.local` |
| Kasi Pemerintahan | Hendra Saputra | `hendra.saputra@suratbatam.local` |
| Petugas Pelayanan | Ratna Sari Dewi | `ratna.dewi@suratbatam.local` |
| Warga | Nadia Putri Ramadhani | `nadia.ramadhani@suratbatam.local` |

Password akun awal mengikuti `INITIAL_ACCOUNT_PASSWORD` pada `.env`. Akun warga
tambahan mengikuti `SEED_ACCOUNT_PASSWORD`:

- `rahma.oktaviani@suratbatam.local`
- `fikri.maulana@suratbatam.local`
- `salsabila.putri@suratbatam.local`
- `muhammad.reza@suratbatam.local`
- `intan.permata@suratbatam.local`
- `rio.kurniawan@suratbatam.local`
- `dewi.lestari@suratbatam.local`
- `yusuf.hidayat@suratbatam.local`

Ganti semua password awal sebelum penggunaan operasional.

## Aktivasi akun dan reset password

Warga mendaftar melalui halaman login. Akun baru belum dapat dipakai sampai
tautan aktivasi pada email dibuka. Pada lingkungan lokal, semua email ditangkap
oleh Mailpit dan dapat dibaca di http://localhost:8025. Tautan aktivasi berlaku
24 jam dan hanya dapat digunakan sekali.

Reset password dapat diminta melalui:

- email; aktif pada lingkungan lokal melalui Mailpit;
- WhatsApp; aktif setelah `WHATSAPP_ACCESS_TOKEN` dan
  `WHATSAPP_PHONE_NUMBER_ID` dari Meta diisi pada environment server.

Token aktivasi dan reset hanya disimpan sebagai hash di PostgreSQL. Reset
password membatalkan sesi lama.

## Role, hak akses, dan alur kerja

Role sistem:

1. Warga
2. Petugas Pelayanan
3. Kasi Pemerintahan
4. Lurah
5. Administrator
6. Super Admin

Alur surat tetap mengikuti pekerjaan kelurahan:

```text
Warga -> Petugas -> Kasi -> Lurah -> Petugas menyerahkan surat
```

Super Admin mempunyai akses seluruh menu sistem, tetapi bukan pengganti
kewenangan jabatan pada alur persetujuan surat. Lurah dipakai sebagai padanan
manager untuk laporan pendapatan.

Hak akses halaman disimpan di PostgreSQL. Menu **Hak Akses** menyediakan
checklist per akun dan hanya dapat dibuka Super Admin. Perubahan izin langsung
mencabut sesi lama akun tersebut. Administrator tidak dapat membuka menu ini,
memberi akses penuh kepada dirinya, atau membuat Super Admin baru.

## Fitur pengelolaan

- **Pengaturan Website** menyimpan nama instansi, logo, alamat, penanggung jawab,
  telepon, email, dan WhatsApp pada PostgreSQL.
- Field audit `created_by` dan `updated_by` tersedia pada data utama dan terlihat
  oleh Super Admin.
- Penghapusan pengguna, pengajuan, dan pendapatan memakai soft-delete. Super
  Admin dapat melihat audit serta memulihkan data lewat **Data Terhapus**.
- Kesalahan alamat halaman menampilkan halaman 404 aplikasi. Error API
  ditampilkan sebagai pesan aplikasi, bukan layar framework.
- Laporan pengajuan tersedia untuk periode harian, mingguan, bulanan, dan
  tahunan, dengan pilihan diagram batang atau diagram pie.
- Dashboard pendapatan hanya tersedia bagi Lurah dan Super Admin, dengan
  perbandingan hari ini/kemarin serta bulan ini/bulan lalu.
- **Export / Import** mendukung pengguna, pengajuan layanan, dan pendapatan.
  Export tersedia dalam JSON atau CSV; import memakai JSON maksimal 2.000 baris.
  Password hash tidak pernah diekspor. Pengguna hasil import menerima satu
  password sementara yang ditentukan saat import.
- **Cadangan Data** membuat cadangan logis JSON bertanda checksum dan
  menyimpannya pada volume `database_backups`. Cadangan dapat diunduh dari portal.
  Fitur ini bukan dump penuh PostgreSQL dan bukan pengganti backup di luar VPS.

Menu pemulihan koneksi memeriksa koneksi PostgreSQL dan memuat ulang schema
secara aman tanpa menghapus data. Restart container database tetap dilakukan
dari komputer/server:

```powershell
docker compose restart database
docker compose ps
```

Website tidak diberi akses ke Docker socket karena akses tersebut setara dengan
hak penuh atas komputer host.

## Pengujian terpisah

Integration test memakai PostgreSQL sementara di memori dan tidak menyentuh
database utama. Compose khusus tes sengaja menjalankan seeder pada database
sementara sebelum pengujian:

```powershell
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from tester
docker compose -f compose.test.yaml down
```

Skenario mencakup aktivasi email, reset password, proteksi duplikasi, pengajuan
dan dokumen, kewenangan setiap role, izin halaman dari database, settings,
laporan, pendapatan, export/import, backup/checksum, soft-delete/restore, audit,
revokasi sesi, serta 404.

Build frontend dan audit backend:

```powershell
cd frontend
npm.cmd run build
cd ..\backend
npm.cmd audit --omit=dev
```

## Catatan deployment domain

Untuk dipasang pada domain:

1. buat `.env` server baru dari `.env.example`;
2. gunakan secret dan seluruh password awal yang baru;
3. ubah `PUBLIC_APP_URL`, `CORS_ORIGIN`, serta konfigurasi SMTP;
4. pasang reverse proxy HTTPS seperti Caddy atau Nginx;
5. jangan membuka PostgreSQL ke internet;
6. hapus atau anonimisasi data sintetis sebelum menerima data operasional.

Mailpit hanya untuk pengembangan lokal. Pada server produksi, ganti
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, dan `SMTP_FROM` dengan
layanan email resmi.

Paket deployment VPS yang tidak membuka PostgreSQL ke internet tersedia pada:

- `compose.production.yaml`;
- `.env.production.example`;
- `deploy/Caddyfile`;
- `deploy/README.md`.

Jalankan dengan `--env-file .env.production`. Caddy pada stack produksi
mengelola reverse proxy dan HTTPS setelah DNS domain mengarah ke public IP VPS.
