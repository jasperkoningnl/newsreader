import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "The Feed",
  description: "Jasper's personal newsreader",
  manifest: "/manifest.webmanifest",
  themeColor: "#000000",
  appleWebApp: {
    capable: true,
    title: "The Feed",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/icon-192.png",
  },
};

const navItems = [
  { href: "/", label: "Feed" },
  { href: "/bronnen", label: "Sources" },
  { href: "/smaak", label: "Taste" },
  { href: "/bewaard", label: "Saved" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="h-full bg-black text-white">
        <PwaRegister />
        <div className="flex h-full">
          <aside className="hidden md:flex w-[120px] shrink-0 border-r border-white/10 bg-black flex-col py-6">
            <div className="px-4 text-3xl font-extrabold tracking-tight [writing-mode:vertical-rl] rotate-180 text-white/85">The Feed</div>
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
