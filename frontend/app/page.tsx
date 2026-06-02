import UnifiedMapWrapper from '@/components/UnifiedMapWrapper'

type SearchParams = Promise<{ mode?: string }>

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const { mode } = await searchParams
  const initialMode = mode === 'dob' ? 'DOB' : 'HPD'

  return (
    <div className="w-screen h-dvh overflow-hidden">
      <UnifiedMapWrapper initialMode={initialMode} />
    </div>
  )
}
