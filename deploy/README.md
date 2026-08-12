# Deployment produksi SuratBatam

Konfigurasi ini ditujukan untuk VPS Linux dengan public IPv4, Docker Engine,
Docker Compose, dan domain yang sudah mengarah ke IP VPS. Shared hosting/FTP
tidak dapat menjalankan stack ini.

## Arsitektur

- Caddy membuka port 80 dan 443 serta mengelola HTTPS.
- Frontend Angular/Nginx hanya dapat diakses melalui Caddy.
- Frontend meneruskan `/api` ke backend Fastify pada jaringan Docker.
- PostgreSQL hanya berada pada jaringan internal dan tidak mempunyai port host.
- Dokumen, backup logis, database, serta sertifikat menggunakan named volume.
- Mailpit tidak dijalankan. Aktivasi akun dan reset kata sandi memakai SMTP resmi.

## Prasyarat server

1. Buat A record domain menuju public IPv4 VPS.
2. Buka inbound TCP 80 dan 443 serta UDP 443.
3. Batasi SSH hanya untuk alamat administrator bila memungkinkan.
4. Pasang Docker Engine, plugin Docker Compose, Git, dan OpenSSL.

## Instalasi pertama

```bash
git clone https://github.com/joncetified/suratdocker.git
cd suratdocker
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production`. Gunakan domain asli, SMTP resmi, serta seluruh password
dan secret baru. Jangan menyalin `.env` pengembangan.

Validasi konfigurasi tanpa menjalankan container:

```bash
docker compose --env-file .env.production -f compose.production.yaml config --quiet
```

Jalankan aplikasi:

```bash
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml ps
```

Setelah DNS aktif dan seluruh container sehat:

```bash
curl https://DOMAIN_ANDA/api/health
```

Caddy hanya dapat memperoleh sertifikat jika domain sudah mengarah ke VPS dan
port 80/443 dapat dijangkau dari internet.

## Data awal

Backend membuat atau memperbarui schema saat startup, tetapi tidak menjalankan
seeder. Jangan menjalankan `npm run seed` pada database operasional karena
perintah tersebut memasukkan data sintetis demonstrasi.

Pilih salah satu prosedur berikut:

1. untuk demo sekolah, jalankan seeder satu kali dan segera ganti seluruh
   password awal; atau
2. untuk penggunaan operasional, pulihkan dump PostgreSQL yang telah
   dibersihkan atau buat prosedur bootstrap satu akun Super Admin.

Perintah seeder hanya untuk database demo yang benar-benar kosong:

```bash
docker compose --env-file .env.production -f compose.production.yaml exec backend npm run seed
```

## Operasional

Status dan log:

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=200
```

Pembaruan versi:

```bash
git pull --ff-only
docker compose --env-file .env.production -f compose.production.yaml up -d --build
```

Backup volume PostgreSQL dan dokumen harus dijadwalkan ke media lain. Backup
yang hanya berada pada VPS yang sama tidak cukup untuk pemulihan bencana.

Jangan menjalankan `docker compose down -v` karena opsi `-v` menghapus volume
database, dokumen, backup, dan sertifikat.
