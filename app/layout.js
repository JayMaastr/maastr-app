import { DM_Mono, DM_Serif_Display } from 'next/font/google';

const dmMono = DM_Mono({ subsets: ['latin'], weight: ['300', '400', '500'] });
const dmSerif = DM_Serif_Display({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'] });

export const metadata = {
  title: 'maastr — AI Music Mastering',
  description: 'Professional AI-powered music mastering platform',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={dmMono.className}>
        {children}
      </body>
    </html>
  );
}
