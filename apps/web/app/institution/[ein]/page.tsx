import type { Organization, Filing } from '@/types'
import InstitutionView from '@/components/institution/InstitutionView'

async function fetchInstitutionData(ein: string): Promise<{
  organization: Organization
  filings: Filing[]
} | null> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  try {
    const res = await fetch(`${baseUrl}/api/filings/${ein}`, { cache: 'no-store' })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function InstitutionPage({
  params,
}: {
  params: Promise<{ ein: string }>
}) {
  const { ein } = await params
  const data = await fetchInstitutionData(ein)

  if (!data) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          padding: '64px 24px',
          color: '#3D5A63',
          gap: '12px',
        }}
      >
        <div style={{ fontSize: '48px' }}>🔍</div>
        <h2 style={{ margin: 0, fontSize: '20px', color: '#10232B' }}>Organization not found</h2>
        <p style={{ margin: 0, fontSize: '14px' }}>
          No organization with EIN <strong>{ein}</strong> was found in the database.
        </p>
        <a
          href="/institution"
          style={{
            marginTop: '8px',
            padding: '8px 20px',
            backgroundColor: '#6F99CC',
            color: '#fff',
            borderRadius: '6px',
            textDecoration: 'none',
            fontSize: '14px',
          }}
        >
          Search Organizations
        </a>
      </div>
    )
  }

  return <InstitutionView organization={data.organization} filings={data.filings} />
}
