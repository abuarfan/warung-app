-- Tambah kolom qty & unit untuk stok_lines (jalankan sekali)
alter table public.stok_lines
  add column if not exists qty numeric null,
  add column if not exists unit text null;
