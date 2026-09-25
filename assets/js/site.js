// Header background once the page scrolls, and the requested path on the 404 page.
(() => {
  "use strict";

  const header = document.querySelector("[data-header]");
  if (header) {
    const update = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  document.querySelectorAll("[data-requested-path]").forEach((el) => {
    let path = window.location.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep the encoded form
    }
    el.textContent = path;
  });
})();
