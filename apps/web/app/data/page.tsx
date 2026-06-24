import { Suspense } from 'react'
import MainDataTable from '@/components/table/MainDataTable'

export default function DataPage() {
  return (
    <Suspense>
      <MainDataTable />
    </Suspense>
  )
}
