import Link from 'next/link';
import PageHeader from '@/components/layout/PageHeader';

const SECTION_CARDS = [
  {
    title: 'Main Data',
    href: '/data',
    description: 'Browse all 990 filings across organizations and fiscal years',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path d="M2 4h16v2H2V4zm0 5h16v2H2V9zm0 5h16v2H2v-2z" />
      </svg>
    ),
  },
  {
    title: 'Institution Analysis',
    href: '/institution',
    description: 'Deep-dive financial analysis for a single organization',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 1l9 5v1H1V6l9-5zM4 9h3v7H4V9zm4.5 0h3v7h-3V9zm4.5 0h3v7h-3V9zM1 17h18v2H1v-2z" />
      </svg>
    ),
  },
  {
    title: 'Visualization',
    href: '/visualization',
    description: 'Multi-org trend charts and cohort comparisons',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path d="M1 16L5 8l4 4 4-7 6 11H1z" />
      </svg>
    ),
  },
  {
    title: 'Cohorts',
    href: '/cohorts',
    description: 'Build and manage peer groups for benchmarking',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <circle cx="5" cy="6" r="3" />
        <circle cx="15" cy="6" r="3" />
        <path d="M0 16c0-3 2.2-5 5-5s5 2 5 5H0zm10 0c0-3 2.2-5 5-5s5 2 5 5h-10z" />
      </svg>
    ),
  },
];

const FLOW_SOURCES = ['IRS SOI CSVs', 'IRS EO BMF'];
const FLOW_SECTIONS = ['Main Data', 'Institution Analysis', 'Visualization', 'Cohorts'];

const REF_CARDS = [
  {
    title: 'UX Principles',
    items: ['Dense data display', 'Keyboard-navigable', 'Export-first'],
  },
  {
    title: 'Design Direction',
    items: ['Low-fidelity reference only', 'Apply codebase design system', 'Favor clarity over decoration'],
  },
  {
    title: 'Data Coverage',
    items: ['FY 2010–2023', 'Form 990 only', 'IRS SOI source'],
  },
];

export default function OverviewPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <PageHeader
        title="Overview"
        subtitle="990 Research — IRS Form 990 data platform"
      />

      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '32px' }}>

        {/* Section cards 2x2 grid */}
        <section>
          <h2
            style={{
              margin: '0 0 12px',
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#3D5A63',
            }}
          >
            Sections
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '12px',
            }}
          >
            {SECTION_CARDS.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                style={{ textDecoration: 'none' }}
              >
                <div
                  style={{
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #BDD3DC',
                    borderLeft: '3px solid #6F99CC',
                    borderRadius: '6px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    boxShadow: '0 1px 3px rgba(16,35,43,0.06)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: '#6F99CC', flexShrink: 0 }}>{card.icon}</span>
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: '#10232B',
                      }}
                    >
                      {card.title}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '12px',
                      color: '#3D5A63',
                      lineHeight: 1.5,
                    }}
                  >
                    {card.description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Data flow diagram */}
        <section>
          <h2
            style={{
              margin: '0 0 12px',
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#3D5A63',
            }}
          >
            Data Flow
          </h2>
          <div
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #BDD3DC',
              borderRadius: '6px',
              padding: '20px 24px',
              boxShadow: '0 1px 3px rgba(16,35,43,0.06)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0',
                overflowX: 'auto',
              }}
            >
              {/* Sources */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  flexShrink: 0,
                }}
              >
                {FLOW_SOURCES.map((src) => (
                  <div
                    key={src}
                    style={{
                      backgroundColor: '#D7E8EE',
                      border: '1px solid #BDD3DC',
                      borderRadius: '4px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 500,
                      color: '#10232B',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {src}
                  </div>
                ))}
              </div>

              <FlowArrow />
              <FlowBox label="Ingestion Pipeline" accent />
              <FlowArrow />
              <FlowBox label="Postgres" />
              <FlowArrow />

              {/* App sections */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  flexShrink: 0,
                }}
              >
                {FLOW_SECTIONS.map((sec) => (
                  <div
                    key={sec}
                    style={{
                      backgroundColor: '#E4EEF8',
                      border: '1px solid #AECAE0',
                      borderRadius: '4px',
                      padding: '4px 10px',
                      fontSize: '12px',
                      fontWeight: 500,
                      color: '#10232B',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {sec}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Reference cards */}
        <section>
          <h2
            style={{
              margin: '0 0 12px',
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#3D5A63',
            }}
          >
            Reference
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '12px',
            }}
          >
            {REF_CARDS.map((card) => (
              <div
                key={card.title}
                style={{
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #BDD3DC',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(16,35,43,0.06)',
                }}
              >
                <div
                  style={{
                    padding: '8px 14px',
                    borderBottom: '1px solid #BDD3DC',
                    backgroundColor: '#F2F4F1',
                  }}
                >
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#6F99CC',
                    }}
                  >
                    {card.title}
                  </span>
                </div>
                <ul
                  style={{
                    margin: 0,
                    padding: '10px 14px',
                    listStyle: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  {card.items.map((item) => (
                    <li
                      key={item}
                      style={{
                        fontSize: '12px',
                        color: '#3D5A63',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span
                        style={{
                          width: '4px',
                          height: '4px',
                          borderRadius: '50%',
                          backgroundColor: '#6F99CC',
                          flexShrink: 0,
                        }}
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '32px',
          height: '2px',
          backgroundColor: '#BDD3DC',
        }}
      >
        <div
          style={{
            position: 'absolute',
            right: -1,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 0,
            height: 0,
            borderTop: '4px solid transparent',
            borderBottom: '4px solid transparent',
            borderLeft: '6px solid #BDD3DC',
          }}
        />
      </div>
    </div>
  );
}

function FlowBox({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <div
      style={{
        backgroundColor: accent ? '#6F99CC' : '#D7E8EE',
        border: `1px solid ${accent ? '#5580B0' : '#BDD3DC'}`,
        borderRadius: '4px',
        padding: '8px 14px',
        fontSize: '12px',
        fontWeight: 600,
        color: accent ? '#FFFFFF' : '#10232B',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
}
