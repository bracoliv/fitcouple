(function () {
  var KEY = 'fitTheme';
  var themes = [
    { id: 'soft', label: 'Soft', note: 'Tap the ring. Hearts pop out.' },
    { id: 'gym', label: 'Gym', note: 'Tap the big protein number. It hits again.' },
    { id: 'city', label: 'City', note: 'Tap a row. A gold line draws under it.' },
    { id: 'tech', label: 'Tech', note: 'Tap a meter. The digits scramble, then a scan.' }
  ];

  function current() {
    var t = document.documentElement.getAttribute('data-theme') || 'soft';
    return themes.some(function (x) { return x.id === t; }) ? t : 'soft';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
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
      return '<div class="soft-top"><span class="who">' + esc(d.emoji) + ' ' + esc(d.name) + '</span></div>'
        + '<div class="kcal"><strong>' + d.eaten + '</strong><em>kcal</em></div>'
        + '<div class="status empty">' + esc(d.statusText || 'No personal target yet') + '</div>';
    }
    var pct = Math.max(0, Math.min(d.calPct, 140));
    var leftWord = d.midLabel === 'Remaining' ? 'Left' : d.midLabel;
    var banana = d.status === 'low' ? '<button type="button" class="banana" data-act="soft-banana">🍌</button>' : '';
    return banana
      + '<div class="soft-top"><span class="who">' + esc(d.emoji) + ' ' + esc(d.name) + '</span>'
      + (d.badge ? '<span class="goal-badge">' + esc(d.badge) + '</span>' : '') + '</div>'
      + '<div class="soft-main"><div class="kcal"><strong>' + d.eaten + '</strong><em>kcal</em></div>'
      + '<button type="button" class="ring" data-act="soft-ring" style="--pct:0" data-pct="' + pct + '"><span>' + esc(d.emoji) + '</span></button></div>'
      + '<div class="chips"><span>Goal ' + d.goalCal + '</span><span>' + esc(leftWord) + ' ' + d.midVal + '</span><span>' + d.calPct + '%</span></div>'
      + '<div class="status ' + d.status + '">' + esc(d.statusText) + '</div>'
      + '<button type="button" class="prot" data-act="soft-prot"><span>Protein <b>' + d.prot + ' / ' + d.protGoal + ' g</b></span>'
      + (d.protHit ? '<span class="pop">💪</span>' : '<span class="pop quiet">💪</span>') + '</button>'
      + (d.protHit ? '<div class="hit-line">Protein goal hit</div>' : '')
      + '<div class="fine">Carbs ' + d.carbs + ' / ' + d.carbGoal + ' g</div>'
      + '<div class="fine">Fat ' + d.fat + ' / ' + d.fatGoal + ' g</div>'
      + '<div class="fine">' + esc(d.workout) + '</div>'
      + '<div class="tap-hint">Tap the ring</div>';
  }

  function gym(d) {
    if (!d.hasTarget) {
      return '<div class="gym-kicker">NO TARGET</div><div class="gym-hero"><b>' + d.eaten + '</b></div>'
        + '<div class="status empty">' + esc(d.statusText || 'Add a target in your sheet') + '</div>';
    }
    var pp = Math.max(0, Math.min(d.protPct, 100));
    return '<div class="gym-kicker">PROTEIN</div>'
      + '<button type="button" class="gym-hero" data-act="gym-prot"><b>' + d.prot + '</b><small>/ ' + d.protGoal + ' g</small></button>'
      + '<button type="button" class="gym-bar" data-act="gym-bar"><i style="width:' + pp + '%"></i></button>'
      + '<div class="gym-stats">'
      + '<div><b>' + d.eaten + '</b><small>kcal in</small></div>'
      + '<div><b>' + d.midVal + '</b><small>' + esc(d.midLabel) + '</small></div>'
      + '<button type="button" data-act="gym-burn"><b>' + d.workoutNum + '</b><small>burned</small></button>'
      + '</div>'
      + '<div class="status ' + d.status + '">' + esc(d.statusText) + '</div>'
      + (d.protHit ? '<div class="gym-hit">HIT</div>' : '<div class="gym-hit ghost-hit">TAP</div>')
      + '<div class="gym-also">Carbs ' + d.carbs + 'g · Fat ' + d.fat + 'g · ' + esc(d.name) + '</div>'
      + '<div class="tap-hint">Tap protein</div>';
  }

  function city(d) {
    if (!d.hasTarget) {
      return '<div class="city-name">' + esc(d.name) + '</div>'
        + '<div class="city-num"><b>' + d.eaten + '</b><small>kcal logged</small></div>'
        + '<div class="status empty">' + esc(d.statusText || 'No personal target yet') + '</div>';
    }
    var pct = Math.max(0, Math.min(d.calPct, 100));
    function row(label, value) {
      return '<li><button type="button" data-act="city-row"><span>' + label + '</span><b>' + value + '</b><i></i></button></li>';
    }
    return '<div class="city-name">' + esc(d.name)
      + (d.badgeWords ? '<em>' + esc(d.badgeWords) + '</em>' : '') + '</div>'
      + '<button type="button" class="city-num" data-act="city-num"><b>' + d.eaten.toLocaleString() + '</b><small>of ' + d.goalCal.toLocaleString() + ' kcal</small></button>'
      + '<div class="city-rule"><i style="width:' + pct + '%"></i></div>'
      + '<div class="status ' + d.status + '">' + esc(d.statusText) + '</div>'
      + '<ul class="city-list">'
      + row('Protein', d.prot + ' / ' + d.protGoal)
      + row('Carbohydrate', d.carbs + ' / ' + d.carbGoal)
      + row('Fat', d.fat + ' / ' + d.fatGoal)
      + row('Training', esc(d.workout))
      + '</ul>'
      + '<div class="tap-hint">Tap a row</div>';
  }

  function tech(d) {
    function cell(label, val, pct) {
      var w = Math.max(0, Math.min(pct, 100));
      return '<button type="button" class="cell" data-act="tech-cell"><label>' + label + '</label><b data-raw="' + esc(val) + '">' + esc(val) + '</b><meter style="--pct:' + w + '"></meter></button>';
    }
    if (!d.hasTarget) {
      return '<div class="tech-head">NO TARGET · ' + esc(d.name) + '</div>'
        + cell('KCAL', String(d.eaten), 0)
        + '<div class="tech-status">' + esc(d.statusText || 'WAITING') + '</div>';
    }
    return '<div class="tech-head">LIVE · ' + esc(d.name) + '</div>'
      + '<div class="tech-grid">'
      + cell('KCAL', d.eaten + '/' + d.goalCal, d.calPct)
      + cell('PROT', d.prot + '/' + d.protGoal, d.protPct)
      + cell('CHO', d.carbs + '/' + d.carbGoal, d.carbGoal ? Math.round(d.carbs / d.carbGoal * 100) : 0)
      + cell('FAT', d.fat + '/' + d.fatGoal, d.fatGoal ? Math.round(d.fat / d.fatGoal * 100) : 0)
      + '</div>'
      + '<button type="button" class="tech-status" data-act="tech-scan">' + esc(d.status.toUpperCase()) + ' · BURN ' + d.workoutNum + '</button>'
      + '<div class="tap-hint">Tap a meter</div>';
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

  function replay(el) {
    if (!el) return;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  function kick(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function burst(host, emojis) {
    emojis.forEach(function (emo, i) {
      var n = document.createElement('i');
      n.className = 'flo';
      n.style.right = (18 + i * 28) + 'px';
      n.style.animationDelay = (i * 0.08) + 's';
      n.textContent = emo;
      host.appendChild(n);
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000);
    });
  }

  function faceFor(cls) {
    if (cls.indexOf('ok') >= 0) return '😊';
    if (cls.indexOf('low') >= 0) return '🍌';
    if (cls.indexOf('over') >= 0) return '😮';
    if (cls.indexOf('partial') >= 0) return '🙂';
    return '🤍';
  }

  function skinWeek() {
    var el = document.getElementById('weekResult');
    if (!el) return;
    var theme = current();
    var table = el.querySelector('table');
    if (table) el.dataset.raw = el.innerHTML;
    if (theme !== 'soft') {
      if (!table && el.dataset.raw) el.innerHTML = el.dataset.raw;
      return;
    }
    if (el.querySelector('.week-faces')) return;
    if (!el.dataset.raw) return;
    var hold = document.createElement('div');
    hold.innerHTML = el.dataset.raw;
    var ths = [].map.call(hold.querySelectorAll('tr:first-child th'), function (th) { return txt(th); });
    var names = ths.slice(1);
    var html = '<div class="week-faces">';
    names.forEach(function (name, ni) {
      html += '<div class="week-person"><div class="week-name">' + esc(name) + '</div><div class="week-days">';
      [].forEach.call(hold.querySelectorAll('tr'), function (tr, ri) {
        if (ri === 0) return;
        var cells = tr.children;
        var date = txt(cells[0]);
        var cell = cells[ni + 1];
        if (!cell) return;
        var cls = cell.className || 'empty';
        html += '<button type="button" class="day ' + esc(cls) + '" data-act="soft-day"><i>' + faceFor(cls) + '</i><b>' + esc(date) + '</b></button>';
      });
      html += '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
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
      if (theme === 'tech') kick(el, 'fx-scan');
    });
    skinWeek();
  }

  function scramble(node) {
    var raw = node.getAttribute('data-raw') || node.textContent;
    var n = 0;
    var timer = setInterval(function () {
      node.textContent = raw.replace(/\d/g, function () { return String(Math.floor(Math.random() * 10)); });
      n += 1;
      if (n > 7) {
        node.textContent = raw;
        clearInterval(timer);
      }
    }, 45);
  }

  function onTap(e) {
    var actEl = e.target.closest('[data-act]');
    if (actEl) {
      var act = actEl.getAttribute('data-act');
      var card = actEl.closest('.person') || actEl.parentNode;
      if (act === 'soft-ring') {
        playRings(card);
        kick(actEl, 'fx-wobble');
        burst(card, ['💙', '✨', '🏋️']);
      } else if (act === 'soft-prot') {
        replay(actEl.querySelector('.pop'));
        if (actEl.parentNode.querySelector('.hit-line')) burst(card, ['💪', '💙', '✨']);
      } else if (act === 'soft-banana') {
        replay(actEl);
        burst(card, ['🍌', '🍌']);
      } else if (act === 'soft-day') {
        kick(actEl, 'fx-pop');
      } else if (act === 'gym-prot' || act === 'gym-bar') {
        replay(card.querySelector('.gym-hero b'));
        replay(card.querySelector('.gym-bar i'));
        var stamp = card.querySelector('.gym-hit');
        if (stamp) {
          stamp.textContent = 'HIT';
          stamp.classList.remove('ghost-hit');
          replay(stamp);
        }
      } else if (act === 'gym-burn') {
        kick(card, 'fx-shake');
        burst(card, ['🏋️']);
      } else if (act === 'city-row') {
        var list = actEl.closest('.city-list');
        if (list) list.querySelectorAll('button').forEach(function (b) { b.classList.remove('lit'); });
        actEl.classList.add('lit');
        kick(actEl, 'fx-draw');
      } else if (act === 'city-num') {
        replay(card.querySelector('.city-rule i'));
      } else if (act === 'tech-cell') {
        card.querySelectorAll('.cell').forEach(function (c) { c.classList.remove('armed'); });
        actEl.classList.add('armed');
        var digits = actEl.querySelector('b');
        if (digits) scramble(digits);
        kick(card, 'fx-scan');
      } else if (act === 'tech-scan') {
        kick(card, 'fx-scan');
        card.querySelectorAll('.cell b').forEach(scramble);
      }
      return;
    }
    var td = e.target.closest('#weekResult td');
    if (!td || current() === 'soft') return;
    replay(td);
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
    if (!document.body.dataset.fx) {
      document.body.dataset.fx = '1';
      document.addEventListener('click', onTap);
    }
    var board = document.getElementById('dashboard');
    if (board && !board.dataset.watched) {
      board.dataset.watched = '1';
      new MutationObserver(function () { skinAll(); }).observe(board, { childList: true });
    }
    var week = document.getElementById('weekResult');
    if (week && !week.dataset.watched) {
      week.dataset.watched = '1';
      new MutationObserver(function () { skinWeek(); }).observe(week, { childList: true });
    }
    apply(current());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
