import { notFound } from 'next/navigation';
import { CREATIVE_MAPPING_AVAILABLE } from '@/lib/creative-performance-contract';
import Link from 'next/link';
import DashboardCreativeMappings from '@/components/admin/DashboardCreativeMappings';
export default async function Page({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { if (!CREATIVE_MAPPING_AVAILABLE) notFound(); const { id } = await params; return <section className="space-y-4"><Link href={`/admin/dashboards/${id}/edit`} className="text-blue-600">Back to dashboard settings</Link><h1 className="text-2xl font-semibold">Creative UTM mappings</h1><DashboardCreativeMappings dashboardId={id}/></section>; }
