import HpdComplaintsMapWrapper from '@/components/HpdComplaintsMapWrapper'

export const metadata = { title: 'Tenement · HPD Complaints' }

export default function HpdComplaintsPage() {
  return (
    <main className="w-full h-screen overflow-hidden">
      <HpdComplaintsMapWrapper />
    </main>
  )
}
