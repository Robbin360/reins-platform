import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey) {
  throw new Error("SUPABASE_URL y SUPABASE_SERVICE_KEY son requeridas");
}

export const supabase = createClient(url, serviceKey);
