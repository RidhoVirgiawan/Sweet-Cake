# Toko Kue Manis Senja

Website toko kue responsif yang dibuat dengan **HTML5, CSS3, dan JavaScript vanilla**, dilengkapi backend minimal **Node.js** (tanpa dependensi eksternal) untuk checkout **Midtrans Sandbox**.

> Status pembayaran **tidak pernah** ditentukan dari browser. Bila Midtrans belum dikonfigurasi, checkout berjalan dalam **mode DEMO** dan diberi label jelas: *DEMO — belum memproses pembayaran sungguhan*.

---

## Fitur

### Tampilan
- Navbar sticky dengan logo cupcake, navigasi, dan tombol keranjang.
- Hero, About, Menu, Kontak, dan Footer bernuansa pink pastel dan krem.
- Responsif untuk desktop, tablet, dan ponsel (mulai 320 px).
- Foto produk lokal di `assets/images/` dengan fallback otomatis bila gagal dimuat.
- Semantic HTML, atribut `alt`, skip link, fokus keyboard, dan dukungan `prefers-reduced-motion`.

### Menu dan pencarian
- 10 produk contoh: cake, cupcake, pastry, cookies, dan minuman.
- Pencarian berdasarkan nama, kategori, dan deskripsi.
- Filter kategori (Semua, Cake, Cupcake, Pastry, Cookies & Macaron, Minuman).
- Keadaan kosong saat hasil pencarian tidak ada.

### Keranjang
- Tambah produk dari kartu menu maupun modal detail.
- Ubah jumlah (minimum 1, maksimum 99), hapus item, dan kosongkan keranjang.
- Subtotal dan total dihitung otomatis (harga dihitung ulang di server saat checkout).
- Tersimpan di `localStorage` (`manis-senja-cart-v1`) sehingga bertahan setelah refresh.
- Keadaan keranjang kosong ditampilkan.

### Modal
- Modal detail produk dan modal checkout.
- Dapat ditutup dengan tombol, tombol **Escape**, atau klik area luar.
- Fokus keyboard dikembalikan ke elemen pemicu dan halaman di belakang tidak ikut bergulir.

### Checkout dan Midtrans
- Validasi form (nama, email, telepon) di frontend dan backend.
- Harga dan total dihitung ulang di server dari katalog, bukan dari data browser.
- Server membuat transaksi **Snap** memakai `MIDTRANS_SERVER_KEY`; Server Key tidak pernah dikirim ke frontend.
- Frontend hanya menerima `token` dan `clientKey` untuk memanggil `snap.pay()`.
- Endpoint notifikasi `POST /api/midtrans/notification` memverifikasi `signature_key` (SHA-512) dan mencocokkan nominal dengan pesanan sebelum menyimpan status.
- Tanpa kredensial Midtrans, checkout otomatis menjadi mode **DEMO**.
- Tidak ada data kartu pembayaran yang disimpan.

### Kontak
- Formulir kontak dengan validasi, dikirim ke `POST /api/contact` dan dicatat di `server/data/messages.jsonl`.

---

## Struktur folder

```text
cake/
├── index.html
├── assets/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── script.js
│   └── images/            # logo, hero, 2 foto tentang, dan 10 foto produk (JPG)
├── data/
│   └── products.js        # katalog dipakai frontend & backend
├── server/
│   ├── server.js          # server statis + API Midtrans/kontak
│   └── data/              # dibuat otomatis: orders.json, messages.jsonl (gitignored)
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## Cara menjalankan

Prasyarat: **Node.js 18 atau lebih baru** (proyek diuji dengan Node 24).

### Windows — paling mudah

Klik dua kali `start.bat`. Server berjalan dan browser otomatis terbuka ke
<http://127.0.0.1:3000>. Tutup jendela command prompt (atau tekan `Ctrl+C`)
untuk menghentikan server.

### Lewat terminal

```bash
cd cake
node server/server.js
```

Atau lewat npm:

```bash
npm start
```

Jika PowerShell menolak `npm.ps1` karena kebijakan eksekusi, gunakan `npm.cmd start` atau perintah `node` di atas.

Buka <http://127.0.0.1:3000>.

Tidak ada `npm install` karena proyek tidak memakai dependensi eksternal.

> Membuka `index.html` langsung lewat `file://` hanya menampilkan tampilan statis. Pencarian dan keranjang tetap bekerja, tetapi checkout dan formulir kontak memerlukan server (fetch ke `/api/...`).

Port/host dapat diubah melalui `.env`:

```env
PORT=3000
HOST=127.0.0.1
```

---

## Konfigurasi Midtrans Sandbox

1. Daftar/masuk ke [Midtrans Sandbox](https://dashboard.sandbox.midtrans.com/).
2. Ambil **Server Key** dan **Client Key** dari menu *Settings → Access Keys*.
3. Salin `.env.example` menjadi `.env`:

   ```bash
   copy .env.example .env
   ```

4. Isi nilainya (jangan gunakan tanda kutip bila tidak perlu):

   ```env
   MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxxxxxxxxxx
   MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxxxxxxxxxxxxxx
   MIDTRANS_IS_PRODUCTION=false
   ```

5. Hentikan server lalu jalankan ulang `npm start`.
6. Buka halaman checkout. Jika konfigurasi terbaca, server menampilkan mode **Midtrans Sandbox** dan frontend memuat `snap.js` Sandbox.

### Notifikasi pembayaran

- Endpoint: `POST /api/midtrans/notification`
- Isi **Payment Notification URL** di dashboard Midtrans Sandbox dengan URL publik yang mengarah ke endpoint tersebut, misalnya:
  `https://domain-atau-ngrok-kamu/api/midtrans/notification`
- Untuk pengujian lokal, gunakan tunnel seperti ngrok, lalu isi `PUBLIC_BASE_URL` di `.env` agar redirect `finish` Snap kembali ke website.
- Server memverifikasi:
  1. `sha512(order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY)`;
  2. order benar-benar pernah dibuat server;
  3. nominal `gross_amount` sama dengan total pesanan.
- Status tersimpan di `server/data/orders.json` (tidak di-commit). Browser tidak boleh dipercaya untuk menyatakan pembayaran berhasil.

### Mode DEMO

Jika `MIDTRANS_SERVER_KEY`/`MIDTRANS_CLIENT_KEY` kosong atau masih berupa placeholder:

- Website tetap berjalan penuh.
- Checkout membuat nomor pesanan simulasi dan menampilkan label **DEMO — belum memproses pembayaran sungguhan**.
- Tidak ada transaksi atau pembayaran nyata yang dibuat.

---

## Endpoint API

| Metode | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/api/config` | Status konfigurasi Midtrans, Client Key publik, URL Snap. |
| POST | `/api/checkout` | Validasi pesanan, hitung total di server, buat transaksi Snap atau pesanan demo. |
| POST | `/api/midtrans/notification` | Verifikasi signature & nominal notifikasi Midtrans, simpan status. |
| POST | `/api/contact` | Validasi dan catat pesan kontak ke `server/data/messages.jsonl`. |

Contoh body checkout:

```json
{
  "customer": { "name": "Ridho", "email": "ridho@example.com", "phone": "081234567890" },
  "note": "Tulis ucapan Selamat Ulang Tahun, tanpa kacang",
  "items": [{ "id": "red-velvet-slice", "qty": 2 }]
}
```

---

## Kredit foto

Semua foto berasal dari [Unsplash](https://unsplash.com/) dan digunakan di bawah [Unsplash License](https://unsplash.com/license). Foto diunduh serta dikompres ke lebar maksimal 1200 px.

| File | Fotografer |
| --- | --- |
| `hero.jpg` | Waranya Mooldee |
| `about1.jpg` | Deva Williamson |
| `about2.jpg` | Melanie Kreutz |
| `red-velvet.jpg` | amirali mirhashemian |
| `tiramisu.jpg` | Esra Afşar |
| `cheesecake.jpg` | Orkun Orcan |
| `strawberry-shortcake.jpg` | Dan Michael Sinadjan |
| `lava-cake.jpg` | Max Griss |
| `vanilla-cupcake.jpg` | Sara Cervera |
| `macaron.jpg` | Chelsea Audibert |
| `croissant.jpg` | Conor Brown |
| `choco-chip-cookies.jpg` | Danny Kahn |
| `hot-chocolate.jpg` | Giancarlo Duarte |

---

## Pengujian yang sudah dilakukan

- [x] Server menyajikan `index.html` dan seluruh aset dengan MIME type yang benar.
- [x] Semua tautan navigasi menuju section yang ada.
- [x] Pencarian, seluruh filter kategori, dan keadaan hasil kosong.
- [x] Tambah ke keranjang, ubah jumlah, hapus, dan kosongkan keranjang.
- [x] Subtotal/total dihitung dari harga server saat checkout.
- [x] Keranjang bertahan setelah refresh (localStorage).
- [x] Modal dapat ditutup dengan tombol, Escape, dan klik backdrop.
- [x] Checkout menolak keranjang kosong dan input tidak valid.
- [x] Mode demo diberi label jelas tanpa mengklaim pembayaran berhasil.
- [x] `.env` di-ignore; Server Key tidak pernah dikirim ke browser.
- [x] Endpoint notifikasi menolak signature/nominal yang tidak valid.
- [x] Sintaks JavaScript frontend/backend dan struktur HTML diperiksa.

Pengujian otomatis browser (Playwright/Selenium) tidak disertakan karena proyek tidak memakai dependensi; pengujian antarmuka dilakukan manual.

---

## Catatan keamanan & batasan

- Jangan commit `.env`; file tersebut sudah masuk `.gitignore`.
- Jangan pernah menaruh `MIDTRANS_SERVER_KEY` di JavaScript frontend.
- Server tidak menyimpan data kartu. Proses pembayaran berlangsung di halaman Snap/Midtrans.
- Status “lunas” hanya dianggap sah setelah notifikasi Midtrans terverifikasi di server.
- Penyimpanan pesanan memakai file JSON lokal — cocok untuk demo/pembelajaran, belum untuk produksi multi-instance. Untuk produksi, gunakan database, HTTPS, autentikasi admin, dan logging yang lebih lengkap.
- Formulir kontak menulis pesan ke file lokal server, bukan mengirim email.
- Data produk, foto, teks, dan identitas toko adalah contoh fiktif untuk pembelajaran.
