/* ==========================================================================
   Toko Kue Manis Senja — logika antarmuka
   Vanilla JavaScript: katalog, pencarian, keranjang (localStorage),
   modal, dan alur checkout (termasuk Midtrans Snap bila dikonfigurasi).
   ========================================================================== */

(function () {
  "use strict";

  var PRODUCTS = Array.isArray(window.CAKE_PRODUCTS) ? window.CAKE_PRODUCTS : [];
  var STORAGE_KEY = "manis-senja-cart-v1";
  var MAX_QTY = 99;
  var SERVER_ONLY_MESSAGE = "Fitur ini hanya tersedia di versi dengan server. Website ini adalah demo tampilan.";
  var API_UNAVAILABLE_STATUSES = [404, 405, 501];

  var state = {
    cart: [],
    category: "Semua",
    search: "",
    activeProductId: null,
    modalQty: 1,
    lastFocused: null,
    config: {
      backendAvailable: false,
      midtransConfigured: false,
      demoMode: true,
      clientKey: "",
      snapScriptUrl: "https://app.sandbox.midtrans.com/snap/snap.js"
    },
    snapLoading: null,
    checkoutBusy: false
  };

  var productIndex = {};
  PRODUCTS.forEach(function (product) {
    productIndex[product.id] = product;
  });

  /* ---------------------------------- Utils --------------------------------- */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function rupiah(value) {
    var number = Math.round(Number(value) || 0);
    return "Rp" + number.toLocaleString("id-ID");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function clampQty(value) {
    var qty = Math.floor(Number(value) || 0);
    if (!Number.isFinite(qty) || qty < 1) return 1;
    return Math.min(qty, MAX_QTY);
  }

  function findProduct(id) {
    return productIndex[id] || null;
  }

  function isApiUnavailable(response) {
    return API_UNAVAILABLE_STATUSES.indexOf(response.status) !== -1;
  }

  function isJsonResponse(response) {
    var contentType = response.headers.get("content-type") || "";
    return contentType.indexOf("application/json") !== -1;
  }

  function isNetworkFailure(message) {
    return /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(message);
  }

  /* ------------------------------- Keranjang -------------------------------- */

  function loadCart() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return [];
    }
    if (!raw) return [];

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    var merged = {};
    parsed.forEach(function (item) {
      if (!item || !findProduct(item.id)) return;
      var qty = clampQty(item.qty);
      merged[item.id] = Math.min((merged[item.id] || 0) + qty, MAX_QTY);
    });

    return Object.keys(merged).map(function (id) {
      return { id: id, qty: merged[id] };
    });
  }

  function saveCart() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cart));
    } catch (error) {
      /* localStorage bisa diblokir; keranjang tetap berfungsi di sesi ini. */
    }
  }

  function cartLineItems() {
    return state.cart
      .map(function (item) {
        var product = findProduct(item.id);
        if (!product) return null;
        return {
          id: product.id,
          name: product.name,
          price: product.price,
          qty: item.qty,
          image: product.image,
          lineTotal: product.price * item.qty
        };
      })
      .filter(Boolean);
  }

  function cartTotals() {
    var lines = cartLineItems();
    return {
      lines: lines,
      count: lines.reduce(function (sum, line) { return sum + line.qty; }, 0),
      subtotal: lines.reduce(function (sum, line) { return sum + line.lineTotal; }, 0)
    };
  }

  function addToCart(id, qty) {
    var product = findProduct(id);
    if (!product) return;
    var amount = clampQty(qty);
    var existing = state.cart.find(function (item) { return item.id === id; });

    if (existing) {
      existing.qty = Math.min(existing.qty + amount, MAX_QTY);
    } else {
      state.cart.push({ id: id, qty: amount });
    }

    saveCart();
    renderCart();
    bumpBadge();
    showToast(product.name + " ditambahkan ke keranjang");
  }

  function setQty(id, qty) {
    var item = state.cart.find(function (entry) { return entry.id === id; });
    if (!item) return;
    item.qty = clampQty(qty);
    saveCart();
    renderCart();
  }

  function removeFromCart(id) {
    var product = findProduct(id);
    state.cart = state.cart.filter(function (item) { return item.id !== id; });
    saveCart();
    renderCart();
    if (product) showToast(product.name + " dihapus dari keranjang");
  }

  function clearCart(skipConfirm) {
    if (!state.cart.length) return;
    if (!skipConfirm && !window.confirm("Kosongkan seluruh keranjang?")) return;
    state.cart = [];
    saveCart();
    renderCart();
    showToast("Keranjang dikosongkan");
  }

  /* ------------------------------- Render menu ------------------------------ */

  var productGrid = $("#productGrid");
  var productEmpty = $("#productEmpty");
  var resultInfo = $("#resultInfo");
  var searchInput = $("#searchInput");
  var clearSearch = $("#clearSearch");
  var cartCount = $("#cartCount");

  function matchesFilters(product) {
    var query = state.search.trim().toLowerCase();
    var categoryMatch = state.category === "Semua" || product.category === state.category;
    if (!categoryMatch) return false;
    if (!query) return true;
    var haystack = (product.name + " " + product.category + " " + product.description).toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  function createProductCard(product) {
    var card = document.createElement("article");
    card.className = "product-card";
    card.dataset.id = product.id;

    var badge = product.id === "red-velvet-slice"
      ? '<span class="product-badge">Favorit</span>'
      : "";

    card.innerHTML =
      '<button class="product-media" type="button" data-detail="' + escapeHtml(product.id) + '" ' +
      'aria-label="Lihat detail ' + escapeHtml(product.name) + '">' +
      '<img src="' + escapeHtml(product.image) + '" alt="' + escapeHtml(product.name) + '" ' +
      'width="400" height="300" loading="lazy" data-fallback />' +
      '<span class="product-tag">' + escapeHtml(product.category) + "</span>" + badge +
      "</button>" +
      '<div class="product-body">' +
      "<h3>" + escapeHtml(product.name) + "</h3>" +
      '<p class="product-desc">' + escapeHtml(product.description) + "</p>" +
      '<div class="product-foot">' +
      '<span class="product-price">' + rupiah(product.price) + "</span>" +
      '<button class="product-add" type="button" data-add="' + escapeHtml(product.id) + '">' +
      '<span aria-hidden="true">+</span> Tambah</button>' +
      "</div></div>";

    return card;
  }

  function renderProducts() {
    var visible = PRODUCTS.filter(matchesFilters);
    productGrid.innerHTML = "";
    var fragment = document.createDocumentFragment();

    visible.forEach(function (product) {
      fragment.appendChild(createProductCard(product));
    });
    productGrid.appendChild(fragment);

    productEmpty.hidden = visible.length !== 0;
    productGrid.hidden = visible.length === 0;

    if (state.search.trim()) {
      resultInfo.textContent = visible.length
        ? "Menampilkan " + visible.length + ' menu untuk “' + state.search.trim() + "”."
        : 'Tidak ada menu yang cocok dengan “' + state.search.trim() + "”.";
    } else if (state.category !== "Semua") {
      resultInfo.textContent = "Menampilkan " + visible.length + " menu kategori " + state.category + ".";
    } else {
      resultInfo.textContent = "Menampilkan seluruh " + visible.length + " menu.";
    }

    clearSearch.hidden = state.search.length === 0;
  }

  /* ------------------------------- Render cart ------------------------------ */

  var cartItemsEl = $("#cartItems");
  var cartEmptyEl = $("#cartEmpty");
  var cartFooterEl = $("#cartFooter");
  var cartSubtotalEl = $("#cartSubtotal");
  var cartSubtitleEl = $("#cartSubtitle");
  var cartOpen = false;

  function renderCart() {
    var totals = cartTotals();
    cartItemsEl.innerHTML = "";
    var fragment = document.createDocumentFragment();

    totals.lines.forEach(function (line) {
      var li = document.createElement("li");
      li.className = "cart-item";
      li.innerHTML =
        '<div class="cart-item-media">' +
        '<img src="' + escapeHtml(line.image) + '" alt="' + escapeHtml(line.name) + '" ' +
        'width="74" height="74" data-fallback />' +
        "</div>" +
        '<div class="cart-item-info">' +
        "<h3>" + escapeHtml(line.name) + "</h3>" +
        '<p class="cart-item-price">' + rupiah(line.price) + " / item</p>" +
        '<div class="cart-item-controls">' +
        '<div class="qty-control" role="group" aria-label="Jumlah ' + escapeHtml(line.name) + '">' +
        '<button type="button" data-cart-dec="' + escapeHtml(line.id) + '" aria-label="Kurangi jumlah" ' +
        (line.qty <= 1 ? "disabled" : "") + ">−</button>" +
        '<span aria-live="polite">' + line.qty + "</span>" +
        '<button type="button" data-cart-inc="' + escapeHtml(line.id) + '" aria-label="Tambah jumlah" ' +
        (line.qty >= MAX_QTY ? "disabled" : "") + ">+</button>" +
        "</div>" +
        '<button class="cart-remove" type="button" data-cart-remove="' + escapeHtml(line.id) + '">Hapus</button>' +
        "</div></div>" +
        '<span class="cart-item-total">' + rupiah(line.lineTotal) + "</span>";

      fragment.appendChild(li);
    });

    cartItemsEl.appendChild(fragment);

    var isEmpty = totals.lines.length === 0;
    cartEmptyEl.hidden = !isEmpty;
    cartItemsEl.hidden = isEmpty;
    cartFooterEl.hidden = isEmpty;
    cartSubtotalEl.textContent = rupiah(totals.subtotal);
    cartSubtitleEl.textContent = totals.count + " item dipilih";
    cartCount.textContent = totals.count;
    cartCount.setAttribute("aria-label", totals.count + " item di keranjang");
  }

  function bumpBadge() {
    cartCount.classList.remove("is-bump");
    void cartCount.offsetWidth;
    cartCount.classList.add("is-bump");
  }

  /* ---------------------------------- Toast --------------------------------- */

  var toastEl = $("#toast");
  var toastTimer = null;
  var toastHideTimer = null;

  function showToast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    void toastEl.offsetWidth;
    toastEl.classList.add("is-visible");

    if (toastTimer) window.clearTimeout(toastTimer);
    if (toastHideTimer) window.clearTimeout(toastHideTimer);

    toastTimer = window.setTimeout(function () {
      toastEl.classList.remove("is-visible");
      toastHideTimer = window.setTimeout(function () {
        if (!toastEl.classList.contains("is-visible")) toastEl.hidden = true;
      }, 260);
    }, 2600);
  }

  /* ------------------------------ Scroll locking ---------------------------- */

  function syncScrollLock() {
    var anyOpen = cartOpen || !$("#productModal").hidden || !$("#checkoutModal").hidden;
    document.body.classList.toggle("no-scroll", anyOpen);
  }

  /* -------------------------------- Keranjang ------------------------------- */

  var cartDrawer = $("#cartDrawer");
  var cartOverlay = $("#cartOverlay");
  var cartButton = $("#cartButton");

  function openCart() {
    if (cartOpen) return;
    state.lastFocused = document.activeElement;
    cartOpen = true;
    cartDrawer.hidden = false;
    cartOverlay.hidden = false;
    window.requestAnimationFrame(function () {
      cartDrawer.classList.add("is-open");
      cartOverlay.classList.add("is-open");
    });
    syncScrollLock();
    window.setTimeout(function () {
      $("#closeCartBtn").focus();
    }, 60);
  }

  function closeCart() {
    if (!cartOpen) return;
    cartOpen = false;
    cartDrawer.classList.remove("is-open");
    cartOverlay.classList.remove("is-open");
    window.setTimeout(function () {
      if (cartOpen) return;
      cartDrawer.hidden = true;
      cartOverlay.hidden = true;
    }, 300);
    syncScrollLock();
    restoreFocus(cartButton);
  }

  function restoreFocus(fallback) {
    var target = state.lastFocused;
    if (target && document.contains(target) && target.offsetParent !== null) {
      target.focus();
    } else if (fallback) {
      fallback.focus();
    }
  }

  /* ---------------------------------- Modal --------------------------------- */

  function openModal(modal) {
    state.lastFocused = document.activeElement;
    modal.hidden = false;
    window.requestAnimationFrame(function () {
      modal.classList.add("is-open");
    });
    syncScrollLock();
    var closeBtn = $(".modal-close", modal);
    window.setTimeout(function () {
      if (closeBtn) closeBtn.focus();
    }, 60);
  }

  function closeModal(modal, fallback) {
    if (modal.hidden) return;
    modal.classList.remove("is-open");
    window.setTimeout(function () {
      if (!modal.classList.contains("is-open")) modal.hidden = true;
    }, 260);
    syncScrollLock();
    restoreFocus(fallback);
  }

  function closeTopLayer() {
    if (!$("#checkoutModal").hidden) {
      closeModal($("#checkoutModal"), cartButton);
      return true;
    }
    if (!$("#productModal").hidden) {
      closeModal($("#productModal"), null);
      return true;
    }
    if (cartOpen) {
      closeCart();
      return true;
    }
    return false;
  }

  function trapFocus(event, container) {
    if (event.key !== "Tab" || !container) return;
    var focusables = $$(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
      'select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      container
    ).filter(function (el) {
      return el.offsetWidth > 0 || el.offsetHeight > 0;
    });
    if (!focusables.length) return;

    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ------------------------------ Modal produk ------------------------------ */

  var productModal = $("#productModal");

  function openProductModal(id) {
    var product = findProduct(id);
    if (!product) return;

    state.activeProductId = id;
    state.modalQty = 1;

    var modalImage = $("#modalImage");
    modalImage.src = product.image;
    modalImage.alt = product.name;
    $("#modalCategory").textContent = product.category;
    $("#modalName").textContent = product.name;
    $("#modalDescription").textContent = product.detail;
    $("#modalPrice").textContent = rupiah(product.price);
    $("#modalQty").textContent = "1";

    openModal(productModal);
  }

  function updateModalQty(delta) {
    state.modalQty = clampQty(state.modalQty + delta);
    $("#modalQty").textContent = String(state.modalQty);
    $("#modalMinus").disabled = state.modalQty <= 1;
    $("#modalPlus").disabled = state.modalQty >= MAX_QTY;
  }

  /* --------------------------------- Checkout ------------------------------- */

  var checkoutModal = $("#checkoutModal");
  var checkoutForm = $("#checkoutForm");
  var checkoutSummary = $("#checkoutSummary");
  var checkoutTotal = $("#checkoutTotal");
  var checkoutNotice = $("#checkoutNotice");
  var checkoutSubmit = $("#checkoutSubmit");
  var checkoutFormStatus = $("#checkoutFormStatus");
  var checkoutFormView = $("#checkoutFormView");
  var checkoutResultView = $("#checkoutResultView");

  function renderCheckoutSummary() {
    var totals = cartTotals();
    checkoutSummary.innerHTML = "";
    var fragment = document.createDocumentFragment();

    totals.lines.forEach(function (line) {
      var li = document.createElement("li");
      li.innerHTML = "<span>" + escapeHtml(line.name) + " × " + line.qty + "</span>" +
        "<span>" + rupiah(line.lineTotal) + "</span>";
      fragment.appendChild(li);
    });

    checkoutSummary.appendChild(fragment);
    checkoutTotal.textContent = rupiah(totals.subtotal);
  }

  function openCheckout() {
    if (!state.cart.length) {
      showToast("Keranjang masih kosong. Pilih menu dulu, ya.");
      if (!cartOpen) openCart();
      return;
    }

    renderCheckoutSummary();
    checkoutFormView.hidden = false;
    checkoutResultView.hidden = true;
    checkoutFormStatus.textContent = "";
    checkoutFormStatus.classList.remove("is-error");
    checkoutNotice.hidden = state.config.midtransConfigured;
    checkoutSubmit.disabled = false;
    checkoutSubmit.textContent = "Lanjut ke Pembayaran";

    if (cartOpen) closeCart();
    openModal(checkoutModal);
    window.setTimeout(function () {
      $("#checkoutName").focus();
    }, 220);
  }

  function validateCheckoutForm(data) {
    var errors = [];
    if (data.name.trim().length < 2) errors.push("Nama minimal 2 karakter.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) errors.push("Alamat email tidak valid.");
    if (!/^[0-9+\-\s()]{8,20}$/.test(data.phone.trim())) errors.push("Nomor telepon tidak valid.");
    return errors;
  }

  function showCheckoutResult(result) {
    var isDemo = Boolean(result.demo);
    checkoutFormView.hidden = true;
    checkoutResultView.hidden = false;

    var icon = $("#resultIcon");
    icon.textContent = isDemo ? "i" : "✓";
    icon.classList.toggle("is-demo", isDemo);

    $("#resultTitle").textContent = isDemo ? "Pesanan demo dibuat" : "Pembayaran diproses";
    $("#resultMessage").textContent = isDemo
      ? "Pesanan ini hanya simulasi karena kredensial Midtrans belum dikonfigurasi. Tidak ada pembayaran sungguhan yang terjadi."
      : "Midtrans Snap telah menampilkan hasil pembayaran di perangkat ini. Status final tetap diverifikasi oleh server melalui notifikasi Midtrans.";
    $("#resultDemo").hidden = !isDemo;
    $("#resultOrderId").textContent = result.orderId || "-";
    $("#resultTotal").textContent = rupiah(result.total);
  }

  function resetCheckoutView() {
    checkoutFormView.hidden = false;
    checkoutResultView.hidden = true;
  }

  function loadSnapScript(clientKey) {
    if (window.snap && typeof window.snap.pay === "function") {
      return Promise.resolve(window.snap);
    }
    if (state.snapLoading) return state.snapLoading;

    state.snapLoading = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = state.config.snapScriptUrl || "https://app.sandbox.midtrans.com/snap/snap.js";
      script.setAttribute("data-client-key", clientKey);
      script.async = true;
      script.onload = function () {
        if (window.snap) resolve(window.snap);
        else reject(new Error("Snap gagal dimuat."));
      };
      script.onerror = function () {
        state.snapLoading = null;
        reject(new Error("Tidak dapat memuat Snap dari Midtrans."));
      };
      document.head.appendChild(script);
    });

    return state.snapLoading;
  }

  async function submitCheckout(event) {
    event.preventDefault();
    if (state.checkoutBusy) return;

    var data = {
      name: $("#checkoutName").value,
      email: $("#checkoutEmail").value,
      phone: $("#checkoutPhone").value,
      note: $("#checkoutNote").value
    };

    var errors = validateCheckoutForm(data);
    if (errors.length) {
      checkoutFormStatus.textContent = errors[0];
      checkoutFormStatus.classList.add("is-error");
      return;
    }

    if (!state.cart.length) {
      checkoutFormStatus.textContent = "Keranjang kosong. Tambahkan menu terlebih dahulu.";
      checkoutFormStatus.classList.add("is-error");
      return;
    }

    state.checkoutBusy = true;
    checkoutSubmit.disabled = true;
    checkoutSubmit.textContent = "Memproses…";
    checkoutFormStatus.textContent = "";
    checkoutFormStatus.classList.remove("is-error");

    try {
      var response = await fetch("api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: { name: data.name.trim(), email: data.email.trim(), phone: data.phone.trim() },
          note: data.note.trim(),
          items: state.cart.map(function (item) { return { id: item.id, qty: item.qty }; })
        })
      });

      var isJson = isJsonResponse(response);
      var payload = isJson ? await response.json().catch(function () { return {}; }) : {};

      if (!response.ok || !isJson) {
        if (!isJson || isApiUnavailable(response)) {
          throw new Error(SERVER_ONLY_MESSAGE);
        }
        throw new Error(payload.error || "Server menolak pesanan (" + response.status + ").");
      }

      if (payload.demo) {
        showCheckoutResult({ demo: true, orderId: payload.orderId, total: payload.total });
        clearCart(true);
        return;
      }

      if (!payload.token) {
        throw new Error("Server tidak mengembalikan token pembayaran.");
      }

      var snap = await loadSnapScript(payload.clientKey || state.config.clientKey);
      resetCheckoutView();

      snap.pay(payload.token, {
        onSuccess: function () {
          showCheckoutResult({ demo: false, orderId: payload.orderId, total: payload.total });
          clearCart(true);
        },
        onPending: function () {
          showCheckoutResult({ demo: false, orderId: payload.orderId, total: payload.total });
          $("#resultTitle").textContent = "Menunggu pembayaran";
          $("#resultMessage").textContent =
            "Pembayaran belum selesai. Status akan diperbarui setelah server menerima notifikasi Midtrans.";
          clearCart(true);
        },
        onError: function () {
          checkoutFormStatus.textContent =
            "Pembayaran gagal diproses oleh Midtrans. Keranjang tidak diubah.";
          checkoutFormStatus.classList.add("is-error");
        },
        onClose: function () {
          if ($("#checkoutResultView").hidden) {
            checkoutFormStatus.textContent =
              "Jendela pembayaran ditutup sebelum selesai. Keranjang masih tersimpan.";
            checkoutFormStatus.classList.add("is-error");
          }
        }
      });
    } catch (error) {
      var message = error && error.message ? error.message : "Terjadi kesalahan.";
      if (isNetworkFailure(message)) {
        message = SERVER_ONLY_MESSAGE;
      }
      checkoutFormStatus.textContent = message;
      checkoutFormStatus.classList.add("is-error");
    } finally {
      state.checkoutBusy = false;
      checkoutSubmit.disabled = false;
      checkoutSubmit.textContent = "Lanjut ke Pembayaran";
    }
  }

  /* ------------------------------- Konfigurasi ------------------------------ */

  async function loadConfig() {
    try {
      var response = await fetch("api/config", { cache: "no-store" });
      if (!response.ok || !isJsonResponse(response)) {
        state.config.backendAvailable = false;
        return;
      }
      var data = await response.json();
      state.config.backendAvailable = true;
      state.config.midtransConfigured = Boolean(data.midtransConfigured);
      state.config.demoMode = data.demoMode !== false;
      state.config.clientKey = data.clientKey || "";
      state.config.snapScriptUrl = data.snapScriptUrl || state.config.snapScriptUrl;
    } catch (error) {
      state.config.backendAvailable = false;
      state.config.midtransConfigured = false;
      state.config.demoMode = true;
    }
  }

  /* -------------------------------- Navigasi -------------------------------- */

  var navToggle = $("#navToggle");
  var navMenu = $("#navMenu");
  var header = $("#navbar");

  function closeNav() {
    navMenu.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  }

  function toggleNav() {
    var isOpen = navMenu.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  }

  /* ------------------------------- Event wiring ----------------------------- */

  function wireEvents() {
    navToggle.addEventListener("click", toggleNav);
    navMenu.addEventListener("click", function (event) {
      if (event.target.closest("a")) closeNav();
    });

    cartButton.addEventListener("click", openCart);
    $("#closeCartBtn").addEventListener("click", closeCart);
    cartOverlay.addEventListener("click", closeCart);
    $("#cartBrowseBtn").addEventListener("click", function () {
      closeCart();
      $("#menu").scrollIntoView({ behavior: "smooth" });
      window.setTimeout(function () { searchInput.focus(); }, 420);
    });
    $("#checkoutBtn").addEventListener("click", openCheckout);
    $("#clearCartBtn").addEventListener("click", function () { clearCart(false); });

    $("#heroOrderBtn").addEventListener("click", function () {
      if (state.cart.length) {
        openCart();
      } else {
        $("#menu").scrollIntoView({ behavior: "smooth" });
        window.setTimeout(function () { searchInput.focus(); }, 420);
      }
    });

    searchInput.addEventListener("input", function () {
      state.search = searchInput.value;
      renderProducts();
    });

    $("#searchForm").addEventListener("submit", function (event) {
      event.preventDefault();
      state.search = searchInput.value;
      renderProducts();
    });

    clearSearch.addEventListener("click", function () {
      searchInput.value = "";
      state.search = "";
      renderProducts();
      searchInput.focus();
    });

    $("#resetSearch").addEventListener("click", function () {
      searchInput.value = "";
      state.search = "";
      state.category = "Semua";
      $$(".chip").forEach(function (chip) {
        var active = chip.dataset.category === "Semua";
        chip.classList.toggle("is-active", active);
        chip.setAttribute("aria-pressed", String(active));
      });
      renderProducts();
    });

    $("#categoryFilters").addEventListener("click", function (event) {
      var chip = event.target.closest(".chip");
      if (!chip) return;
      state.category = chip.dataset.category;
      $$(".chip").forEach(function (item) {
        var active = item === chip;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderProducts();
    });

    productGrid.addEventListener("click", function (event) {
      var addBtn = event.target.closest("[data-add]");
      if (addBtn) {
        addToCart(addBtn.dataset.add, 1);
        addBtn.classList.add("is-added");
        addBtn.innerHTML = '<span aria-hidden="true">✓</span> Ditambah';
        window.setTimeout(function () {
          addBtn.classList.remove("is-added");
          addBtn.innerHTML = '<span aria-hidden="true">+</span> Tambah';
        }, 1200);
        return;
      }

      var detailBtn = event.target.closest("[data-detail]");
      if (detailBtn) openProductModal(detailBtn.dataset.detail);
    });

    cartItemsEl.addEventListener("click", function (event) {
      var inc = event.target.closest("[data-cart-inc]");
      var dec = event.target.closest("[data-cart-dec]");
      var remove = event.target.closest("[data-cart-remove]");

      if (inc) {
        var incItem = state.cart.find(function (item) { return item.id === inc.dataset.cartInc; });
        if (incItem) setQty(incItem.id, incItem.qty + 1);
      } else if (dec) {
        var decItem = state.cart.find(function (item) { return item.id === dec.dataset.cartDec; });
        if (decItem) setQty(decItem.id, decItem.qty - 1);
      } else if (remove) {
        removeFromCart(remove.dataset.cartRemove);
      }
    });

    $("#productModal").addEventListener("click", function (event) {
      if (event.target.closest("[data-close]")) closeModal(productModal, null);
    });

    $("#modalMinus").addEventListener("click", function () { updateModalQty(-1); });
    $("#modalPlus").addEventListener("click", function () { updateModalQty(1); });
    $("#modalAddBtn").addEventListener("click", function () {
      if (!state.activeProductId) return;
      addToCart(state.activeProductId, state.modalQty);
      closeModal(productModal, null);
    });

    $("#checkoutModal").addEventListener("click", function (event) {
      if (event.target.closest("[data-close]")) {
        closeModal(checkoutModal, cartButton);
      }
    });

    $("#resultCloseBtn").addEventListener("click", function () {
      closeModal(checkoutModal, cartButton);
      $("#menu").scrollIntoView({ behavior: "smooth" });
    });

    checkoutForm.addEventListener("submit", submitCheckout);

    $("#contactForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      var status = $("#contactStatus");
      var form = event.currentTarget;
      var payload = {
        name: $("#contactName").value.trim(),
        email: $("#contactEmail").value.trim(),
        message: $("#contactMessage").value.trim()
      };

      status.classList.remove("is-error");
      if (payload.name.length < 2) {
        status.textContent = "Nama minimal 2 karakter.";
        status.classList.add("is-error");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
        status.textContent = "Alamat email tidak valid.";
        status.classList.add("is-error");
        return;
      }
      if (payload.message.length < 5) {
        status.textContent = "Pesan minimal 5 karakter.";
        status.classList.add("is-error");
        return;
      }

      var submitBtn = $('button[type="submit"]', form);
      submitBtn.disabled = true;
      submitBtn.textContent = "Mengirim…";

      try {
        var response = await fetch("api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        var isJson = isJsonResponse(response);
        if (!response.ok || !isJson) {
          if (!isJson || isApiUnavailable(response)) {
            throw new Error(SERVER_ONLY_MESSAGE);
          }
          var data = await response.json().catch(function () { return {}; });
          throw new Error(data.error || "Pesan gagal dikirim.");
        }
        status.textContent = "Terima kasih! Pesanmu sudah diterima dan dicatat di server.";
        form.reset();
      } catch (error) {
        var message = error && error.message ? error.message : "Pesan gagal dikirim.";
        if (isNetworkFailure(message)) {
          message = SERVER_ONLY_MESSAGE;
        }
        status.textContent = message;
        status.classList.add("is-error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Kirim Pesan";
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeTopLayer();
        closeNav();
      }
      if (event.key === "Tab") {
        if (!$("#checkoutModal").hidden) trapFocus(event, $(".checkout-card"));
        else if (!productModal.hidden) trapFocus(event, $(".product-modal-card"));
        else if (cartOpen) trapFocus(event, cartDrawer);
      }
    });

    document.addEventListener("click", function (event) {
      if (navMenu.classList.contains("is-open") &&
          !event.target.closest("#navMenu") &&
          !event.target.closest("#navToggle")) {
        closeNav();
      }
    });

    window.addEventListener("scroll", function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    }, { passive: true });

    document.addEventListener("error", function (event) {
      var img = event.target;
      if (!img || img.tagName !== "IMG" || img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = "true";
      img.src = "assets/images/logo.svg";
      img.style.objectFit = "contain";
      img.style.padding = "18px";
    }, true);
  }

  /* -------------------------------- Section nav ------------------------------ */

  function observeSections() {
    if (!("IntersectionObserver" in window)) return;
    var links = $$(".nav-list a");
    var sections = links
      .map(function (link) { return document.querySelector(link.getAttribute("href")); })
      .filter(Boolean);

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (link) {
          link.classList.toggle("is-active", link.getAttribute("href") === "#" + entry.target.id);
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });

    sections.forEach(function (section) { observer.observe(section); });
  }

  /* ---------------------------------- Init ---------------------------------- */

  function init() {
    state.cart = loadCart();
    $("#year").textContent = String(new Date().getFullYear());
    renderProducts();
    renderCart();
    wireEvents();
    observeSections();
    loadConfig();

    window.setTimeout(function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    }, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
