import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import './globals.css';
import Providers from '@/components/providers';
import Navbar from '@/components/layout/navbar';
import Footer from '@/components/layout/footer';

// Archivo's width axis (62–125%) gives the headlines their wide, poster-like cut.
const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  axes: ['wdth'],
});

export const metadata: Metadata = {
  title: {
    template: '%s | IITR Chess',
    default: 'IITR Chess Leaderboard',
  },
  description: 'Live Chess.com leaderboard and Swiss tournaments for IIT Roorkee chess players.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#edf2ee' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1f1f' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="flex min-h-screen flex-col bg-paper font-sans text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-paper"
        >
          Skip to content
        </a>
        <Providers>
          <Navbar />
          <main id="main" className="flex flex-1 flex-col">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
