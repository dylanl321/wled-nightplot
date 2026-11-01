import { redirect } from "next/navigation";

/** Editing a prop now opens its own canvas on the yard page. */
export default async function EditPropPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/?prop=${encodeURIComponent(id)}&view=edit`);
}
