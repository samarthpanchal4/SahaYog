let session = null;
let workerRow = null;

function showMsg(text, kind){
  document.getElementById("msgSlot").innerHTML = `<div class="msg ${kind}">${text}</div>`;
  setTimeout(() => { document.getElementById("msgSlot").innerHTML = ""; }, 4000);
}

async function boot(){
  session = await requireSession(["worker"]);
  if (!session) return;

  document.getElementById("whoName").textContent = session.profile.full_name;
  document.getElementById("greetHeading").textContent = "Namaste, " + session.profile.full_name.split(" ")[0];
  wireLogout("logoutBtn");

  await loadWorkerRow();
  renderVerifyNote();
  renderAvailability();

  document.getElementById("availToggle").addEventListener("click", toggleAvailability);

  await loadEverything();
  setInterval(loadEverything, 8000);
}

async function loadWorkerRow(){
  const { data, error } = await sb.from("workers").select("*").eq("profile_id", session.user.id).single();
  if (error){ console.error(error); return; }
  workerRow = data;
}

function renderVerifyNote(){
  const note = document.getElementById("verifyNote");
  if (!workerRow) return;
  note.textContent = workerRow.verified
    ? `Verified ${SERVICE_CATALOG[workerRow.skill_category]?.label || workerRow.skill_category} worker · ${session.profile.cooperatives?.name || "your cooperative"}.`
    : `Your ${SERVICE_CATALOG[workerRow.skill_category]?.label || workerRow.skill_category} profile is awaiting verification from ${session.profile.cooperatives?.name || "your cooperative"}. You won't appear to households until then.`;
}

function renderAvailability(){
  document.getElementById("availSwitch").classList.toggle("on", !!workerRow?.available);
}

async function toggleAvailability(){
  if (!workerRow) return;
  const next = !workerRow.available;
  const { error } = await sb.from("workers").update({ available: next }).eq("profile_id", session.user.id);
  if (error){ showMsg("Couldn't update availability.", "error"); return; }
  workerRow.available = next;
  renderAvailability();
}

async function loadEverything(){
  const { data, error } = await sb
    .from("bookings")
    .select("*, profiles!bookings_household_id_fkey(full_name)")
    .eq("worker_id", session.user.id)
    .order("created_at", { ascending: false });

  if (error){ console.error(error); return; }

  renderPending(data.filter(b => b.status === "pending"));
  renderAccepted(data.filter(b => b.status === "accepted"));
  renderEarnings(data.filter(b => b.status === "completed"));
}

function renderPending(items){
  const el = document.getElementById("pendingList");
  if (items.length === 0){ el.innerHTML = `<div class="empty-state">No new requests right now.</div>`; return; }
  el.innerHTML = items.map(b => `
    <div class="job-card">
      <div class="top-row">
        <span class="service">${SERVICE_CATALOG[b.service_category]?.label || b.service_category}</span>
        <span class="pay">${formatINR(b.price)}</span>
      </div>
      <div class="loc">${b.profiles?.full_name || "Household"} · ${b.address} · ${formatWhen(b.scheduled_time)}</div>
      <div class="fee-note">You receive ${formatINR(b.price * (1 - COOP_FEE_RATE))} · ${formatINR(b.price * COOP_FEE_RATE)} goes to your cooperative's service fee</div>
      <div class="actions">
        <button class="btn btn-outline" data-decline="${b.id}">Decline</button>
        <button class="btn btn-primary" data-accept="${b.id}">Accept</button>
      </div>
    </div>
  `).join("");
  el.querySelectorAll("[data-accept]").forEach(btn => btn.addEventListener("click", () => setStatus(btn.dataset.accept, "accepted")));
  el.querySelectorAll("[data-decline]").forEach(btn => btn.addEventListener("click", () => setStatus(btn.dataset.decline, "declined")));
}

function renderAccepted(items){
  const el = document.getElementById("acceptedList");
  if (items.length === 0){ el.innerHTML = `<div class="empty-state">Nothing accepted yet.</div>`; return; }
  el.innerHTML = items.map(b => `
    <div class="job-card">
      <div class="top-row">
        <span class="service">${SERVICE_CATALOG[b.service_category]?.label || b.service_category}</span>
        <span class="pay">${formatINR(b.price)}</span>
      </div>
      <div class="loc">${b.profiles?.full_name || "Household"} · ${b.address} · ${formatWhen(b.scheduled_time)}</div>
      <div class="actions">
        <button class="btn btn-primary" data-complete="${b.id}">Mark complete</button>
      </div>
    </div>
  `).join("");
  el.querySelectorAll("[data-complete]").forEach(btn => btn.addEventListener("click", () => completeJob(btn.dataset.complete)));
}

async function setStatus(bookingId, status){
  const { error } = await sb.from("bookings").update({ status }).eq("id", bookingId);
  if (error){ showMsg("Couldn't update that request: " + error.message, "error"); return; }
  loadEverything();
}

async function completeJob(bookingId){
  const { error } = await sb.from("bookings").update({ status: "completed" }).eq("id", bookingId);
  if (error){ showMsg("Couldn't mark complete: " + error.message, "error"); return; }
  if (workerRow){
    await sb.from("workers").update({ jobs_completed: (workerRow.jobs_completed || 0) + 1 }).eq("profile_id", session.user.id);
    workerRow.jobs_completed = (workerRow.jobs_completed || 0) + 1;
  }
  showMsg("Job marked complete.", "ok");
  loadEverything();
}

function renderEarnings(completed){
  const today = new Date(); today.setHours(0,0,0,0);
  const todaysJobs = completed.filter(b => new Date(b.created_at) >= today);
  const todaysTotal = todaysJobs.reduce((sum,b) => sum + Number(b.price) * (1 - COOP_FEE_RATE), 0);

  document.getElementById("todayEarnings").textContent = formatINR(todaysTotal);
  document.getElementById("todayJobsLabel").textContent = `Earned today · ${todaysJobs.length} job${todaysJobs.length === 1 ? "" : "s"}`;

  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekJobs = completed.filter(b => new Date(b.created_at) >= weekAgo);
  const weekTotal = weekJobs.reduce((sum,b) => sum + Number(b.price) * (1 - COOP_FEE_RATE), 0);
  document.getElementById("weekTotal").textContent = formatINR(weekTotal);

  const weekList = document.getElementById("weekList");
  if (weekJobs.length === 0){
    weekList.innerHTML = `<div class="empty-state">No completed jobs in the last 7 days yet.</div>`;
  } else {
    weekList.innerHTML = weekJobs.map(b => `
      <div class="table-row">
        <div><div class="who">${SERVICE_CATALOG[b.service_category]?.label || b.service_category}</div><div class="when">${formatWhen(b.scheduled_time)}</div></div>
        <span style="font-weight:600; color:var(--primary-dark);">${formatINR(b.price * (1 - COOP_FEE_RATE))}</span>
      </div>
    `).join("");
  }
}

boot();
