import { DM_Serif_Display, DM_Mono } from 'next/font/google';

const dmSerif = DM_Serif_Display({ subsets: ['latin'], weight: '400', variable: '--font-serif' });
const dmMono = DM_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export const metadata = {
  title: 'maastr',
  description: 'AI Music Mastering',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={`${dmSerif.variable} ${dmMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
