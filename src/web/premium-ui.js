export function premiumHtml(quota) {
  if (quota && quota.premium) return "";
  return `<section class="card"><h2>Premium</h2><p class="hint">Future Malaysian payment gateway. No charge is made in this version.</p><button type="button" id="premiumCheckout">Review the payment hook</button></section>`;
}

export function bindPremium(ctx) {
  const button = document.getElementById("premiumCheckout");
  if (!button) return;
  button.addEventListener("click", () => ctx.run(async () => {
    const base = String(ctx.config.workerUrl || "").replace(/\/$/, "");
    const res = await fetch(base + "/v1/premium/checkout", {
      method: "POST",
      headers: { Authorization: "Bearer " + ctx.state.token, "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No charge was made.");
    return "No charge was made.";
  }));
}
