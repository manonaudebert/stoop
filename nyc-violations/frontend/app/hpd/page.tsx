import HpdComplaintsMapWrapper from '@/components/HpdComplaintsMapWrapper'

export const metadata = { title: 'stoop · HPD Complaints' }

export default function HpdPage() {
  return (
    <main className="w-full h-screen overflow-hidden">
      <HpdComplaintsMapWrapper />
    </main>
  )
}
