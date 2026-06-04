import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/layout/Sidebar';

export const metadata: Metadata = {
  title: '990 Research',
  description: 'IRS Form 990 data research and analysis platform',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ height: '100%' }}>
      <body
        style={{
          margin: 0,
          padding: 0,
          height: '100%',
          display: 'flex',
          fontFamily: "'Avenir Next LT Pro', system-ui, sans-serif",
          backgroundColor: '#F2F4F1',
          color: '#10232B',
        }}
      >
        <Sidebar />
        <main
          style={{
            marginLeft: '220px',
            flex: 1,
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#F2F4F1',
            overflow: 'hidden',
            minWidth: 0,
          }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}
