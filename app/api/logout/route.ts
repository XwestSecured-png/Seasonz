import { redirectTo } from "@/lib/redirect";
import { COOKIE_NAME } from "@/lib/auth";

export async function POST() {
  const res = redirectTo("/login");
  res.cookies.delete(COOKIE_NAME);
  return res;
}
