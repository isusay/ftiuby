// Dijalankan otomatis saat container start: menerapkan migrasi SQL di ./drizzle
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL belum diisi");
  process.exit(1);
}
const sql = postgres(url, { max: 1 });
try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("Migrasi database selesai");
} catch (err) {
  console.error("Migrasi gagal:", err);
  process.exit(1);
} finally {
  await sql.end();
}
