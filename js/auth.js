const msgSlot = document.getElementById("msgSlot");
function showMsg(text, kind){
  msgSlot.innerHTML = `<div class="msg ${kind}">${text}</div>`;
}
function clearMsg(){ msgSlot.innerHTML = ""; }

// ---------- tabs ----------
const tabButtons = document.querySelectorAll("#authTabs button");
tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    tabButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.getElementById("loginForm").style.display = tab === "login" ? "block" : "none";
    document.getElementById("signupForm").style.display = tab === "signup" ? "block" : "none";
    clearMsg();
  });
});

// ---------- role-conditional fields ----------
const roleRadios = document.querySelectorAll('input[name="role"]');
function syncRoleFields(){
  const role = document.querySelector('input[name="role"]:checked').value;
  document.getElementById("workerFields").style.display = role === "worker" ? "block" : "none";
  document.getElementById("householdFields").style.display = role === "household" ? "block" : "none";
  document.getElementById("adminFields").style.display = role === "admin" ? "block" : "none";
}
roleRadios.forEach(r => r.addEventListener("change", syncRoleFields));
syncRoleFields();

// populate cooperative dropdown for worker signup
async function loadCooperatives(){
  const sel = document.getElementById("suCoopSelect");
  const { data, error } = await sb.from("cooperatives").select("id,name").order("name");
  if (error){ console.error(error); return; }
  sel.innerHTML = data.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}
loadCooperatives();

// ---------- redirect if already signed in ----------
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session){
    const { data: profile } = await sb.from("profiles").select("role").eq("id", session.user.id).single();
    if (profile) window.location.href = profile.role + ".html";
  }
})();

// ---------- login ----------
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMsg();
  const btn = document.getElementById("loginBtn");
  btn.disabled = true; btn.textContent = "Signing in…";

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error){
    showMsg(error.message, "error");
    btn.disabled = false; btn.textContent = "Sign in";
    return;
  }
  const { data: profile, error: pErr } = await sb.from("profiles").select("role").eq("id", data.user.id).single();
  if (pErr || !profile){
    showMsg("Signed in, but no profile was found for this account.", "error");
    btn.disabled = false; btn.textContent = "Sign in";
    return;
  }
  window.location.href = profile.role + ".html";
});

// ---------- signup ----------
document.getElementById("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMsg();
  const btn = document.getElementById("signupBtn");
  btn.disabled = true; btn.textContent = "Creating account…";

  const role = document.querySelector('input[name="role"]:checked').value;
  const full_name = document.getElementById("suName").value.trim();
  const phone = document.getElementById("suPhone").value.trim();
  const email = document.getElementById("suEmail").value.trim();
  const password = document.getElementById("suPassword").value;

  try{
    // Worker picks an existing cooperative — no insert needed, so this can
    // stay before signUp. Admin's cooperative doesn't exist yet, so it has
    // to be created *after* signUp: RLS requires an authenticated session
    // to insert into `cooperatives`, and we're still anonymous beforehand.
    let cooperative_id = role === "worker" ? document.getElementById("suCoopSelect").value : null;

    if (role === "admin" && !document.getElementById("suCoopName").value.trim()){
      throw new Error("Enter a name for your cooperative.");
    }

    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name, role, phone, cooperative_id } }
    });
    if (error) throw error;

    if (!data.session){
      // Email confirmation is still on for this project — nothing below can
      // run yet (no authenticated session), so stop here and let them
      // finish setup after they confirm and sign in.
      showMsg("Account created. Check your email to confirm, then sign in. (Cooperative/worker setup will need an admin follow-up — see README.)", "ok");
      document.querySelector('#authTabs button[data-tab="login"]').click();
      return;
    }

    // Admin: now authenticated, so this insert passes RLS. Create the
    // cooperative, then attach it to our own just-created profile.
    if (role === "admin" && data.user){
      const coopName = document.getElementById("suCoopName").value.trim();
      const { data: coop, error: coopErr } = await sb.from("cooperatives").insert({ name: coopName }).select().single();
      if (coopErr) throw coopErr;
      const { error: profErr } = await sb.from("profiles").update({ cooperative_id: coop.id }).eq("id", data.user.id);
      if (profErr) throw profErr;
    }

    // Worker also gets a row in `workers` (skill, verified=false, cooperative)
    if (role === "worker" && data.user){
      const skill_category = document.getElementById("suSkill").value;
      const { error: wErr } = await sb.from("workers").insert({
        profile_id: data.user.id,
        cooperative_id,
        skill_category,
      });
      if (wErr) throw wErr;
    }

    // Household's home address is just a handy prefill for booking forms —
    // stored locally, not in the database.
    if (role === "household"){
      const addr = document.getElementById("suAddress").value.trim();
      if (addr) localStorage.setItem("sahayog_home_address", addr);
    }

    window.location.href = role + ".html";
  } catch(err){
    console.error(err);
    showMsg(err.message || "Something went wrong. Please try again.", "error");
  } finally {
    btn.disabled = false; btn.textContent = "Create account";
  }
});
