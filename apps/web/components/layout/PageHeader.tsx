import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div
      style={{
        backgroundColor: '#D7E8EE',
        borderBottom: '1px solid #BDD3DC',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        minHeight: '52px',
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: '15px',
            fontWeight: 600,
            color: '#10232B',
            lineHeight: 1.3,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              margin: '2px 0 0',
              fontSize: '12px',
              color: '#3D5A63',
              lineHeight: 1.4,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
