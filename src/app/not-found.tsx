import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-5xl font-extrabold mb-3">Halaman tidak ditemukan</h1>
      <p className="text-muted mb-6">Karya ini belum live, sudah diarsipkan, atau alamatnya salah ketik.</p>
      <Link href="/" className="btn btn-primary">Kembali ke galeri</Link>
    </section>
  );
}
