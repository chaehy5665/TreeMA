const animatedElements = [...document.querySelectorAll(".hero-copy, .hero-preview, .content-section, .cta-panel")];

for (const element of animatedElements) {
  element.dataset.animate = "true";
}

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

if (prefersReducedMotion.matches) {
  for (const element of animatedElements) {
    element.classList.add("is-visible");
  }
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    {
      threshold: 0.18,
      rootMargin: "0px 0px -8% 0px"
    }
  );

  for (const element of animatedElements) {
    observer.observe(element);
  }
}

const headerLinks = [...document.querySelectorAll(".site-nav a[href^='#']")];
const sections = headerLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

if (sections.length > 0 && headerLinks.length > 0) {
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      const visibleEntry = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

      if (!visibleEntry?.target?.id) return;
      const activeHash = `#${visibleEntry.target.id}`;
      for (const link of headerLinks) {
        link.setAttribute("aria-current", link.getAttribute("href") === activeHash ? "true" : "false");
      }
    },
    {
      rootMargin: "-20% 0px -55% 0px",
      threshold: [0.15, 0.35, 0.6]
    }
  );

  for (const section of sections) {
    sectionObserver.observe(section);
  }
}
