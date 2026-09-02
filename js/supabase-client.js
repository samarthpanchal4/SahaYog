// ============================================================
// Paste your own project's values here (Supabase → Project
// Settings → API). The anon/public key is safe to expose in
// client-side code — it only allows what your RLS policies allow.
// ============================================================
const SUPABASE_URL = "https://zaisykarasyhgiwtkgie.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphaXN5a2FyYXN5aGdpd3RrZ2llIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyOTUzNDcsImV4cCI6MjEwMzg3MTM0N30._VQwCgoSqDVpUwck19ykRXaIzq3f5PdaxXwtGEU8n-8";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Fixed cooperative rates, shown to households before they book
// and split transparently with workers. Mirrors the pitch deck's
// "fixed fair-wage bands" promise — change these to taste.
const SERVICE_CATALOG = {
  cleaning:   { label: "Home cleaning",  price: 520 },
  cooking:    { label: "Cooking",        price: 450 },
  plumbing:   { label: "Plumbing",       price: 480 },
  eldercare:  { label: "Elder care",     price: 600 },
  electrical: { label: "Electrical",     price: 550 },
  garden:     { label: "Garden",         price: 400 },
};
const COOP_FEE_RATE = 0.10; // 10% service fee stays with the cooperative

function initials(name){
  return (name || "?").trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase() || "").join("");
}
function formatINR(n){
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function formatWhen(iso){
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day:"numeric", month:"short" }) + ", " +
         d.toLocaleTimeString("en-IN", { hour:"numeric", minute:"2-digit" });
}

// Every app.html page calls this first. Sends anonymous visitors
// back to the login page, and hands back {user, profile}.
async function requireSession(allowedRoles){
  const { data: { session } } = await sb.auth.getSession();
  if (!session){
    window.location.href = "index.html";
    return null;
  }
  const { data: profile, error } = await sb
    .from("profiles")
    .select("*, cooperatives(name)")
    .eq("id", session.user.id)
    .single();

  if (error || !profile){
    console.error(error);
    await sb.auth.signOut();
    window.location.href = "index.html";
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(profile.role)){
    // signed in, but this isn't their page — send them to the right one
    window.location.href = profile.role + ".html";
    return null;
  }
  return { user: session.user, profile };
}

function wireLogout(btnId){
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener("click", async () => {
    await sb.auth.signOut();
    window.location.href = "index.html";
  });
}
