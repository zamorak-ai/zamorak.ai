// Header background once the page scrolls; on the 404 page, the requested
// path and a working "Enter file name:" prompt.
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

  // As LaTeX's prompt promises: a name opens that page on this site, and an
  // empty line (<RETURN> to proceed) or X (quit) goes home. Leading slashes are
  // dropped so the result can't become a link to another site.
  const prompt = document.querySelector("[data-file-prompt]");
  if (prompt) {
    if (window.matchMedia("(pointer: fine)").matches) prompt.focus({ preventScroll: true });
    prompt.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const name = prompt.value.trim().replace(/^[/\\]+/, "");
      const target = new URL(name.toLowerCase() === "x" ? "/" : `/${name}`, window.location.origin);
      window.location.assign(target.origin === window.location.origin ? target.href : "/");
    });
  }
})();
