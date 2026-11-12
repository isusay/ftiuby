import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/header";

export const metadata: Metadata = {
  title: "ftiuby — Publish karya web mahasiswa",
  description: "Galeri dan hosting gratis untuk website statis karya komunitas ftiuby. Dari repository GitHub/GitLab atau file ZIP ke nama.ftiuby.cloud.",
  openGraph: {
    title: "ftiuby — Publish karya web mahasiswa",
    description: "Dari repository GitHub/GitLab atau file ZIP ke nama.ftiuby.cloud, gratis.",
    locale: "id_ID",
    siteName: "ftiuby",
    type: "website",
  },
};

const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=JetBrains+Mono:wght@500&family=Public+Sans:ital,wght@0,400..700;1,400&display=swap"
        />
      </head>
      <body className="min-h-dvh flex flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 btn btn-primary z-50">
          Lewati ke konten
        </a>
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <footer className="border-t border-line bg-paper/80">
          <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted flex flex-wrap gap-x-6 gap-y-2 justify-between">
            <p>ftiuby — tempat karya web mahasiswa dipajang dan dipakai.</p>
            <p>Hanya untuk website statis. Baca aturan di halaman Panduan.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
