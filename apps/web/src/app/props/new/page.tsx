import { redirect } from "next/navigation";

/** New prop now opens a clean canvas on the yard page. */
export default function NewPropPage() {
  redirect("/?view=new");
}
