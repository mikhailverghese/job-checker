import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Job Checker Dashboard',
  description: 'Weighted job matches in one place.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Job Checker',
  },
};

export const viewport: Viewport = {
  themeColor: '#182033',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
