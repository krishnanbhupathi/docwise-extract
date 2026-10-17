import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const sans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Docwise: invoice extraction you can check",
  description: "Upload a supplier invoice and get its fields back, checked by rules, with anything unsure sent to a person.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
                <rect width="32" height="32" rx="6" fill="var(--accent)" />
                <path d="M10 7h9l5 5v13H10z" fill="#fff" />
                <path d="M13 16h8M13 20h6" stroke="var(--accent)" strokeWidth="2" />
              </svg>
              Docwise
            </Link>
            <nav className="flex gap-4 text-sm text-muted">
              <Link href="/" className="hover:text-ink">
                Upload
              </Link>
              <Link href="/review" className="hover:text-ink">
                Review
              </Link>
            </nav>
            <a href="https://github.com/krishnanbhupathi/docwise-extract" className="ml-auto text-sm text-muted hover:text-ink">
              Source
            </a>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
