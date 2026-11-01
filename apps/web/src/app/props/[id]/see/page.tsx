import { redirect } from "next/navigation";

/** Attaching and checking a prop now live in its Controller fold on the yard page. */
export default async function PropControllerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/?prop=${encodeURIComponent(id)}&fold=controller`);
}
