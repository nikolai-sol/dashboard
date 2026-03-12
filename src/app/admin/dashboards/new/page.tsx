import DashboardWizard from "@/components/admin/DashboardWizard";

export default function NewDashboardPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Create Dashboard</h1>
      <DashboardWizard />
    </section>
  );
}
