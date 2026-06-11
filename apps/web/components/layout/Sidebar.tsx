'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';

const NAV_ITEMS = [
  {
    label: 'Overview',
    href: '/',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 1h6v6H1V1zm8 0h6v6H9V1zM1 9h6v6H1V9zm8 0h6v6H9V9z" opacity="0.85" />
      </svg>
    ),
  },
  {
    label: 'Main Data',
    href: '/data',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 3h14v2H1V3zm0 4h14v2H1V7zm0 4h14v2H1v-2z" opacity="0.85" />
      </svg>
    ),
  },
  {
    label: 'Institution Analysis',
    href: '/institution',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1l7 4v1H1V5l7-4zm-5 6h2v5H3V7zm3 0h2v5H6V7zm3 0h2v5H9V7zm3 0h2v5h-2V7zM1 13h14v2H1v-2z" opacity="0.85" />
      </svg>
    ),
  },
  {
    label: 'Visualization',
    href: '/visualization',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 13L5 7l3 3 3-5 4 8H1z" opacity="0.85" />
      </svg>
    ),
  },
  {
    label: 'Cohorts',
    href: '/cohorts',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="4" cy="5" r="2.5" opacity="0.85" />
        <circle cx="12" cy="5" r="2.5" opacity="0.85" />
        <path d="M0 13c0-2.5 1.8-4 4-4s4 1.5 4 4H0zm8 0c0-2.5 1.8-4 4-4s4 1.5 4 4H8z" opacity="0.85" />
      </svg>
    ),
  },
  {
    label: 'Ingest Data',
    href: '/admin/ingest',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1L3 7h3v5h4V7h3L8 1z" opacity="0.85" />
        <path d="M2 13h12v2H2v-2z" opacity="0.65" />
      </svg>
    ),
  },
  {
    label: 'Users',
    href: '/admin/users',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="8" cy="5" r="3" opacity="0.85" />
        <path d="M2 13c0-3 2.7-5 6-5s6 2 6 5H2z" opacity="0.85" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  async function handleSignOut() {
    await signOut({ redirect: false })
    router.push('/login')
    router.refresh()
  }

  return (
    <aside
      style={{
        width: '220px',
        minWidth: '220px',
        backgroundColor: '#203E46',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 40,
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '20px 16px 16px',
          borderBottom: '1px solid rgba(122,174,187,0.2)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div
            style={{
              width: '28px',
              height: '28px',
              backgroundColor: '#6F99CC',
              borderRadius: '5px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="white">
              <path d="M2 2h12v12H2V2zm1 1v10h10V3H3zm2 2h6v1H5V5zm0 2h6v1H5V7zm0 2h4v1H5V9z" />
            </svg>
          </div>
          <span
            style={{
              color: '#F2F4F1',
              fontWeight: 600,
              fontSize: '14px',
              letterSpacing: '0.01em',
            }}
          >
            990 Research
          </span>
        </div>
      </div>

      {/* Nav items */}
      <nav style={{ padding: '8px 0', flex: 1 }}>
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 16px',
                margin: '1px 6px',
                borderRadius: '5px',
                textDecoration: 'none',
                fontSize: '13px',
                fontWeight: isActive ? 500 : 400,
                color: isActive ? '#F2F4F1' : '#7AAEBB',
                backgroundColor: isActive ? 'rgba(242,244,241,0.1)' : 'transparent',
                transition: 'background-color 0.1s, color 0.1s',
              }}
            >
              <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.75 }}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        style={{
          padding: '10px 16px',
          borderTop: '1px solid rgba(122,174,187,0.2)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        {session?.user?.email && (
          <div style={{ fontSize: '11px', color: 'rgba(122,174,187,0.8)', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.user.email}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '10px', color: 'rgba(122,174,187,0.5)' }}>
            IRS SOI · FY 2010–2023
          </span>
          <button
            onClick={handleSignOut}
            style={{
              fontSize: '10px',
              color: 'rgba(122,174,187,0.7)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 0',
              textDecoration: 'underline',
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
