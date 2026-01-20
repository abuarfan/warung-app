// ==========================================
// FILE: config.js
// ==========================================

// GANTI DENGAN DATA DARI SUPABASE ANDA
const SUPABASE_URL = 'https://bwalfzwogkydyonokbib.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3YWxmendvZ2t5ZHlvbm9rYmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMDMyNTksImV4cCI6MjA4Mzc3OTI1OX0.1i_s0y2ge-U2PJ4Km4Rgm302fkvzi6dVFMhUz184xdc';

// Kita gunakan nama 'supabaseClient' agar tidak bentrok dengan library aslinya
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("Supabase Client Loaded");