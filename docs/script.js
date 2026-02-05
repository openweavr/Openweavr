// Mobile nav toggle
const toggle = document.querySelector('[data-nav-toggle]');
const nav = document.querySelector('[data-site-nav]');

if (toggle && nav) {
  toggle.addEventListener('click', () => {
    nav.classList.toggle('open');
  });
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabGroup = btn.closest('.install-tabs');
    const tabId = btn.dataset.tab;

    // Update buttons
    tabGroup.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update content
    tabGroup.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tabGroup.querySelector(`#tab-${tabId}`).classList.add('active');
  });
});

// Copy code functionality
function copyCode(btn, codeId) {
  const codeEl = document.getElementById(codeId);
  const text = codeEl.textContent;

  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  });
}

// Sidebar scroll handling
const sidebar = document.querySelector('.sidebar');
const sections = document.querySelectorAll('.section[id]');

if (sidebar && sections.length > 0) {
  const sidebarLinks = sidebar.querySelectorAll('a[href^="#"]');

  // Create a map of section IDs to links
  const linkMap = new Map();
  sidebarLinks.forEach(link => {
    const id = link.getAttribute('href').slice(1);
    linkMap.set(id, link);
  });

  // Intersection Observer to highlight current section
  const observerOptions = {
    root: null,
    rootMargin: '-80px 0px -70% 0px', // Account for sticky header
    threshold: 0
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // Remove active from all links
        sidebarLinks.forEach(link => link.classList.remove('active'));
        // Add active to current section link
        const link = linkMap.get(entry.target.id);
        if (link) {
          link.classList.add('active');
        }
      }
    });
  }, observerOptions);

  sections.forEach(section => observer.observe(section));

  // Smooth scroll with offset for anchor links
  sidebarLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href').slice(1);
      const targetSection = document.getElementById(targetId);

      if (targetSection) {
        e.preventDefault();

        // Calculate offset (header height + padding)
        const headerHeight = document.querySelector('.site-header')?.offsetHeight || 60;
        const offset = headerHeight + 24;

        const targetPosition = targetSection.getBoundingClientRect().top + window.pageYOffset - offset;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });

        // Update URL without jumping
        history.pushState(null, '', `#${targetId}`);

        // Update active state immediately
        sidebarLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      }
    });
  });

  // Handle initial hash in URL
  if (window.location.hash) {
    const targetId = window.location.hash.slice(1);
    const targetSection = document.getElementById(targetId);

    if (targetSection) {
      setTimeout(() => {
        const headerHeight = document.querySelector('.site-header')?.offsetHeight || 60;
        const offset = headerHeight + 24;
        const targetPosition = targetSection.getBoundingClientRect().top + window.pageYOffset - offset;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }, 100);
    }
  }
}
