let session = null;
let coopId = null;

function showMsg(text, kind){
  document.getElementById("msgSlot").innerHTML = `<div class="msg ${kind}">${text}</div>`;
  setTimeout(() => { document.getElementById("msgSlot").innerHTML = ""; }, 4000);
}

async function boot(){
  session = await requireSession(["admin"]);
  if (!session) return;

  coopId = session.profile.cooperative_id;
  document.getElementById("whoName").textContent = session.profile.full_name;
  document.getElementById("coopHeading").textContent = session.profile.cooperatives?.name || "Cooperative overview";
  wireLogout("logoutBtn");

  if (!coopId){
    showMsg("Your account isn't linked to a cooperative yet.", "error");
    return;
  }

  await loadAll();
  setInterval(loadAll, 8000);
}

async function loadAll(){
  await Promise.all([loadStats(), loadVerifyQueue(), loadDisputes(), loadActivity()]);
}

async function loadStats(){
  const today = new Date(); today.setHours(0,0,0,0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);

  const [{ count: workerCount }, { count: jobsToday }, { data: monthCompleted }, { data: disputes }] = await Promise.all([
    sb.from("workers").select("*", { count: "exact", head: true }).eq("cooperative_id", coopId).eq("verified", true),
    sb.from("bookings").select("*", { count: "exact", head: true }).eq("cooperative_id", coopId).gte("created_at", today.toISOString()),
    sb.from("bookings").select("price").eq("cooperative_id", coopId).eq("status", "completed").gte("created_at", monthStart.toISOString()),
    sb.from("disputes").select("id, bookings!inner(cooperative_id)").eq("status", "open").eq("bookings.cooperative_id", coopId),
  ]);

  document.getElementById("statWorkers").textContent = workerCount ?? 0;
  document.getElementById("statJobsToday").textContent = jobsToday ?? 0;
  document.getElementById("statDisputes").textContent = disputes?.length ?? 0;

  const revenue = (monthCompleted || []).reduce((sum, b) => sum + Number(b.price) * COOP_FEE_RATE, 0);
  document.getElementById("statRevenue").textContent = formatINR(revenue);
}

async function loadVerifyQueue(){
  const { data, error } = await sb
    .from("workers")
    .select("profile_id, skill_category, verified, profiles(full_name, phone)")
    .eq("cooperative_id", coopId)
    .eq("verified", false);

  const el = document.getElementById("verifyQueue");
  if (error){ console.error(error); el.innerHTML = `<div class="empty-state">Couldn't load the queue.</div>`; return; }
  if (data.length === 0){ el.innerHTML = `<div class="empty-state">No pending applications.</div>`; return; }

  el.innerHTML = data.map(w => `
    <div class="worker-card" style="justify-content:space-between;">
      <div class="info">
        <div class="name">${w.profiles?.full_name || "Worker"}</div>
        <div class="meta">${SERVICE_CATALOG[w.skill_category]?.label || w.skill_category} · ${w.profiles?.phone || "no phone on file"}</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-outline btn-sm" data-reject="${w.profile_id}">Reject</button>
        <button class="btn btn-primary btn-sm" data-approve="${w.profile_id}">Approve</button>
      </div>
    </div>
  `).join("");

  el.querySelectorAll("[data-approve]").forEach(btn => btn.addEventListener("click", () => approveWorker(btn.dataset.approve)));
  el.querySelectorAll("[data-reject]").forEach(btn => btn.addEventListener("click", () => rejectWorker(btn.dataset.reject)));
}

async function approveWorker(profileId){
  const { error } = await sb.from("workers").update({ verified: true }).eq("profile_id", profileId);
  if (error){ showMsg("Couldn't approve: " + error.message, "error"); return; }
  showMsg("Worker approved.", "ok");
  loadAll();
}

async function rejectWorker(profileId){
  if (!confirm("Reject this application? The worker will need to re-apply.")) return;
  const { error } = await sb.from("workers").delete().eq("profile_id", profileId);
  if (error){ showMsg("Couldn't reject: " + error.message, "error"); return; }
  showMsg("Application rejected.", "ok");
  loadAll();
}

async function loadDisputes(){
  const { data, error } = await sb
    .from("disputes")
    .select("id, description, status, raised_by, bookings!inner(id, cooperative_id, service_category, address, household_id, worker_id, profiles!bookings_household_id_fkey(full_name), profiles_worker:profiles!bookings_worker_id_fkey(full_name))")
    .eq("status", "open")
    .eq("bookings.cooperative_id", coopId);

  const el = document.getElementById("disputeList");
  if (error){ console.error(error); el.innerHTML = `<div class="empty-state">Couldn't load disputes.</div>`; return; }
  if (data.length === 0){ el.innerHTML = `<div class="empty-state">No open disputes.</div>`; return; }

  el.innerHTML = data.map(d => `
    <div class="dispute-box" style="margin-bottom:12px;">
      <h4>${SERVICE_CATALOG[d.bookings.service_category]?.label || d.bookings.service_category} · ${d.bookings.address}</h4>
      <div class="statement">
        <span class="src">${d.bookings.household_id === d.raised_by ? "Household" : "Worker"}</span>
        ${d.description}
      </div>
      <div style="display:flex; gap:8px; margin-top:10px;">
        <button class="btn btn-primary btn-sm" data-resolve="${d.id}" style="flex:1;">Mark resolved</button>
      </div>
    </div>
  `).join("");

  el.querySelectorAll("[data-resolve]").forEach(btn => btn.addEventListener("click", () => resolveDispute(btn.dataset.resolve)));
}

async function resolveDispute(disputeId){
  const { error } = await sb.from("disputes").update({ status: "resolved" }).eq("id", disputeId);
  if (error){ showMsg("Couldn't resolve: " + error.message, "error"); return; }
  showMsg("Dispute marked resolved.", "ok");
  loadAll();
}

async function loadActivity(){
  const { data, error } = await sb
    .from("bookings")
    .select("id, service_category, address, status, created_at, profiles!bookings_household_id_fkey(full_name), profiles_worker:profiles!bookings_worker_id_fkey(full_name)")
    .eq("cooperative_id", coopId)
    .order("created_at", { ascending: false })
    .limit(8);

  const el = document.getElementById("activityList");
  if (error){ console.error(error); el.innerHTML = `<div class="empty-state">Couldn't load activity.</div>`; return; }
  if (data.length === 0){ el.innerHTML = `<div class="empty-state">No bookings yet.</div>`; return; }

  el.innerHTML = data.map(b => `
    <div class="table-row">
      <div>
        <div class="who">${b.profiles?.full_name || "Household"} → ${b.profiles_worker?.full_name || "Worker"}</div>
        <div class="when">${SERVICE_CATALOG[b.service_category]?.label || b.service_category} · ${b.address}</div>
      </div>
      <span class="pill-status ${b.status}">${b.status}</span>
    </div>
  `).join("");
}

boot();
