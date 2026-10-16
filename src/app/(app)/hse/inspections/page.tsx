import { redirect } from "next/navigation";

export default function InspectionsPage() {
  redirect("/hse?tab=inspections");
}
