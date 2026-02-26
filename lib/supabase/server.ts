import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type CookieStore = {
  getAll: () => { name: string; value: string }[];
  set: (name: string, value: string, options?: any) => void;
};

async function getCookieStore(): Promise<CookieStore> {
  const c = cookies() as any;
  // Some Next typings/envs treat cookies() as Promise-like
  return typeof c?.then === "function" ? await c : c;
}

export async function supabaseServer() {
  const cookieStore = await getCookieStore();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}