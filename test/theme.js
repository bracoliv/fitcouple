(function () {
  var KEY = 'fitTheme';
  var themes = [
    { id: 'soft', label: 'Soft', note: 'Ring, big calories, emoji pop.' },
    { id: 'gym', label: 'Gym', note: 'Protein and training first. A hard hit.' },
    { id: 'city', label: 'City', note: 'Quiet list. The line draws slowly.' },
    { id: 'tech', label: 'Tech', note: 'Four meters, then one scan.' }
  ];

  function current() {
    var t = document.documentElement.getAttribute('data-theme') || 'soft';
    return themes.some(function (x) { return x.id === t; }) ? t : 'soft';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c];
    });
  }
  function txt(node) {
    return (node && node.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function num(s) {
    var m = String(s == null ? '' : s).replace(/,/g, '').match(/-?\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }
  function byLabel(el, label) {
    var found = '';
    el.querySelectorAll('.metric').forEach(function (m) {
      if (txt(m.querySelector('.label')) === label) {
        found = txt(m.querySelector('strong') || m.querySelector('span:last-child'));
      }
    });
    return found;
  }
  function pair(s) {
    var nums = String(s || '').match(/\d+/g) || [];
    return { a: num(nums[0]), b: num(nums[1]) };
  }

  function parseCard(el) {
    var nameEl = el.querySelector('h3 span');
    var raw = txt(nameEl);
    var split = raw.match(/^(\S+)\s+([\s\S]+)$/);
    var badge = txt(el.querySelector('.goal-badge'));
    var stEl = null;
    el.querySelectorAll('.status').forEach(function (s) {
      if (!stEl && !s.classList.contains('goal-hit')) stEl = s;
    });
    var status = 'empty';
    if (stEl) {
      stEl.classList.forEach(function (c) {
        if (c !== 'status' && status === 'empty') status = c;
      });
    }
    if (['ok', 'low', 'over', 'partial', 'empty'].indexOf(status) < 0) status = 'empty';
    var rows = el.querySelectorAll('.highlight-row');
    var calVals = rows[0] ? [].map.call(rows[0].querySelectorAll('.h-val'), function (n) { return num(n.textContent); }) : [];
    var protVals = rows[1] ? [].map.call(rows[1].querySelectorAll('.h-val'), function (n) { return num(n.textContent); }) : [];
    var midLabel = rows[0] ? txt(rows[0].querySelectorAll('.h-label')[1]) : '';
    var prot = pair(byLabel(el, 'Protein'));
    var carbs = pair(byLabel(el, 'Carbs'));
    var fat = pair(byLabel(el, 'Fat'));
    var workout = byLabel(el, 'Workout');
    return {
      emoji: split ? split[1] : '👤',
      name: split ? split[2] : raw,
      badge: badge,
      badgeWords: badge.replace(/^[^\w]+/, '').trim(),
      eaten: num(byLabel(el, 'Calories eaten')),
      hasTarget: calVals.length > 0,
      goalCal: calVals[0] || 0,
      midVal: calVals[1] || 0,
      midLabel: midLabel || 'Left',
      calPct: calVals[2] || 0,
      prot: prot.a,
      protGoal: protVals[0] || prot.b,
      protLeft: protVals[1] || 0,
      protPct: protVals[2] || 0,
      carbs: carbs.a,
      carbGoal: carbs.b,
      fat: fat.a,
      fatGoal: fat.b,
      workout: workout,
      workoutNum: num(workout),
      status: status,
      statusText: stEl ? txt(stEl) : '',
      protHit: !!el.querySelector('.goal-hit'),
      tip: txt(el.querySelector('.tip'))
    };
  }

  function soft(d) {
    if (!d.hasTarget) {
      return '<div class="soft-top"><span>' + esc(d.emoji) + ' ' + esc(d.name) + '</span></div>'
        + '<div class="kcal"><strong>' + d.eaten + '</strong><em>kcal</em></div>'
        + '<div class="status empty">' + esc(d.statusText || 'No personal target yet') + '</div>';
    }
    var pct = Math.max(0, Math.min(d.calPct, 140));
    var pops = '';
    if (d.protHit) pops = '<i class="flo">💪</i><i class="flo d2">💙</i><i class="flo d3">🏋️</i>';
    else if (d.status === 'low') pops = '<i class="flo">🍌</i>';
    else if (d.status === 'over') pops = '<i class="flo">😮</i>';
    else if (d.status === 'ok') pops = '<i class="flo">✅</i>';
    return pops
      + '<div class="soft-top"><span class="who">' + esc(d.emoji) + ' ' + esc(d.name) + '</span>'
      + (d.badge ? '<span class="goal-badge">' + esc(d.badge) + '</span>' : '') + '</div>'
      + '<div class="soft-main"><div class="kcal"><strong>' + d.eaten + '</strong><em>kcal</em></div>'
      + '<div class="ring" style="--pct:0" data-pct="' + pct + '"><span>' + esc(d.emoji) + '</span></div></div>'
      + '<div class="chips"><span>Goal ' + d.goalCal + '</span><span>' + esc(d.midLabel) + ' ' + d.midVal + '</span><span>' + d.calPct + '%</span></div>'
      + '<div class="status ' + d.status + '">' + esc(d.statusText) + '</div>'
      + '<div class="prot">Protein <b>' + d.prot + ' / ' + d.protGoal + ' g</b>'
      + (d.protHit ? '<span class="pop">💪</span>' : '') + '</div>'
      + '<div class="fine">Carbs ' + d.carbs + ' / ' + d.carbGoal + ' g · Fat ' + d.fat + ' / ' + d.fatGoal + ' g</div>'
      + '<div class="fine">' + esc(d.workout) + '</div>';
  }

  function gym(d) {
    if (!d.hasTarget) {
      return '<div class="gym-kicker">NO TARGET</div><div class="gym-hero"><b>' + d.eaten + '</b></div>'
        + '<div class="status empty">' + esc(d.statusText || 'Add a target in your sheet') + '</div>';
    }
    var pp = Math.max(0, Math.min(d.protPct, 100));
    return '<div class="gym-kicker">PROTEIN</div>'
      + '<div class="gym-hero"><b>' + d.prot + '</b><small>/ ' + d.protGoal + ' g</small></div>'
      + '<div class="gym-bar"><i style="width:' + pp + '%"></i></div>'
      + '<div class="gym-stats">'
      + '<div><b>' + d.eaten + '</b><small>kcal in</small></div>'
      + '<div><b>' + d.midVal + '</b><small>' + esc(d.midLabel) + '</small></div>'
      + '<div><b>' + d.workoutNum + '</b><small>burned</small></div>'
      + '</div>'
      + '<div class="status ' + d.status + '">' + esc(d.statusText) + '</div>'
      + (d.protHit ? '<div class="gym-hit">HIT</div>' : '')
      + '<div class="gym-also">Carbs ' + d.carbs + 'g · Fat ' + d.fat + 'g · ' + esc(d.name) + '</div>';
  }

  function city(d) {
    if (!d.hasTarget) {
      return '<div class="city-name">' + esc(d.name) + '</div>'
        + '<div class="city-num"><b>' + d.eaten + '</b><small>kcal logged</small></div>'
        + '<div class="status empty">' + esc(d.statusText || 'No personal target yet') + '</div>';
    }
    var pct = Math.max(0, Math.min(d.calPct, 100));
    return '<div class="city-name">' + esc(d.name)
      + (d.badgeWords ? '<em>' + esc(d.badgeWords) + '</em>' : '') + '</div>'
      + '<div class="city-num"><b>' + d.eaten.toLocaleString() + '</b><small>of ' + d.goalCal.toLocaleString() + ' kcal</small></div>'
      + '<div class="city-rule"><i style="width:' + pct + '%"></i></div>'
      + '<div class="status ' + d.status + '">' + esc(d.statusText) + '</div>'
      + '<ul class="city-list">'
      + '<li><span>Protein</span><b>' + d.prot + ' / ' + d.protGoal + '</b></li>'
      + '<li><span>Carbohydrate</span><b>' + d.carbs + ' / ' + d.carbGoal + '</b></li>'
      + '<li><span>Fat</span><b>' + d.fat + ' / ' + d.fatGoal + '</b></li>'
      + '<li><span>Training</span><b>' + esc(d.workout) + '</b></li>'
      + '</ul>';
  }

  function tech(d) {
    function cell(label, val, pct) {
      var w = Math.max(0, Math.min(pct, 100));
      return '<div class="cell"><label>' + label + '</label><b>' + val + '</b><meter style="--pct:' + w + '"></meter></div>';
    }
    if (!d.hasTarget) {
      return '<div class="tech-head">NO TARGET · ' + esc(d.name) + '</div>'
        + cell('KCAL', d.eaten, 0)
        + '<div class="tech-status">' + esc(d.statusText || 'WAITING') + '</div>';
    }
    return '<div class="tech-head">LIVE · ' + esc(d.name) + '</div>'
      + '<div class="tech-grid">'
      + cell('KCAL', d.eaten + '/' + d.goalCal, d.calPct)
      + cell('PROT', d.prot + '/' + d.protGoal, d.protPct)
      + cell('CHO', d.carbs + '/' + d.carbGoal, d.carbGoal ? Math.round(d.carbs / d.carbGoal * 100) : 0)
      + cell('FAT', d.fat + '/' + d.fatGoal, d.fatGoal ? Math.round(d.fat / d.fatGoal * 100) : 0)
      + '</div>'
      + '<div class="tech-status">' + esc(d.status.toUpperCase()) + ' · BURN ' + d.workoutNum + '</div>';
  }

  var draw = { soft: soft, gym: gym, city: city, tech: tech };

  function playRings(root) {
    root.querySelectorAll('.ring').forEach(function (ring) {
      var pct = ring.getAttribute('data-pct') || '0';
      ring.style.setProperty('--pct', '0');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { ring.style.setProperty('--pct', pct); });
      });
    });
  }

  function skinAll() {
    var theme = current();
    var titles = { soft: 'Today', gym: 'Session', city: 'Today', tech: 'TODAY // LIVE' };
    var heading = document.querySelector('.today h2');
    if (heading) heading.textContent = titles[theme];
    document.querySelectorAll('#dashboard .person').forEach(function (el) {
      if (!el.dataset.fit) {
        try { el.dataset.fit = JSON.stringify(parseCard(el)); }
        catch (e) { return; }
      }
      var data;
      try { data = JSON.parse(el.dataset.fit); }
      catch (e) { return; }
      ['skin-soft', 'skin-gym', 'skin-city', 'skin-tech', 'st-ok', 'st-low', 'st-over', 'st-partial', 'st-empty'].forEach(function (c) {
        el.classList.remove(c);
      });
      el.classList.add('skinned', 'skin-' + theme, 'st-' + (data.status || 'empty'));
      el.innerHTML = draw[theme](data);
      if (theme === 'soft') playRings(el);
    });
  }

  function apply(id) {
    document.documentElement.setAttribute('data-theme', id);
    try { localStorage.setItem(KEY, id); } catch (e) {}
    document.querySelectorAll('[data-theme-pick]').forEach(function (b) {
      var on = b.getAttribute('data-theme-pick') === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var note = document.querySelector('.theme-note');
    var found = themes.filter(function (t) { return t.id === id; })[0];
    if (note && found) note.textContent = found.note;
    skinAll();
  }

  function mount() {
    if (!document.querySelector('.theme-bar')) {
      var bar = document.createElement('div');
      bar.className = 'theme-bar';
      bar.innerHTML = '<div class="theme-row"><span class="theme-label">Test look</span>'
        + themes.map(function (t) {
          return '<button type="button" data-theme-pick="' + t.id + '">' + t.label + '</button>';
        }).join('')
        + '</div><p class="theme-note"></p>';
      document.body.insertBefore(bar, document.body.firstChild);
      bar.addEventListener('click', function (e) {
        var id = e.target.getAttribute('data-theme-pick');
        if (id) apply(id);
      });
    }
    var board = document.getElementById('dashboard');
    if (board && !board.dataset.watched) {
      board.dataset.watched = '1';
      new MutationObserver(function () { skinAll(); }).observe(board, { childList: true });
    }
    apply(current());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
