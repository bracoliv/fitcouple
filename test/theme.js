(function () {
  var KEY = 'fitTheme';
  var themes = [
    { id: 'soft', label: 'Soft' },
    { id: 'gym', label: 'Gym' },
    { id: 'city', label: 'City' },
    { id: 'tech', label: 'Tech' }
  ];

  function current() {
    var t = document.documentElement.getAttribute('data-theme') || 'soft';
    return themes.some(function (x) { return x.id === t; }) ? t : 'soft';
  }

  function apply(id) {
    document.documentElement.setAttribute('data-theme', id);
    try { localStorage.setItem(KEY, id); } catch (e) {}
    document.querySelectorAll('[data-theme-pick]').forEach(function (b) {
      var on = b.getAttribute('data-theme-pick') === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function mount() {
    if (document.querySelector('.theme-bar')) return;
    var bar = document.createElement('div');
    bar.className = 'theme-bar';
    bar.innerHTML = '<span class="theme-label">Test look</span>' + themes.map(function (t) {
      return '<button type="button" data-theme-pick="' + t.id + '">' + t.label + '</button>';
    }).join('');
    document.body.insertBefore(bar, document.body.firstChild);
    bar.addEventListener('click', function (e) {
      var id = e.target.getAttribute('data-theme-pick');
      if (id) apply(id);
    });
    apply(current());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
