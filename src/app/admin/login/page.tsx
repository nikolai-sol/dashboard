import AdminLoginForm from "@/components/admin/AdminLoginForm";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }> | { next?: string };
}) {
  const params = await Promise.resolve(searchParams);
  return <AdminLoginForm nextPath={params?.next || "/admin/dashboards"} />;
}
