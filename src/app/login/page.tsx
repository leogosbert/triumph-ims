import { getBrand } from "@/lib/brand-server";
import { onAdminHost } from "@/lib/hosts-server";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

/**
 * Sign in / create an account. The company brand remembered on this device is read from its cookie
 * here, on the server, so its logo is in the first paint instead of swapping in after LeMoSp's.
 */
export default async function LoginPage() {
  const brand = (await onAdminHost()) ? null : await getBrand();
  return <LoginForm brandKey={brand?.key ?? null} />;
}
