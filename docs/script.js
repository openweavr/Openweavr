const toggle = document.querySelector('[data-nav-toggle]');
const nav = document.querySelector('[data-site-nav]');

if (toggle && nav) {
  toggle.addEventListener('click', () => {
    nav.classList.toggle('open');
  });
}
