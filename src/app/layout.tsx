import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "Newsreader",
  description: "Jasper's persoonlijke nieuwsreader",
};

const navItems = [
  { href: "/", label: "Feed" },
  { href: "/bronnen", label: "Bronnen" },
  { href: "/smaak", label: "Smaak" },
  { href: "/bewaard", label: "Bewaard" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${geist.variable} h-full antialiased`}>
      <body className="h-full bg-black text-white">
        <div className="flex h-full">
          <aside className="hidden md:flex w-[120px] shrink-0 border-r border-white/10 bg-black flex-col py-6">
            <div className="px-4 text-3xl font-extrabold tracking-tight [writing-mode:vertical-rl] rotate-180 text-white/85">Editorial</div>
            <nav className="mt-12 flex flex-col gap-8 px-4 text-white/65">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} className="metadata-caps hover:text-white transition-colors">{item.label}</Link>
              ))}
            </nav>
          </aside>
          <div className="flex-1 flex flex-col min-h-0">
            <main className="flex-1 overflow-auto">{children}</main>
            <nav className="md:hidden h-[72px] flex border-t border-white/10 bg-black">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} className="flex-1 flex items-center justify-center text-[12px] tracking-[0.02em] text-white/40 hover:text-white">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </body>
    </html>
  );
}
