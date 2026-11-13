const shopState = { catalog: null, cart: [], error: "", loading: false };

function money(cents, currency) {
  return `${currency || "RM"} ${(Number(cents) / 100).toFixed(2)}`;
}

function ageYes() {
  return localStorage.getItem("fitAge18") === "yes";
}

export function includeShop() {
  return globalThis.SHOP_BUILD === true;
}

export function screenList() {
  return includeShop()
    ? ["today", "path", "focus", "team", "shop", "more"]
    : ["today", "path", "focus", "team", "more"];
}

export function navClass() {
  return includeShop() ? "nav-shop" : "";
}

async function loadCatalog(workerUrl, token) {
  const headers = { Authorization: "Bearer " + token };
  if (ageYes()) headers["X-Age-Confirm"] = "18";
  const base = String(workerUrl || "").replace(/\/$/, "");
  const res = await fetch(base + "/v1/store/catalog", { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "The shop is not available.");
  return data;
}

function productCard(item, catalog, esc) {
  const facts = [
    ["Why it is listed", item.why],
    ["Evidence", item.evidence],
    ["Dose", item.dose],
    ["Third-party testing", item.testing],
    ["Halal", item.halal === "yes" ? "Yes" : item.halal === "no" ? "No" : "Not stated"],
    ["MAL", item.mal],
  ].map(([label, value]) => `<p class="sub"><strong>${esc(label)}.</strong> ${esc(value)}</p>`).join("");
  const price = `<p>${esc(money(item.priceCents, catalog.currency))}</p><p class="meta">Supplier list ${esc(money(item.listPriceCents, catalog.currency))}. Not below that price.</p>`;
  const buy = catalog.mode === "external"
    ? (item.shopeeUrl ? `<a href="${esc(item.shopeeUrl)}" target="_blank" rel="noopener">Buy on Shopee</a>` : `<p class="hint">No Shopee link yet.</p>`)
    : `<button type="button" data-add-cart="${esc(item.id)}">Add to cart</button>`;
  const tag = item.audience === "adult" ? ` <span class="meta">18+</span>` : "";
  return `<article class="card"><p><strong>${esc(item.name)}</strong>${tag} <span class="meta">${item.brand === "sosm" ? "SOSM+" : "Other brand"}</span></p>${facts}${price}${buy}</article>`;
}

export function shopHtml(state, esc) {
  if (!includeShop()) return "";
  const catalog = shopState.catalog;
  if (!state.token) return `<section><h2>Shop</h2><p class="hint">The shop loads with your game.</p></section>`;
  if (shopState.loading && !catalog) return `<section><h2>Shop</h2><p class="hint">Loading the list…</p></section>`;
  if (!catalog) return `<section><h2>Shop</h2><p class="hint">${esc(shopState.error || "The shop is not available on this server.")}</p></section>`;
  const seller = catalog.seller || {};
  const pages = catalog.pages || {};
  const recommended = (catalog.recommended || []).map((item) => productCard(item, catalog, esc)).join("");
  const adult = (catalog.adult || []).map((item) => productCard(item, catalog, esc)).join("");
  const ageBox = catalog.adultLocked ? `<label class="hint"><input id="age18" type="checkbox"> I am 18 or older. Show the 18+ products. They are not picked from my workouts or goals.</label>` : "";
  const cart = (shopState.cart || []).map((line) => `<li>${esc(line.qty)} × ${esc(line.name)}</li>`).join("");
  const checkout = catalog.mode === "checkout" ? `<form id="checkout"><p class="hint">${esc(catalog.privacy || "")}</p><label>Name<input name="name" required maxlength="80"></label><label>Phone<input name="phone" required maxlength="20"></label><label>Address<input name="address" required maxlength="200"></label><label class="hint"><input name="consent" type="checkbox" value="yes"> I agree that my name, phone, and address are used only to deliver this order, and are kept apart from my food and workout log.</label><button type="submit" class="primary">Pay in sandbox</button><p class="hint">Physical goods. Not an in-app purchase. Sandbox only. No live card is charged.</p></form>` : `<p class="hint">Fit does not take payment inside the app. Each product opens the seller's Shopee listing.</p>`;
  const links = `<p class="hint"><a href="${esc(pages.terms || "shop-terms.html")}">Terms</a> · <a href="${esc(pages.refund || "shop-refund.html")}">Refunds</a> · <a href="${esc(pages.privacy || "shop-privacy.html")}">Shop privacy</a></p>`;
  return `<section><h2>Shop</h2>
    <section class="card"><h2>Seller</h2><p>${esc(seller.name || "Seller name is not set yet.")}</p><p class="sub">${esc(seller.line || "")}</p><p class="sub">${esc(seller.contact || "")}</p>${links}</section>
    <p class="hint">${esc(catalog.notice || "")}</p>
    <h2>Recommended</h2>
    <p class="hint">The same list for every player. It is not chosen from your food, workouts, goals, or scores.</p>
    ${recommended || `<p class="hint">No products yet.</p>`}
    ${ageBox}
    ${adult ? `<h2>18+</h2><p class="hint">Shown only after you confirm your age. Never used as a workout or goal suggestion.</p>${adult}` : ""}
    ${cart ? `<ul class="log">${cart}</ul>` : ""}
    ${checkout}
    ${(catalog.orders || []).length ? `<h2>Your orders</h2><ul class="log">${catalog.orders.map((order) => `<li>${esc(order.day)} · ${esc(order.status)} · ${esc(money(order.totalCents, catalog.currency))}</li>`).join("")}</ul>` : ""}
    </section>`;
}

export function bindShop(ctx) {
  if (!includeShop()) return;
  const { state, config, run, render } = ctx;
  if (state.token && !shopState.catalog && !shopState.loading && !shopState.error) {
    shopState.loading = true;
    loadCatalog(config.workerUrl, state.token).then((catalog) => {
      shopState.catalog = catalog;
      shopState.error = "";
    }).catch((err) => {
      shopState.error = err.message || "The shop is not available.";
    }).finally(() => {
      shopState.loading = false;
      render();
    });
  }
  document.querySelectorAll("[data-add-cart]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-add-cart");
      const pools = [...(shopState.catalog.recommended || []), ...(shopState.catalog.adult || [])];
      const product = pools.find((item) => item.id === id);
      if (!product) return;
      const line = shopState.cart.find((item) => item.id === id);
      if (line) line.qty = Math.min(10, line.qty + 1);
      else shopState.cart.push({ id: product.id, name: product.name, qty: 1, adult: product.audience === "adult" });
      render();
    });
  });
  const age = document.getElementById("age18");
  if (age) age.addEventListener("change", () => {
    if (!age.checked) return;
    localStorage.setItem("fitAge18", "yes");
    shopState.catalog = null;
    shopState.error = "";
    render();
  });
  const checkout = document.getElementById("checkout");
  if (checkout) checkout.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(checkout);
    run(async () => {
      if (data.get("consent") !== "yes") throw new Error("Tick the box to agree to the delivery privacy note.");
      const needsAge = shopState.cart.some((line) => line.adult);
      const result = await fetch(String(config.workerUrl).replace(/\/$/, "") + "/v1/store/checkout", {
        method: "POST",
        headers: { Authorization: "Bearer " + state.token, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") || ""),
          phone: String(data.get("phone") || ""),
          address: String(data.get("address") || ""),
          items: shopState.cart.map((line) => ({ id: line.id, qty: line.qty })),
          consent: true,
          ageConfirm: needsAge ? true : false,
        }),
      });
      const payload = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(payload.error || "The shop could not start payment.");
      shopState.cart = [];
      if (payload.url) window.location.href = payload.url;
    });
  });
}
