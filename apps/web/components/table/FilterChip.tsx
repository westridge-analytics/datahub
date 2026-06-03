'use client'

interface FilterChipProps {
  label: string
  value: string
  onRemove: () => void
}

export default function FilterChip({ label, value, onRemove }: FilterChipProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '9999px',
        border: '1px solid #AECAE0',
        backgroundColor: '#E4EEF8',
        color: '#10232B',
        fontSize: '12px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: '#3D5A63' }}>{label}:</span>
      <span>{value}</span>
      <button
        onClick={onRemove}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: '2px',
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: '#3D5A63',
          padding: 0,
          fontSize: '12px',
          lineHeight: 1,
        }}
        aria-label={`Remove ${label} filter`}
      >
        ×
      </button>
    </span>
  )
}
