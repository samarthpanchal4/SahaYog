let session = null;
let workersCache = []; // all verified workers, joined with profile

function showMsg(text, kind){
  document.getElementById("msgSlot").innerHTML = `<div class="msg ${kind}">${text}</div>`;
  setTimeout(() => { document.getElementById("msgSlot").innerHTML = ""; }, 4000);
}

async function boot(){
  session = await requireSession(["household"]);
  if (!session) return;

  document.getElementById("whoName").textContent = session.profile.full_name;
  document.getElementById("greetHeading").textContent = "Namaste, " + session.profile.full_name.split(" ")[0];
  wireLogout("logoutBtn");

  const savedAddress = localStorage.getItem("sahayog_home_address");
  if (savedAddress) document.getElementById("fAddress").value = savedAddress;

  const catSel = document.getElementById("fCategory");
  catSel.innerHTML = Object.entries(SERVICE_CATALOG)
    .map(([key, v]) => `<option value="${key}">${v.label} · ${formatINR(v.price)}</option>`).join("");
  catSel.addEventListener("change", refreshWorkerOptions);

  document.getElementById("fWorker").addEventListener("change", updatePriceDisplay);

  // sensible default date/time: tomorrow, 10am
  const dt = new Date(); dt.setDate(dt.getDate() + 1); dt.setHours(10,0,0,0);
  document.getElementById("fDate").value = dt.toISOString().slice(0,16);

  await loadWorkers();
  refreshWorkerOptions();
  updatePriceDisplay();
  await loadBookings();

  document.getElementById("bookingForm").addEventListener("submit", submitBooking);

  // light polling so booking status updates without a manual refresh
  setInterval(loadBookings, 8000);
}

async function loadWorkers(){
  const { data, error } = await sb
    .from("workers")
    .select("profile_id, skill_category, verified, rating, jobs_completed, cooperative_id, profiles(full_name), cooperatives(name)")
    .eq("verified", true);
  if (error){ console.error(error); return; }
  workersCache = data;
}

function refreshWorkerOptions(){
  const category = document.getElementById("fCategory").value;
  const sel = document.getElementById("fWorker");
  const matches = workersCache.filter(w => w.skill_category === category);

  if (matches.length === 0){
    sel.innerHTML = `<option value="">No verified workers yet in this category</option>`;
    document.getElementById("workerHint").textContent = "Try another category, or check back soon.";
  } else {
    sel.innerHTML = matches.map(w =>
      `<option value="${w.profile_id}">${w.profiles.full_name} · ${w.rating}★ · ${w.jobs_completed} jobs</option>`
    ).join("");
    document.getElementById("workerHint").textContent = `Verified by ${matches[0].cooperatives?.name || "their cooperative"}.`;
  }
  updatePriceDisplay();
}

function updatePriceDisplay(){
  const category = document.getElementById("fCategory").value;
  document.getElementById("fPrice").textContent = SERVICE_CATALOG[category] ? formatINR(SERVICE_CATALOG[category].price) : "—";
}

async function submitBooking(e){
  e.preventDefault();
  const btn = document.getElementById("bookBtn");
  const workerSel = document.getElementById("fWorker");
  if (!workerSel.value){ showMsg("No worker selected for this category.", "error"); return; }

  btn.disabled = true; btn.textContent = "Confirming…";

  const category = document.getElementById("fCategory").value;
  const worker = workersCache.find(w => w.profile_id === workerSel.value);

  const { error } = await sb.from("bookings").insert({
    household_id: session.user.id,
    worker_id: workerSel.value,
    cooperative_id: worker.cooperative_id,
    service_category: category,
    address: document.getElementById("fAddress").value.trim(),
    scheduled_time: new Date(document.getElementById("fDate").value).toISOString(),
    price: SERVICE_CATALOG[category].price,
    status: "pending",
  });

  btn.disabled = false; btn.textContent = "Confirm booking";

  if (error){ console.error(error); showMsg("Couldn't create the booking: " + error.message, "error"); return; }
  showMsg("Booking sent — waiting for the worker to accept.", "ok");
  loadBookings();
}

async function loadBookings(){
  const { data, error } = await sb
    .from("bookings")
    .select("*, profiles!bookings_worker_id_fkey(full_name)")
    .eq("household_id", session.user.id)
    .order("created_at", { ascending: false });

  const list = document.getElementById("bookingsList");
  if (error){ console.error(error); list.innerHTML = `<div class="empty-state">Couldn't load bookings.</div>`; return; }

  if (data.length === 0){
    list.innerHTML = `<div class="empty-state">No bookings yet — book your first service on the left.</div>`;
    return;
  }

  list.innerHTML = data.map(b => `
    <div class="job-card">
      <div class="top-row">
        <span class="service">${SERVICE_CATALOG[b.service_category]?.label || b.service_category}</span>
        <span class="pill-status ${b.status}">${b.status}</span>
      </div>
      <div class="loc">${b.profiles?.full_name || "Worker"} · ${b.address} · ${formatWhen(b.scheduled_time)}</div>
      <div class="loc" style="margin-top:6px; font-weight:600; color:var(--primary-dark);">${formatINR(b.price)}</div>
      ${(b.status === "accepted" || b.status === "completed") ? `<div class="actions"><button class="btn btn-outline" data-dispute="${b.id}">Report an issue</button></div>` : ""}
    </div>
  `).join("");

  list.querySelectorAll("[data-dispute]").forEach(btn => btn.addEventListener("click", () => raiseDispute(btn.dataset.dispute)));
}

async function raiseDispute(bookingId){
  const description = prompt("Briefly describe the issue — this goes straight to the cooperative.");
  if (!description) return;

  const { error: dErr } = await sb.from("disputes").insert({
    booking_id: bookingId,
    raised_by: session.user.id,
    description,
  });
  if (dErr){ showMsg("Couldn't submit: " + dErr.message, "error"); return; }

  const { error: bErr } = await sb.from("bookings").update({ status: "disputed" }).eq("id", bookingId);
  if (bErr) console.error(bErr);

  showMsg("Reported to your cooperative.", "ok");
  loadBookings();
}

boot();
