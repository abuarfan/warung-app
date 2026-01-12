# WarungKu v3 — sesuai permintaan

Perubahan:
- Beranda dihapus → diganti **Laporan Harian**
- Navigasi cuma 3: **Catat • Harian • Bulanan**
- Belanja stok & pengeluaran **dimerger** (pilih mode: Belanja Stok / Pengeluaran)
- Belanja stok: rinci **jenis stok** + nominal, **tanpa qty**
- Penjualan: **Pagi & Sore** (akumulatif)

Data:
- Penjualan sesi disimpan di `transactions.ref_table`: `sales_pagi` / `sales_sore`
- Belanja stok disimpan sebagai 1 transaksi expense (`ref_table='stok'`) + rincian item di `stok_lines`
