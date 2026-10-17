import type { Metadata } from "next";
import { Instrument_Sans, Martian_Mono } from "next/font/google";
import Link from "next/link";
import { db } from "@/db";
import { countReviewQueue } from "@/server/review";
import { readWorkspace } from "@/server/workspace";
import "./globals.css";

const sans = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"] });
// The width axis lets figures run a little condensed in tables (`.figures`).
const mono = Martian_Mono({ variable: "--font-martian", subsets: ["latin"], axes: ["wdth"] });

export const metadata: Metadata = {
  title: "Docwise: invoice extraction you can audit",
  description: "Upload a supplier invoice and get its fields back, each with an auditor's tick marks, and anything unsure sent to a person.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const workspaceId = await readWorkspace();
  const waiting = workspaceId ? await countReviewQueue(db, workspaceId) : 0;

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans antialiased">
        <header className="bg-chrome text-chrome-ink">
          <div className="mx-auto flex max-w-7xl items-center gap-5 px-4 py-2.5 sm:gap-8">
            <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
              <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
                <rect width="32" height="32" rx="7" fill="currentColor" opacity=".1" />
                <path d="M9 16.5l4.5 4.5L23 10.5" fill="none" stroke="#8fa3ff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 25.5h16" stroke="#ffe066" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
              <span className="text-[17px]">Docwise</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm text-chrome-muted">
              <Link href="/" className="rounded-md px-2.5 py-1.5 hover:bg-white/10 hover:text-chrome-ink">
                Inbox
              </Link>
              <Link href="/review" className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 hover:bg-white/10 hover:text-chrome-ink">
                Review
                {waiting > 0 && (
                  <span className="rounded bg-[#ffe066] px-1.5 font-mono text-[11px] leading-5 font-semibold text-[#1b1d22]" aria-label={`${waiting} waiting`}>
                    {waiting}
                  </span>
                )}
              </Link>
              <a href="/export.csv" className="hidden rounded-md px-2.5 py-1.5 hover:bg-white/10 hover:text-chrome-ink sm:block">
                Export CSV
              </a>
              <Link href="/developers" className="rounded-md px-2.5 py-1.5 hover:bg-white/10 hover:text-chrome-ink">
                API
              </Link>
            </nav>
            <a href="https://github.com/krishnanbhupathi/docwise-extract" className="ml-auto text-sm text-chrome-muted hover:text-chrome-ink">
              Source
            </a>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
