"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext, noAccess } from "@/lib/context";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { can } from "@/lib/roles";

const UUID = /^[0-9a-f-]{36}$/i;

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

function refresh(slug?: string | null) {
  revalidatePath("/catalogue");
  revalidatePath("/catalogue/products");
  if (slug) revalidatePath(`/c/${slug}`);
}

async function slugOf(supabase: Awaited<ReturnType<typeof getAppContext>>["supabase"], companyId: string) {
  const { data } = await supabase.from("catalogue_settings").select("slug").eq("company_id", companyId).maybeSingle();
  return (data?.slug as string | undefined) ?? null;
}

export async function saveCatalogueSettings(form: FormData) {
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) fail("/catalogue", "Only management can change the online catalogue.");
  const { data: slug, error } = await supabase.rpc("catalogue_save_settings", {
    p_company: company.id,
    p: {
      slug: str(form, "slug").toLowerCase(),
      published: form.get("published") === "on",
      headline: optional(form, "headline"),
      intro: optional(form, "intro"),
      seo_description: optional(form, "seo_description"),
      show_phone: form.get("show_phone") === "on",
      show_email: form.get("show_email") === "on",
      show_address: form.get("show_address") === "on",
      whatsapp: optional(form, "whatsapp"),
    },
  });
  if (error) fail("/catalogue", error.message);
  refresh(slug as string);
  redirect(withNotice("/catalogue", { msg: form.get("published") === "on" ? "Saved. The catalogue is public at its address." : "Saved. The catalogue is not public yet." }));
}

export async function setCatalogueProduct(form: FormData) {
  const back = str(form, "back").startsWith("/catalogue") ? str(form, "back") : "/catalogue/products";
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) fail(back, "Only management decides what the online catalogue shows.");
  const id = str(form, "product_id");
  if (!UUID.test(id)) fail(back, "Not allowed.");
  const p: Record<string, unknown> = { public: form.get("public") === "on", show_price: form.get("show_price") === "on" };
  if (form.has("summary")) p.summary = optional(form, "summary");
  const sort = str(form, "sort");
  if (/^-?\d{1,6}$/.test(sort)) p.sort = sort;
  const { error } = await supabase.rpc("catalogue_set_product", { p_product: id, p });
  if (error) fail(back, error.message);
  refresh(await slugOf(supabase, company.id));
  redirect(withNotice(`${back}#p-${id}`, { msg: "Saved." }));
}

export async function setCatalogueCategory(form: FormData) {
  const back = "/catalogue/products";
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) fail(back, "Only management decides what the online catalogue shows.");
  const cat = str(form, "category");
  const { data, error } = await supabase.rpc("catalogue_set_category", {
    p_company: company.id,
    p_category: cat === "*" ? null : cat,
    p_public: str(form, "public") === "1",
  });
  if (error) fail(back, error.message);
  refresh(await slugOf(supabase, company.id));
  redirect(withNotice(cat === "*" ? back : `${back}?category=${encodeURIComponent(cat)}`, { msg: `${data ?? 0} products updated.` }));
}

/** After the browser uploaded the photo to catalogue/<company>/<product>/…; null removes it. */
export async function setCataloguePhoto(productId: string, path: string | null): Promise<{ error?: string }> {
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) return { error: "Only management changes catalogue photos." };
  if (!UUID.test(productId)) return { error: "Not allowed." };
  const { data: old } = await supabase.from("catalogue_products").select("photo_path").eq("product_id", productId).maybeSingle();
  const { error } = await supabase.rpc("catalogue_set_photo", { p_product: productId, p_path: path });
  if (error) return { error: friendlyError(error.message) };
  if (old?.photo_path && old.photo_path !== path) await supabase.storage.from("catalogue").remove([old.photo_path]);
  refresh(await slugOf(supabase, company.id));
  return {};
}

export async function setCatalogueDocument(form: FormData) {
  const back = str(form, "back").startsWith("/catalogue") ? str(form, "back") : "/catalogue/products";
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) fail(back, "Only management decides which papers are public.");
  const { error } = await supabase.rpc("catalogue_set_document", { p_document: str(form, "document_id"), p_public: str(form, "public") === "1" });
  if (error) fail(back, error.message);
  refresh(await slugOf(supabase, company.id));
  redirect(withNotice(back, { msg: str(form, "public") === "1" ? "Anyone can download it from the catalogue now." : "Private again." }));
}

export async function convertEnquiry(form: FormData) {
  const id = str(form, "id");
  const path = `/catalogue/enquiries/${id}`;
  const { supabase, roles } = await getAppContext();
  if (!can(roles, "seeCrm")) noAccess();
  const client = str(form, "client_id");
  const { data: rfq, error } = await supabase.rpc("catalogue_enquiry_convert", { p_enquiry: id, p_client: UUID.test(client) ? client : null });
  if (error) fail(path, error.message);
  revalidatePath("/catalogue/enquiries");
  revalidatePath("/rfqs");
  redirect(withNotice(`/rfqs/${rfq}`, { msg: "RFQ made from the catalogue request. Add prices to quote." }));
}

export async function closeEnquiry(form: FormData) {
  const id = str(form, "id");
  const path = `/catalogue/enquiries/${id}`;
  const { supabase, roles } = await getAppContext();
  if (!can(roles, "seeCrm")) noAccess();
  const { error } = await supabase.rpc("catalogue_enquiry_close", { p_enquiry: id, p_closed: str(form, "closed") === "1" });
  if (error) fail(path, error.message);
  revalidatePath("/catalogue/enquiries");
  redirect(withNotice(path, { msg: str(form, "closed") === "1" ? "Closed." : "Opened again." }));
}
