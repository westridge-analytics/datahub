import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/layout/Sidebar';
import SessionProvider from '@/components/SessionProvider';
import { auth } from '@/auth';

export const metadata: Metadata = {
  title: '990 Research',
  description: 'IRS Form 990 data research and analysis platform',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth()
  const showShell = !!session

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
        <SessionProvider>
        {showShell && <Sidebar />}
        <main
          style={{
            marginLeft: showShell ? '220px' : '0',
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
        </SessionProvider>
      </body>
    </html>
  );
}
