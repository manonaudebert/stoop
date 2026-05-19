import HpdMapWrapper from '@/components/HpdMapWrapper'

export const metadata = { title: 'stoop · HPD Violations' }

export default function HpdPage() {
  return (
    <main className="w-full h-screen overflow-hidden">
      <HpdMapWrapper />
    </main>
  )
}
